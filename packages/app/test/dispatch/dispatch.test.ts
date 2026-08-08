import { describe, expect, it } from 'vitest';

import { InMemoryWorkRepository } from '@io/business-domain/src/ports/fakes.js';
import type { Work } from '@io/business-domain/src/types.js';
import { LlmError } from '@io/llm-client/src/index.js';

import { dispatchCompanyActivation } from '../../src/dispatch/dispatch.js';
import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../../src/dispatch/keys.js';
import type { DispatchDeps } from '../../src/dispatch/types.js';
import { attemptIdFor } from '../../src/worker/intent.js';
import { acceptedWork, activeDelegation, cannedLlm, harness, seed } from '../worker-helpers.js';

/**
 * Dispatch activation (work-dispatch R2 + work-lifecycle empty scope): one
 * activation settles the FIRST actionable Work — oldest accepted first — via
 * the UNCHANGED `runWorker`, deriving the stable dispatch key (`wk:…`) and
 * request hash from the Work identity fields. An empty queue settles
 * `{ok:true, dispatched:false}` with ZERO worker/LLM invocation, and an empty
 * `companyId` rejects BEFORE any store read (ADR-0002).
 *
 * Failure settlement policy (R5): a TYPED `{ok:false}` worker result — e.g.
 * `invalid-plan`, `denied` — is a settled DispatchResult (cursor advances, no
 * hot LLM retry loop); a THROWN error (LlmError/DB) propagates (cursor
 * un-advanced, at-least-once re-activation). Replay safety (R4): re-activating
 * under the same key+hash journal-replays with no second effect/receipt.
 * Orphan non-guarantee (R6): post-claim `in_progress` Work is excluded and
 * never auto-resumed.
 */

/** A work repo that records every actionable read (pre-read-reject proof). */
class RecordingWorkRepository extends InMemoryWorkRepository {
  readonly listCalls: string[] = [];

  override async listActionableByCompany(companyId: string): Promise<readonly Work[]> {
    this.listCalls.push(companyId);
    return super.listActionableByCompany(companyId);
  }
}

function dispatchDeps(h: ReturnType<typeof harness>): DispatchDeps {
  return { work: h.work, worker: h, actor: h.principals.executor };
}

describe('dispatchCompanyActivation — empty actionable queue is cost-free (R2, empty scope)', () => {
  it('settles {ok:true, dispatched:false} with zero worker and LLM invocations', async () => {
    const h = harness();
    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'flash');

    expect(result).toEqual({ ok: true, dispatched: false });
    // Zero worker/LLM: no LLM request, no journal attempt, no sandbox effect.
    expect(h.llm.requests).toHaveLength(0);
    expect(h.journal.snapshot()).toHaveLength(0);
    expect(h.sandbox.executes).toHaveLength(0);
  });

  it('rejects an empty companyId BEFORE any store read (ADR-0002)', async () => {
    const work = new RecordingWorkRepository();
    const h = harness();
    const deps: DispatchDeps = { work, worker: h, actor: h.principals.executor };

    await expect(dispatchCompanyActivation('', deps, 'flash')).rejects.toThrow(
      'a non-empty companyId is required',
    );
    expect(work.listCalls).toHaveLength(0);
  });
});

describe('dispatchCompanyActivation — one oldest-first runWorker per activation (R2)', () => {
  it('dispatches exactly the OLDEST accepted Work through the unchanged runWorker', async () => {
    const h = harness();
    await seed(h); // work-1 (accepted, v1) + active del-1
    // A second accepted Work inserted AFTER work-1 (Map iteration order).
    await h.work.save(acceptedWork({ workId: 'work-2', delegationId: 'del-2' }));
    await h.delegation.save(activeDelegation({ delegationId: 'del-2' }));

    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'flash');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;
    expect(result.workId).toBe('work-1');

    // Exactly ONE worker cycle ran, on the OLDEST Work: work-1 claimed
    // (accepted → in_progress, version 2), work-2 untouched.
    const work1 = await h.work.get('acme', 'work-1');
    expect(work1?.state).toBe('in_progress');
    expect(work1?.version).toBe(2);
    const work2 = await h.work.get('acme', 'work-2');
    expect(work2?.state).toBe('accepted');
    expect(work2?.version).toBe(1);
    expect(h.llm.requests).toHaveLength(1);
    expect(h.sandbox.executes).toHaveLength(1);

    // The attempt is recorded under the DERIVED dispatch key + hash, with the
    // attemptId via the existing attemptIdFor (design: zero worker changes).
    const entries = h.journal.snapshot();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.idempotencyKey).toBe(dispatchIdempotencyKeyFor('acme', 'work-1'));
    expect(entries[0]?.requestHash).toBe(dispatchRequestHashFor(work1 ?? acceptedWork()));
    expect(entries[0]?.attemptId).toBe(
      attemptIdFor('acme', dispatchIdempotencyKeyFor('acme', 'work-1')),
    );
  });

  it('passes the activation tier UNCHANGED to the dispatched cycle — pro reaches the LLM request (WD One-Oldest S1)', async () => {
    const h = harness();
    await seed(h);

    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'pro');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);
    // Exactly one worker cycle ran and the FakeLlm saw the mapped pro model.
    expect(h.llm.requests).toHaveLength(1);
    expect(h.llm.requests[0]?.model).toBe('deepseek-v4-pro');
  });
});

