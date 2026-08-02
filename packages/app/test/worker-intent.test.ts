import { describe, expect, it } from 'vitest';

import type { Skill } from '@io/business-domain/src/types.js';
import { compileContext } from '@io/context/src/index.js';
import { attemptIdFor, prepareIntent } from '../src/worker/intent.js';
import { runWorker } from '../src/worker/worker.js';
import {
  acceptedWork,
  activeDelegation,
  cannedLlm,
  harness,
  seed,
  workerInput,
} from './worker-helpers.js';

/**
 * B4 — Intent-before-effect + runtime validation + evidenceId + compiled context
 * (WC intent-before-effect / runtime-validation / evidenceId-stable): the
 * durable in-flight record is committed via `insertInFlight` BEFORE the first
 * external side effect; malformed LLM plans are rejected by `parseLlmPlan` and
 * malformed commands by `parseCommand` (typed rejects, never passed through);
 * `evidenceId` is "ev:" + companyId + ":" + idempotencyKey — stable across retry;
 * the request compiles the canonical context via `compileContext` (segments 1–9
 * stable prefix + segments 10–13 work tail) with `user` = the derived cache
 * cohort, and sends it through the injected LlmClient.
 */
describe('prepareIntent (B4)', () => {
  it('computes a stable evidenceId (ev:companyId:idempotencyKey) identical across retries', async () => {
    const llm = cannedLlm();
    const input = {
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      work: acceptedWork(),
      delegation: activeDelegation(),
      llm,
    };

    const first = await prepareIntent(input);
    const second = await prepareIntent(input);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.evidenceId).toBe('ev:acme:close-2026-q3');
      expect(second.evidenceId).toBe(first.evidenceId);
    }
  });

  it('the LLM request carries the compiled system prefix, the work user tail, and the derived cache cohort', async () => {
    const llm = cannedLlm();
    const delegation = activeDelegation();
    const work = acceptedWork();

    await prepareIntent({ companyId: 'acme', idempotencyKey: 'k', work, delegation, llm });

    // Expected bytes come from the compiler itself — the worker MUST emit
    // exactly what compileContext produces (no hard-coded strings here).
    const compiled = compileContext({
      companyId: 'acme',
      process: delegation.authorityScope.scope,
      delegation,
      work,
    });
    const request = llm.requests[0];
    expect(request?.messages[0]).toEqual({
      role: 'system',
      content: compiled.messages[0]?.content,
    });
    expect(request?.messages[0]?.content).toContain('Business process: low-risk-documents.');
    expect(request?.user).toBe(compiled.user);
    expect(request?.user).toBe('io:acme:low-risk-documents:v2');
    expect(request?.messages[1]?.role).toBe('user');
    expect(request?.messages[1]?.content).toBe(compiled.messages[1]?.content);
    expect(request?.messages[1]?.content).toContain('execute the quarterly close');
  });

  it('processTokenFor drives the cohort: a different delegation scope yields a different process and user', async () => {
    const llm = cannedLlm();
    const delegation = activeDelegation({
      authorityScope: { scope: 'onboarding', actions: ['work.execute', 'create-document'] },
    });

    await prepareIntent({
      companyId: 'acme',
      idempotencyKey: 'k',
      work: acceptedWork(),
      delegation,
      llm,
    });

    const request = llm.requests[0];
    expect(request?.user).toBe('io:acme:onboarding:v2');
    expect(request?.messages[0]?.content).toContain('Business process: onboarding.');
  });

  it('passes supplied skills into the compiled context — segment 7 renders into the system prefix', async () => {
    const llm = cannedLlm();
    const delegation = activeDelegation();
    const skill: Skill = {
      skillId: 'invoice-extraction',
      companyId: 'acme',
      name: 'Invoice extraction',
      version: 1,
      body: 'Extract vendor and amount fields from invoice documents.',
      scope: { process: 'low-risk-documents', schemaVersion: 2 },
      state: 'active',
      createdAt: 1750000000000,
      updatedAt: 1750000000000,
    };

    await prepareIntent({
      companyId: 'acme',
      idempotencyKey: 'k',
      work: acceptedWork(),
      delegation,
      llm,
      skills: [skill],
    });

    // The segment-7 block (fixed template, skillId/name/version/body only)
    // appears in the LLM request's system prefix when a matching skill is passed.
    const request = llm.requests[0];
    expect(request?.messages[0]?.content).toContain('Active skills:');
    expect(request?.messages[0]?.content).toContain(
      '- id=invoice-extraction name=Invoice extraction v=1',
    );
    expect(request?.messages[0]?.content).toContain(
      'Extract vendor and amount fields from invoice documents.',
    );
  });

  it('malformed LLM output is rejected with a typed invalid-plan result (never acted on)', async () => {
    const notJson = await prepareIntent({
      companyId: 'acme',
      idempotencyKey: 'k',
      work: acceptedWork(),
      delegation: activeDelegation(),
      llm: cannedLlm('not-json'),
    });
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.reason).toBe('invalid-plan');

    const badShape = await prepareIntent({
      companyId: 'acme',
      idempotencyKey: 'k',
      work: acceptedWork(),
      delegation: activeDelegation(),
      llm: cannedLlm(JSON.stringify({ steps: 'nope' })),
    });
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) expect(badShape.reason).toBe('invalid-plan');

    const noDocumentStep = await prepareIntent({
      companyId: 'acme',
      idempotencyKey: 'k',
      work: acceptedWork(),
      delegation: activeDelegation(),
      llm: cannedLlm(JSON.stringify({ steps: [{ action: 'append-line', args: { line: 'x' } }] })),
    });
    expect(noDocumentStep.ok).toBe(false);
    if (!noDocumentStep.ok) expect(noDocumentStep.reason).toBe('invalid-plan');
  });

  it('attemptIdFor uses the stable att: scheme (receipt traceability anchor)', () => {
    expect(attemptIdFor('acme', 'close-2026-q3')).toBe('att:acme:close-2026-q3');
    expect(attemptIdFor('acme', 'close-2026-q3')).toBe(attemptIdFor('acme', 'close-2026-q3'));
  });
});

