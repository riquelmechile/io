import { startWork } from '@io/business-domain/src/use-cases/start-work.js';
import type { ModelTier } from '@io/business-domain/src/index.js';
import type { Work } from '@io/business-domain/src/types.js';
import { parseCommand } from '@io/business-domain/src/validation/command.js';

import { checkAuthority } from './authority.js';
import { executeEffect } from './effect.js';
import { reconcilePostEffectFailure } from './finalize.js';
import { finalizeInFlightWorkAtomically } from './finalize.js';
import { UNRESOLVED_RESULT } from './finalize.js';
import { prepareIntent } from './intent.js';
import { reconcilePreEffect } from './reconcile.js';
import type { WorkerDeps, WorkerResult } from './types.js';
import { verifyEffect } from './verify.js';

/**
 * The worker cycle (design "Data Flow"): parseCommand → startWork(CAS claim) →
 * authority at action time (B2) → intent + runtime validation (B4) → pre-effect
 * journal reconciliation (B6) → effect OUTSIDE the terminal transaction (B5) →
 * verify (B8) → finalizeInFlightWorkAtomically (B7). Batch-1 (B1–B6) delivered
 * claim → authority → intent → reconcile → effect; B7 adds the post-effect
 * terminal close (T1/T2); B8 adds the distinct-verifier step between the effect
 * and the close, reconciling a failed verification exactly like the finalize
 * CAS-loss path (undo + markRetryable, or clean replay when no effect ran).
 *
 * The claim step (B1): exactly one of concurrent claimants wins via the CAS
 * `startWork` use case; a loser returns `{ ok: false, reason: 'version-conflict' }`
 * and NEVER proceeds to an effect or a receipt.
 *
 * The claim is RESUME-AWARE (design "Data Flow" + reconciliation intent): the
 * reconciliation table always assumes the cycle REACHES the pre-effect
 * reconcile, so a retry/resume of the cycle's OWN already-claimed Work must
 * proceed instead of dying at `startWork`'s invalid-transition. The journal is
 * consulted BEFORE the claim: a fresh key claims normally (accepted →
 * in_progress CAS, one winner); a key that already holds an attempt
 * (in_flight | aborted_retryable) is the cycle's own prior run — the Work was
 * already claimed, so the cycle resumes WITHOUT re-claiming and lets the
 * pre-effect reconcile drive reopen/replay/DENY/recovery. An in_progress Work
 * with NO journal attempt is never hijacked (startWork fails it closed), and a
 * TERMINAL Work never resumes into effect→verify→finalize — the resume branch
 * routes it to the honest terminal handling via the journal (replay / DENY /
 * UNRESOLVED_REQUIRES_HUMAN), so a same-key retry can never re-apply the
 * effect or issue a second receipt.
 */