describe('dispatchCompanyActivation — failure settlement controls cursor progress (R5)', () => {
  it('named mapping: a typed invalid-plan worker failure SETTLES as a DispatchResult (no throw)', async () => {
    // The LLM returns non-JSON → prepareIntent → invalid-plan (typed failure).
    const h = harness({ llm: cannedLlm('this is not json') });
    await seed(h);

    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'flash');

    // Settled, not thrown: dispatch resolves with dispatched:true + the typed
    // worker result (cursor advances; no hot LLM retry loop).
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;
    expect(result.workId).toBe('work-1');
    expect(result.worker.ok).toBe(false);
    if (result.worker.ok) return;
    expect(result.worker.reason).toBe('invalid-plan');
    // The cycle DID run (one LLM attempt) — but the typed failure is settled.
    expect(h.llm.requests).toHaveLength(1);
  });

  it('named mapping: a typed denied worker failure SETTLES as a DispatchResult (no throw)', async () => {
    const h = harness();
    await seed(h);
    // Revoke the delegation → checkAuthority denies at action time (ADR-0002).
    await h.delegation.save(activeDelegation({ delegationId: 'del-1', state: 'revoked' }));

    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'flash');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;
    expect(result.worker.ok).toBe(false);
    if (result.worker.ok) return;
    expect(result.worker.reason).toBe('denied');
  });

  it('a THROWN worker error (LlmError) PROPAGATES — retryable, cursor un-advanced', async () => {
    const throwingLlm = {
      complete: async (): Promise<never> => {
        throw new LlmError('unknown', 'network drop mid-request');
      },
    };
    const h = harness({ llm: throwingLlm });
    await seed(h);

    await expect(dispatchCompanyActivation('acme', dispatchDeps(h), 'flash')).rejects.toThrow(
      LlmError,
    );
  });
});

describe('dispatchCompanyActivation — replay safety (R4) and orphan non-guarantee (R6)', () => {
  it('re-activating under the same key+hash journal-REPLAYS: no second effect or receipt (R4)', async () => {
    const h = harness();
    await seed(h); // work-1 accepted + active del-1
    const work = await h.work.get('acme', 'work-1');
    if (work === undefined) throw new Error('test setup: work-1 missing');
    const idempotencyKey = dispatchIdempotencyKeyFor('acme', work.workId);
    const requestHash = dispatchRequestHashFor(work);
    const attemptId = attemptIdFor('acme', idempotencyKey);

    // Record the attempt under the dispatch key+hash (completed — the replay
    // seal) via the existing journal port.
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey,
      requestHash,
      attemptId,
    });
    const recorded = { ...work, state: 'completed', version: 3 };
    await h.journal.complete(attemptId, recorded);

    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'flash');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;
    expect(result.workId).toBe('work-1');
    // The recorded result REPLAYS (no effect, no receipt).
    expect(result.worker).toMatchObject({ ok: true, replayed: true });
    expect(h.sandbox.executes).toHaveLength(0);
    expect(h.receipts.saves).toHaveLength(0);
    // The journal row is untouched — still the same completed attempt.
    const entry = h.journal.snapshot();
    expect(entry).toHaveLength(1);
    expect(entry[0]?.status).toBe('completed');
    expect(entry[0]?.attemptId).toBe(attemptId);
  });

  it('excludes post-claim in_progress Work — never auto-resumed (R6)', async () => {
    const h = harness();
    // A post-claim orphan: claimed (in_progress, v2) but never completed.
    await h.work.save(acceptedWork({ state: 'in_progress', version: 2 }));
    await h.delegation.save(activeDelegation());

    const result = await dispatchCompanyActivation('acme', dispatchDeps(h), 'flash');

    // Excluded from the actionable queue: settle cost-free, no auto-resume.
    expect(result).toEqual({ ok: true, dispatched: false });
    expect(h.llm.requests).toHaveLength(0);
    expect(h.journal.snapshot()).toHaveLength(0);
    // The orphan Work is untouched (no CAS, no resume).
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
    expect(stored?.version).toBe(2);
  });
});
