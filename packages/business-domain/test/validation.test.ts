import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCommand } from '../src/validation/command.js';
import type { BusinessCommand } from '../src/validation/command.js';
import { parseLlmPlan } from '../src/validation/llm-plan.js';

/**
 * Command guard tests (design D7, runtime-validation spec). `parseCommand`
 * accepts `unknown`, performs REAL runtime structural checks (a value that
 * type-checks but is corrupt at runtime MUST be rejected), and returns
 * `{ok:true,value} | {ok:false,reason}` — invalid input is a RESULT, never a
 * thrown exception. Zero @io/* imports (business-domain purity).
 */
describe('parseCommand (D7)', () => {
  it('parses a fully-populated valid command → {ok:true, value} with the exact fields', () => {
    const input: unknown = {
      companyId: 'acme',
      actor: 'principal-1',
      workId: 'work-1',
      expectedVersion: 2,
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
    };

    const result = parseCommand(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        companyId: 'acme',
        actor: 'principal-1',
        workId: 'work-1',
        expectedVersion: 2,
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
      });
    }
  });

  it('parses a minimal command (only required fields) → {ok:true, value}', () => {
    expect(parseCommand({ companyId: 'acme', actor: 'p' })).toEqual({
      ok: true,
      value: { companyId: 'acme', actor: 'p' },
    });
  });

  it('rejects a non-object input with a non-empty reason, WITHOUT throwing', () => {
    for (const bad of [null, undefined, 'cmd', 42, true, ['acme']]) {
      const result = parseCommand(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).not.toBe('');
    }
  });

  it('rejects a missing, empty, or non-string companyId', () => {
    for (const bad of [
      { actor: 'p' },
      { companyId: '', actor: 'p' },
      { companyId: 42, actor: 'p' },
    ]) {
      const result = parseCommand(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toMatch(/companyId/i);
    }
  });

  it('rejects a missing, empty, or non-string actor', () => {
    for (const bad of [
      { companyId: 'acme' },
      { companyId: 'acme', actor: '' },
      { companyId: 'acme', actor: [] },
    ]) {
      const result = parseCommand(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toMatch(/actor/i);
    }
  });

  it('rejects a non-string workId when present', () => {
    const result = parseCommand({ companyId: 'acme', actor: 'p', workId: 7 });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toMatch(/workId/i);
  });

  it('rejects an expectedVersion that is not a positive integer (runtime, not type-only)', () => {
    for (const bad of [0, -1, 1.5, '1', NaN, Number.POSITIVE_INFINITY]) {
      const result = parseCommand({ companyId: 'acme', actor: 'p', expectedVersion: bad });
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toMatch(/expectedVersion/i);
    }
  });

  it('rejects an empty idempotencyKey or a non-string requestHash when present', () => {
    const noKey = parseCommand({ companyId: 'acme', actor: 'p', idempotencyKey: '' });
    expect(noKey.ok).toBe(false);
    if (noKey.ok === false) expect(noKey.reason).toMatch(/idempotencyKey/i);

    const badHash = parseCommand({ companyId: 'acme', actor: 'p', requestHash: 5 });
    expect(badHash.ok).toBe(false);
    if (badHash.ok === false) expect(badHash.reason).toMatch(/requestHash/i);
  });

  it('RUNTIME check, not type-only: a value cast to BusinessCommand but corrupt at runtime is REJECTED', () => {
    const fake: BusinessCommand = { companyId: 123, actor: 'p' } as unknown as BusinessCommand;

    const result = parseCommand(fake);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toMatch(/companyId/i);
  });
});

describe('parseLlmPlan (D7)', () => {
  it('parses a valid plan → {ok:true, value} preserving steps and intent', () => {
    const plan: unknown = {
      steps: [
        { action: 'approve', args: { workId: 'w-1' } },
        { action: 'start', args: ['w-1'] },
      ],
      intent: 'close the quarter',
    };

    const result = parseLlmPlan(plan);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.steps).toHaveLength(2);
      expect(result.value.steps[0]?.action).toBe('approve');
      expect(result.value.steps[0]?.args).toEqual({ workId: 'w-1' });
      expect(result.value.steps[1]?.action).toBe('start');
      expect(result.value.steps[1]?.args).toEqual(['w-1']);
      expect(result.value.intent).toBe('close the quarter');
    }
  });

  it('accepts a plan without intent (intent is optional)', () => {
    const result = parseLlmPlan({ steps: [{ action: 'approve', args: [] }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intent).toBeUndefined();
  });

  it('rejects malformed plans with a non-empty reason, WITHOUT throwing', () => {
    const malformed: unknown[] = [
      null,
      'plan',
      42,
      {}, // no steps
      { steps: 'nope' }, // steps is not an array
      { steps: [] }, // a plan that does nothing is malformed
      { steps: [{}] }, // step missing action
      { steps: [{ action: '' }] }, // empty action
      { steps: [{ action: 'x' }] }, // step missing args
      { steps: [{ action: 'x', args: 'oops' }] }, // args is a primitive
      { steps: [{ action: 7, args: [] }] }, // action is not a string
      { steps: [{ action: 'x', args: [] }], intent: 42 }, // intent not a string
    ];

    for (const bad of malformed) {
      const result = parseLlmPlan(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).not.toBe('');
    }
  });

  it('stays IN-DOMAIN and confers NO authority: no @io/llm-client or LLM-SDK import, pure data', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/validation/llm-plan.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/import\s+[^;]*@io\/llm-client/);
    expect(source).not.toMatch(/import\s+[^;]*(openai|anthropic|@ai-sdk)/);

    // A parsed plan is DATA: it must never touch a repository or grant anything.
    const result = parseLlmPlan({ steps: [{ action: 'approve', args: [] }] });
    expect(result).toEqual({ ok: true, value: { steps: [{ action: 'approve', args: [] }] } });
  });
});