describe('cycle intent (WC intent-before-effect)', () => {
  it('insertInFlight is committed BEFORE sandbox.execute', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    const insertIdx = h.trace.findIndex((entry) => entry.startsWith('journal:insertInFlight'));
    const executeIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:execute'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(executeIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeLessThan(executeIdx);
  });

  it('the canned plan with a create-document step drives the executed effect; evidenceId + attemptId stable', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    if (result.ok && 'effect' in result) {
      expect(result.effect.action).toEqual({
        type: 'create-document',
        relativePath: 'docs/quarterly-close.md',
        content: 'closed for Q3 2026',
      });
      expect(result.evidenceId).toBe('ev:acme:close-2026-q3');
      expect(result.attemptId).toBe('att:acme:close-2026-q3');
      expect(await h.sandbox.wasApplied(result.effect.undo.handleId)).toBe(true);
    }
  });

  it('fetches the tenant skills EXACTLY ONCE after authority and renders segment 7 into the LLM request (skill R7 seam)', async () => {
    const h = harness();
    await seed(h);
    await h.skills.save({
      skillId: 'invoice-extraction',
      companyId: 'acme',
      name: 'Invoice extraction',
      version: 1,
      body: 'Extract vendor and amount fields from invoice documents.',
      scope: { process: 'low-risk-documents', schemaVersion: 2 },
      state: 'active',
      createdAt: 1750000000000,
      updatedAt: 1750000000000,
    });

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    // Fetch-once: the cycle reads the tenant store for the company exactly once.
    expect(h.skills.listCalls).toEqual(['acme']);
    // The fetched skill reached the context: segment 7 renders into the system prefix.
    const system = h.llm.requests[0]?.messages[0]?.content;
    expect(system).toContain('Active skills:');
    expect(system).toContain('- id=invoice-extraction name=Invoice extraction v=1');
  });

  it('does NOT fetch skills when authority is denied — the fetch happens AFTER authority OK', async () => {
    const h = harness();
    await h.work.save(acceptedWork());
    await h.delegation.save(activeDelegation({ state: 'revoked' }));

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('denied');
    expect(h.skills.listCalls).toEqual([]);
  });

  it('passes the RAW tenant store — non-matching skills are filtered by the compiler, never the worker', async () => {
    const h = harness();
    await seed(h);
    // Process mismatch: the cohort process is 'low-risk-documents' (delegation
    // scope), this skill targets 'onboarding' — the compiler must filter it.
    await h.skills.save({
      skillId: 'tax-filing',
      companyId: 'acme',
      name: 'Tax filing',
      version: 1,
      body: 'File quarterly tax forms.',
      scope: { process: 'onboarding', schemaVersion: 2 },
      state: 'active',
      createdAt: 1750000000000,
      updatedAt: 1750000000000,
    });

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    // The worker STILL fetched the store once (raw pass-through, no pre-filter).
    expect(h.skills.listCalls).toEqual(['acme']);
    // But the non-matching skill never enters the context: segment 7 ABSENT.
    const system = h.llm.requests[0]?.messages[0]?.content;
    expect(system).not.toContain('Active skills:');
    expect(system).not.toContain('tax-filing');
  });

  it('a malformed LLM plan stops the cycle: no journal insert, no effect', async () => {
    const h = harness({ llm: cannedLlm('not-json') });
    await seed(h);

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-plan');
    expect(h.journal.snapshot()).toHaveLength(0);
    expect(h.sandbox.executes).toHaveLength(0);
  });

  it('a malformed command is rejected at the boundary: never passed through, no effect', async () => {
    const h = harness();
    await seed(h);

    const bad = await runWorker({ companyId: 42, actor: 'x', workId: 'work-1' }, h);

    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('invalid-command');
    expect(h.sandbox.executes).toHaveLength(0);
    expect(h.journal.snapshot()).toHaveLength(0);
  });
});