export async function runWorker(
  input: unknown,
  deps: WorkerDeps,
  model: ModelTier,
): Promise<WorkerResult> {
  const parsed = parseCommand(input);
  if (!parsed.ok) return { ok: false, reason: 'invalid-command', detail: parsed.reason };
  const cmd = parsed.value;
  if (!cmd.idempotencyKey || !cmd.requestHash) {
    return {
      ok: false,
      reason: 'invalid-command',
      detail: 'idempotencyKey and requestHash are required',
    };
  }
  if (!cmd.workId) {
    return { ok: false, reason: 'invalid-command', detail: 'workId is required' };
  }
  const idempotencyKey = cmd.idempotencyKey;
  const requestHash = cmd.requestHash;
  const workId = cmd.workId;

  // 1. Resume-aware claim (B1): consult the journal BEFORE the CAS claim.
  //    - no attempt for this key → the initial claim: startWork CAS
  //      (accepted → in_progress), exactly one concurrent winner (UNCHANGED).
  //    - an attempt (in_flight | aborted_retryable) exists → the cycle's OWN
  //      prior run claimed the Work; re-claiming would brick the retry at
  //      startWork's invalid-transition (in_progress → in_progress is not in
  //      the foundation transition table). Resume WITHOUT re-claiming — the
  //      pre-effect reconcile (B6) then handles reopen/replay/DENY/recovery.
  //    - in_progress with NO journal attempt → never hijack another worker's
  //      Work: startWork rejects it (invalid-transition), failing closed.
  const entry = await deps.journal.lookup(cmd.companyId, idempotencyKey);
  const hasOwnAttempt =
    entry !== undefined && (entry.status === 'in_flight' || entry.status === 'aborted_retryable');

  let work: Work;
  if (hasOwnAttempt) {
    const current = await deps.work.get(cmd.companyId, workId);
    if (current === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (current.state === 'accepted') {
      // The journal row exists but the claim never persisted (partial crash):
      // claim normally — accepted → in_progress CAS.
      const claim = await startWork({ ...cmd, workId }, { work: deps.work });
      if (!claim.ok) return { ok: false, reason: claim.reason, current: claim.current };
      work = claim.value;
    } else if (current.state !== 'in_progress') {
      // TERMINAL (or otherwise non-resumable) Work: the cycle's OWN attempt
      // exists but the Work is already closed. NEVER resume into
      // effect→verify→finalize — that would re-apply the effect and let T1 CAS
      // completed → completed, issuing a SECOND receipt with a DIFFERENT
      // terminal_event_id that UNIQUE(work_id, terminal_event_id) does NOT
      // catch. Route to the honest terminal handling VIA THE JOURNAL (fresh
      // read): a completed row replays (same hash) or DENIES (different hash);
      // any other attempt state closes as UNRESOLVED_REQUIRES_HUMAN — no
      // reopen, no marker (a marker would invite a retry of a key whose Work
      // is done).
      const journalNow = await deps.journal.lookup(cmd.companyId, idempotencyKey);
      if (journalNow?.status === 'completed') {
        if (journalNow.requestHash !== requestHash) {
          return { ok: false, reason: 'idempotency-conflict', current };
        }
        return { ok: true, replayed: true, resultJson: journalNow.resultJson };
      }
      if (journalNow !== undefined) {
        await deps.journal.complete(journalNow.attemptId, UNRESOLVED_RESULT);
      }
      return { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN', current };
    } else {
      // in_progress → resume/retry of the cycle's own Work; the pre-effect
      // reconcile drives reopen/replay/DENY/recovery. No re-claim.
      work = current;
    }
  } else {
    // Initial claim: accepted → in_progress; exactly one concurrent winner.
    const claim = await startWork({ ...cmd, workId }, { work: deps.work });
    if (!claim.ok) return { ok: false, reason: claim.reason, current: claim.current };
    work = claim.value;
  }

  // 2. Authority at action time (B2): window active, not revoked, grant +
  // SoD hold; a revoked/expired/out-of-window grant DENIES here (work stays
  // in_progress — ADR-0002 deny-at-action).
  const authority = await checkAuthority(
    {
      companyId: work.companyId,
      delegationId: work.delegationId,
      principals: deps.principals,
      now: deps.now?.() ?? Date.now(),
    },
    { delegation: deps.delegation },
  );
  if (!authority.ok) {
    return { ok: false, reason: 'denied', detail: authority.reason, current: work };
  }

  // 3. Intent (B4): LLM plan + runtime validation + stable evidenceId. The
  //    delegation checkAuthority surfaced (D5) drives context compilation.
  //    The tenant skill store is fetched ONCE here (skill R7 seam — read-only):
  //    the compiler cohort-selects the active matching skills into segment 7,
  //    so skills condition the plan via context only — never executed here.
  const skills = await deps.skills.listByCompany(cmd.companyId);
  const intent = await prepareIntent({
    companyId: cmd.companyId,
    idempotencyKey,
    work,
    delegation: authority.delegation,
    skills,
    llm: deps.llm,
    model,
  });
  if (!intent.ok) {
    return { ok: false, reason: 'invalid-plan', detail: intent.detail, current: work };
  }

  // 4. Pre-effect journal reconciliation (B6): the decision table (design
  //    "Pre-effect lookup") — replay / deny / recovery / proceed. The durable
  //    in-flight row (insert or reopen) is committed BEFORE the effect.
  const decision = await reconcilePreEffect(
    deps.journal,
    cmd.companyId,
    idempotencyKey,
    requestHash,
    intent.attemptId,
  );
  if (decision.kind === 'replay') {
    return { ok: true, replayed: true, resultJson: decision.resultJson };
  }
  if (decision.kind === 'deny') {
    return { ok: false, reason: 'idempotency-conflict', current: work };
  }
  if (decision.kind === 'recovery') {
    return { ok: false, reason: 'recovery-required', current: work };
  }

  // 5. Effect OUTSIDE any terminal transaction (§9.8): the effect phase takes
  //    only sandbox + action (no journal/receipts/connection), so it cannot
  //    run inside the B7 finalize tx. The attempt stays in_flight.
  const effect = await executeEffect(deps.sandbox, intent.action);

  // 6. Verify (B8): a DISTINCT verifier principal confirms the effect outcome
  //    (verifier≠executor via checkSod; the undo log must confirm the effect).
  //    A failed verification is a post-effect failure — reconciled EXACTLY like
  //    the finalize CAS-loss path (design "Other post-effect failures … same as
  //    CAS-loss (i)"): in_progress+applied → undo + markRetryable →
  //    cas-lost-retryable; in_progress+no effect → clean replay (no undo) →
  //    recovery-required; already terminal → typed UNRESOLVED. The verify step
  //    runs BETWEEN the effect and the terminal close, so a failure stops the
  //    cycle BEFORE any finalize transaction opens.
  const verification = await verifyEffect(
    { sandbox: deps.sandbox, principals: deps.principals },
    { effect },
  );
  if (!verification.ok) {
    const reconciled = await reconcilePostEffectFailure(
      { work: deps.work, journal: deps.journal, sandbox: deps.sandbox },
      {
        companyId: cmd.companyId,
        workId,
        idempotencyKey,
        requestHash,
        attemptId: intent.attemptId,
        effect,
      },
    );
    return { ok: false, reason: reconciled.reason, current: reconciled.current ?? work };
  }

  // 7. Terminal close (B7): finalizeInFlightWorkAtomically — T1 CAS + receipt +
  //    journal.complete in ONE transaction, with the honest T2 reconciliation
  //    on CAS loss (undo + markRetryable, or UNRESOLVED when already terminal).
  //    Runs ONLY when a connection seam AND the repository factory are wired
  //    (batch-1 cycles run without them and return pre-terminal; Slice C wires
  //    the real connection + the PG factory). The factory is what makes T1
  //    ATOMIC against live PG: it binds the repos to the transaction-scoped
  //    client (mirrors completeWorkAtomically) instead of the pool.
  if (deps.connection !== undefined && deps.repositories !== undefined) {
    const finalized = await finalizeInFlightWorkAtomically(
      {
        repositories: deps.repositories,
        sandbox: deps.sandbox,
        connection: deps.connection,
        executor: deps.principals.executor,
        now: deps.now,
      },
      {
        companyId: cmd.companyId,
        workId,
        idempotencyKey,
        requestHash,
        attemptId: intent.attemptId,
        effect,
      },
    );
    if (finalized.ok && 'replayed' in finalized) {
      return { ok: true, replayed: true, resultJson: finalized.resultJson };
    }
    if (!finalized.ok) {
      return { ok: false, reason: finalized.reason, current: finalized.current ?? work };
    }
    return {
      ok: true,
      work: finalized.work,
      attemptId: intent.attemptId,
      evidenceId: intent.evidenceId,
      effect,
      plan: intent.plan,
      receipt: finalized.receipt,
    };
  }

  return {
    ok: true,
    work,
    attemptId: intent.attemptId,
    evidenceId: intent.evidenceId,
    effect,
    plan: intent.plan,
  };
}
