import { describe, expect, it } from 'vitest';

import { InMemoryWorkRepository } from '@io/business-domain/src/ports/fakes.js';
import type { Work } from '@io/business-domain/src/types.js';
import { LlmError } from '@io/llm-client/src/index.js';

import { dispatchCompanyActivation, dispatchRecovery } from '../../src/dispatch/dispatch.js';
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
      fencingToken: 0,
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

  it('Normal dispatch never auto-resumes an orphan — R6 "Crash-Recovery Non-Guarantee" (supervisor recovery is a separate path)', async () => {
    const h = harness();
    // R6 (reframed, work-dispatch spec "Crash-Recovery Non-Guarantee"): this
    // test pins the NORMAL-dispatch half — actionable selection MUST keep
    // excluding `in_progress` Work, and normal dispatch MUST NOT invoke
    // recovery (scenario "Normal dispatch never auto-resumes an orphan").
    // Resuming an orphan is NOT normal dispatch's job: the separate
    // supervisor-owned recovery path (scenario "Supervisor recovery is a
    // separate path") resumes ONLY explicitly designated orphans after safe
    // reconciliation. Assertion body UNCHANGED — the behavior is preserved.
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

describe('dispatchRecovery — designated recovery dispatch (work-dispatch "Designated Recovery Dispatch")', () => {
  it('resumes in_progress Work through the claimed-work cycle — NO claim, NO token mint (scenario "Recovery resumes without re-claim")', async () => {
    const h = harness();
    // A designated orphan: claimed (in_progress, v2) with the minted claim
    // token 1 — exactly the row the supervisor's discovery would hand over.
    const orphan = acceptedWork({ state: 'in_progress', version: 2, fencingToken: 1 });
    await h.work.save(orphan);
    await h.delegation.save(activeDelegation());

    const result = await dispatchRecovery('acme', orphan, dispatchDeps(h), 'flash');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;
    expect(result.workId).toBe('work-1');
    expect(result.worker.ok).toBe(true);
    // The cycle ran WITHOUT re-claiming: no accepted → in_progress CAS (the
    // Work was already in_progress, so startWork would have invalid-transitioned)
    // and NO token mint (a re-claim would bump 1 → 2).
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
    expect(stored?.version).toBe(2);
    expect(stored?.fencingToken).toBe(1); // retained token N — never re-minted (D6)
    // The full post-claim body ran: one LLM intent + one sandbox effect.
    expect(h.llm.requests).toHaveLength(1);
    expect(h.sandbox.executes).toHaveLength(1);
    // The attempt is recorded under the DERIVED dispatch key + hash.
    const entries = h.journal.snapshot();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('in_flight');
    expect(entries[0]?.idempotencyKey).toBe(dispatchIdempotencyKeyFor('acme', 'work-1'));
  });

  it('reuses the EXACT normal-dispatch identity — same wk: key + SHA-256 hash (scenario "Recovery reuses dispatch identity")', async () => {
    const h = harness();
    const orphan = acceptedWork({ state: 'in_progress', version: 2, fencingToken: 1 });
    await h.work.save(orphan);
    await h.delegation.save(activeDelegation());

    await dispatchRecovery('acme', orphan, dispatchDeps(h), 'flash');

    // The journal row carries the SAME deterministic identity normal dispatch
    // derives from the Work row (keys.ts): the wk: collision-guarded key and
    // the SHA-256 hash over the STABLE identity fields — identical across
    // accepted → in_progress → completed.
    const entries = h.journal.snapshot();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.idempotencyKey).toBe(dispatchIdempotencyKeyFor('acme', orphan.workId));
    expect(entries[0]?.requestHash).toBe(dispatchRequestHashFor(orphan));
    expect(entries[0]?.attemptId).toBe(
      attemptIdFor('acme', dispatchIdempotencyKeyFor('acme', orphan.workId)),
    );
    // The retained claim token rode into the pre-effect insert unchanged
    // (the claim-ownership record — never re-minted, design D6).
    expect(entries[0]?.fencingToken).toBe(1);
  });

  it('preserves LLM context byte-for-byte — same compiled messages + cohort prefix as the normal claimed-work baseline (scenario "Recovery preserves LLM context")', async () => {
    // Two isolated harnesses over IDENTICAL Work identity fields: a normal
    // activation claims and dispatches work-1; recovery resumes the same
    // work-1 (in_progress). The compiled context (messages) and the §7.2/§7.3
    // cohort prefix (`user`) MUST be byte-identical — recovery never alters
    // LLM context.
    const normalH = harness();
    await seed(normalH); // accepted work-1 + active del-1
    await dispatchCompanyActivation('acme', dispatchDeps(normalH), 'flash');

    const recoveryH = harness();
    const orphan = acceptedWork({ state: 'in_progress', version: 2, fencingToken: 1 });
    await recoveryH.work.save(orphan);
    await recoveryH.delegation.save(activeDelegation());
    await dispatchRecovery('acme', orphan, dispatchDeps(recoveryH), 'flash');

    expect(recoveryH.llm.requests).toHaveLength(1);
    expect(normalH.llm.requests).toHaveLength(1);
    const normal = normalH.llm.requests[0];
    const recovered = recoveryH.llm.requests[0];
    expect(recovered?.messages).toEqual(normal?.messages);
    expect(recovered?.user).toBe(normal?.user); // io:{companyId}:{process}:v{schemaVersion}
    expect(recovered?.user).toMatch(/^io:acme:/);
  });
});
