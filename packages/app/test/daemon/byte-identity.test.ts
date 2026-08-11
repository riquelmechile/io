import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Non-invasive runtime boundary (R6) + PR2 model-threading identity: the daemon
 * capability MUST add no runtime dependency and MUST preserve the verified
 * supervisor/worker/heartbeat/dispatch cores byte-identically. The hashes
 * below pin the COMMITTED baseline; any byte drift fails here.
 *
 * PR1 (heartbeat-decision) updated the `tick.ts` pin for the decision-event
 * append; PR2 (pro-escalation) updates FOUR pins for the model-tier threading —
 * `tick.ts` (passes `decision.model`), `supervisor/types.ts`
 * (`OnActivate(companyId, model)`), `worker/worker.ts` (`runWorker` gains the
 * required 3rd `model: ModelTier` arg), and `dispatch/dispatch.ts`
 * (`dispatchCompanyActivation` gains `model`). `supervisor.ts`, `cycle.ts`,
 * `evaluate.ts`, `dispatch/keys.ts` and `dispatch/types.ts` stay
 * byte-identical. The source-inspection variants below PROVE the drift is
 * model-threading ONLY: normalizing the model-parameter lines away restores
 * the exact committed baseline bytes.
 */

/** `packages/app/src` — the root every protected source is relative to. */
const SRC_ROOT = resolve(fileURLToPath(new URL('../../src', import.meta.url)));

/** Protected core sources: path relative to SRC_ROOT → pinned SHA-256 (baseline). */
const PROTECTED_SOURCES: Record<string, string> = {
  'supervisor/supervisor.ts': '9287e0add2c23ce91090cdef9e18f7f4fbb02afc8ae1817a3e20a5c0ee007b62',
  'supervisor/tick.ts': 'e8f9c81a7413a47196e74ff2ad34a67bff99e55fcc9eceaa386a1db9affa81ad',
  'supervisor/types.ts': '887648e0bb58b8e2345ac0da4b787a18f48486a2ec91f33859a3147c3bc85096',
  'worker/worker.ts': '936ada78c244b949ba666e7c881ec583648b7e76ffff253204c3d5262f36306c',
  'heartbeat/cycle.ts': '9808756b51a37907bfc0b070fbf364c15f028e0ff3e0777abf94af1c90a50e75',
  'heartbeat/evaluate.ts': '56984e32f758e1a17b02937b20658cb91452a016d33331f5b907d806540efbe0',
  'dispatch/dispatch.ts': '7e48fbd734fbd03db92c239354a46e9dde7a51166928800d7677d4efea76a091',
  'dispatch/keys.ts': 'b775263af51439182634523973535e3db0487fc0c1bda4723b417824fd7300cb',
  'dispatch/types.ts': '0534731cfa5d4aee04bc7c6d365c9c625fc1b2cf271ac425b712d96fbff81d17',
};

/** PR1 (pre-PR2) committed baselines of the two files whose ONLY allowed drift
 * is model-tier threading — used by the normalization proofs below. */
const PR1_TICK_BASELINE = '674c9eb4415e690b6a0cc0b6e553bc6d59322ab93f201beb1ccc7951ea8ce43c';
const PR1_WORKER_BASELINE = 'f20a9403439d9f8b3aa926518febb34e7afc78a4a1a2a61f8786ee044ff49a28';

/**
 * Slice-3 (supervisor-recovery PR 3) committed baseline of `worker/worker.ts`:
 * the pre-extraction module — the post-claim body (steps 2–7) still inlined in
 * `runWorker`. PR 4's ONLY allowed worker.ts drift is the D5 `runClaimedWork`
 * extraction, so inlining the extracted function back MUST restore exactly
 * these bytes.
 */
const SLICE3_WORKER_BASELINE = '32f55a40c103c67ed285c3687435168887375bc4f2198a0abc7a733c504c736f';

/** The call-site comment the D5 extraction adds to `runWorker` (documented
 * drift — the reverse must remove it to restore the pre-extraction bytes). */
const RUN_CLAIMED_WORK_COMMENT =
  '  // 2–7. The claimed-work cycle (design D5 seam): authority → intent →\n' +
  '  // reconcile → effect → verify → finalize, extracted to runClaimedWork so\n' +
  '  // recovery dispatch can resume designated in_progress Work through the SAME\n' +
  '  // post-claim body without re-claiming.\n';

/** The identity-const preamble the extraction adds at the top of the
 * `runClaimedWork` body (the ONLY edit to the moved steps 2–7 — the body text
 * itself is verbatim). The leading `\n` is the signature-line terminator that
 * precedes the body after the opening `{`. */
const RUN_CLAIMED_WORK_PREAMBLE =
  '\n  const idempotencyKey = cmd.idempotencyKey;\n' +
  '  const requestHash = cmd.requestHash;\n' +
  '  const workId = cmd.workId;\n' +
  '\n';

/**
 * Reverse the D5 `runClaimedWork` extraction (design D5 seam): remove the
 * exported function definition and splice its body (minus the identity-const
 * preamble) back at the call site inside `runWorker`, removing the
 * extraction's call-site comment. When the extraction was PURELY mechanical,
 * the result is byte-identical to the pre-extraction (slice-3) module.
 */
function inlineRunClaimedWork(source: string): string {
  const cleaned = source.replace(RUN_CLAIMED_WORK_COMMENT, '');
  const defStart = cleaned.indexOf('export async function runClaimedWork(');
  if (defStart === -1) {
    throw new Error('byte-identity: runClaimedWork definition not found in worker.ts');
  }
  const bodyOpen = cleaned.indexOf('{', defStart);
  let depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error('byte-identity: runClaimedWork body never closes');
  }
  const inner = cleaned.slice(bodyOpen + 1, end - 1); // body WITHOUT the outer braces
  const bodyOnly = inner.startsWith(RUN_CLAIMED_WORK_PREAMBLE)
    ? inner.slice(RUN_CLAIMED_WORK_PREAMBLE.length)
    : inner;
  const callStart = cleaned.indexOf('  return runClaimedWork(work, deps, model, {');
  if (callStart === -1) {
    throw new Error('byte-identity: runClaimedWork call site not found in runWorker');
  }
  const callEnd = cleaned.indexOf('  });', callStart);
  if (callEnd === -1) {
    throw new Error('byte-identity: runClaimedWork call site never closes');
  }
  // The pre-extraction module = [runWorker through the claim gate] + [the moved
  // body] + runWorker's closing `}` + its line terminator. The extraction's
  // call line (`  });`), the blank line before the definition and the
  // definition itself are ALL discarded.
  const pre = cleaned.slice(0, defStart);
  const tail = cleaned.slice(callEnd + 6, callEnd + 8); // `}\n` — runWorker's close
  // The extraction widens the existing types import with ClaimedWorkIdentity
  // (the type lives in the UNPINNED worker/types.ts) — restore the import line.
  return (pre.slice(0, callStart) + bodyOnly + tail).replace(
    "import type { ClaimedWorkIdentity, WorkerDeps, WorkerResult } from './types.js';",
    "import type { WorkerDeps, WorkerResult } from './types.js';",
  );
}

const APP_PACKAGE_JSON = resolve(SRC_ROOT, '../package.json');

/** The exact `dependencies` map of `packages/app/package.json` (zero new runtime deps). */
const PINNED_APP_DEPENDENCIES: Record<string, string> = {
  '@io/business-domain': 'workspace:*',
  '@io/context': 'workspace:*',
  '@io/database': 'workspace:*',
  '@io/llm-client': 'workspace:*',
  '@io/trust-kernel': 'workspace:*',
};

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sha256Of(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

describe('R6 non-invasive runtime boundary', () => {
  it('every protected core source is byte-identical to its committed baseline', () => {
    const protectedFiles = Object.keys(PROTECTED_SOURCES);
    // Prove the loop is not a ghost: exactly the 9 protected sources are pinned.
    expect(protectedFiles).toHaveLength(9);

    for (const relative of protectedFiles) {
      const actual = sha256(resolve(SRC_ROOT, relative));
      expect(actual, `${relative} drifted from its committed baseline (R6)`).toBe(
        PROTECTED_SOURCES[relative],
      );
    }
  });

  it('daemon.ts is NOT a protected core and does not appear in the protected set', () => {
    expect(Object.keys(PROTECTED_SOURCES)).not.toContain('daemon/daemon.ts');
  });

  it('packages/app gains no new runtime dependency (R6: zero new runtime deps)', () => {
    const manifest: { dependencies: Record<string, string> } = JSON.parse(
      readFileSync(APP_PACKAGE_JSON, 'utf8'),
    );
    expect(manifest.dependencies).toEqual(PINNED_APP_DEPENDENCIES);
  });
});

describe('PR2 model-threading identity (WD Wiring S2; ST Seam S2)', () => {
  it('the protected core set is byte-identical: supervisor.ts, cycle.ts, evaluate.ts, and the gate', () => {
    // The gate (`evaluateHeartbeatGate` in cycle.ts) + its evaluator + the
    // supervisor core NEVER change for the model threading (spec: byte-identical).
    for (const relative of [
      'supervisor/supervisor.ts',
      'heartbeat/cycle.ts',
      'heartbeat/evaluate.ts',
    ]) {
      expect(sha256(resolve(SRC_ROOT, relative)), `${relative} must stay byte-identical`).toBe(
        PROTECTED_SOURCES[relative],
      );
    }
  });

  it('only tick.ts and runWorker differ among the named paths — dispatch/keys/types and supervisor.ts stay identical (WD Wiring S2)', () => {
    // PR2's only allowed source drift: `tick.ts` (threads decision.model) and
    // `runWorker` (worker.ts, model param). Every other protected source keeps
    // its committed bytes.
    for (const relative of [
      'supervisor/supervisor.ts',
      'heartbeat/cycle.ts',
      'heartbeat/evaluate.ts',
      'dispatch/keys.ts',
      'dispatch/types.ts',
    ]) {
      expect(
        sha256(resolve(SRC_ROOT, relative)),
        `${relative} drifted beyond the threading set`,
      ).toBe(PROTECTED_SOURCES[relative]);
    }
  });

  it('runWorker differs ONLY by the model parameter AND the fencing-token threading (S1 claim-close + S2 journal-token): stripping them restores the PR1 baseline bytes (ST Seam S2 + fencing)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'worker/worker.ts'), 'utf8');
    // First undo the D5 runClaimedWork extraction (PR 4): inline the extracted
    // body back into runWorker, restoring the slice-3 module. Then normalize
    // away (1) the model-tier threading (the required 3rd arg — biome wraps
    // the long signature — its type-only import, and the `model` field fed to
    // prepareIntent) and (2) ALL fencing-token threading — Slice 1 (the claim
    // token threaded into the terminal close + the verify-fail reconcile, with
    // its explanatory comment) AND Slice 2 (the token arg on the pre-effect
    // reconcilePreEffect call, and the terminal-branch in_flight-only guard
    // that the complete status guard requires). The result must be
    // byte-identical to the PR1 single-line-signature baseline.
    const inlined = inlineRunClaimedWork(current);
    const normalized = inlined
      .replace("import type { ModelTier } from '@io/business-domain/src/index.js';\n", '')
      .replace(
        'export async function runWorker(\n  input: unknown,\n  deps: WorkerDeps,\n  model: ModelTier,\n): Promise<WorkerResult> {',
        'export async function runWorker(input: unknown, deps: WorkerDeps): Promise<WorkerResult> {',
      )
      .replace(/\n {4}model,\n/, '\n')
      // S2: the terminal branch's in_flight-only guard (the complete status
      // guard forbids completing a marker row) — restore the S1 token-free
      // close shape.
      .replace(
        "      if (journalNow !== undefined && journalNow.status === 'in_flight') {\n" +
          '        // Close the attempt honestly with the token-free UNRESOLVED sentinel\n' +
          '        // (the status-guarded `complete` transitions only in_flight rows; the\n' +
          '        // honest stale-holder close carries NO token). An aborted_retryable\n' +
          '        // marker row is NOT completed here — the status guard forbids\n' +
          '        // regressing a marker to a completion, and every retry of the key\n' +
          '        // short-circuits at this terminal branch with the typed UNRESOLVED\n' +
          '        // result (no reopen, no effect, no second receipt).\n' +
          '        await deps.journal.complete(journalNow.attemptId, UNRESOLVED_RESULT);\n' +
          '      }',
        '      if (journalNow !== undefined) {\n' +
          '        await deps.journal.complete(journalNow.attemptId, UNRESOLVED_RESULT);\n' +
          '      }',
      )
      // S2: the claim token threaded into the pre-effect reconcile call.
      .replace(
        '\n    intent.attemptId,\n    work.fencingToken,\n  );',
        '\n    intent.attemptId,\n  );',
      )
      // S1: the claim token threaded into the terminal close and the
      // verify-fail reconcile, with its explanatory comment.
      .replace(
        '\n        // The claim-scoped fencing token (fencing-tokens change): minted at\n' +
          '        // the winning claim CAS (0 → N+1) and retained on resume without a\n' +
          '        // fresh claim. The T1 terminal CAS requires it — a stale token rolls\n' +
          '        // the close back (zombie-writer protection).\n' +
          '        fencingToken: work.fencingToken,\n',
        '\n',
      )
      .replace('\n        fencingToken: work.fencingToken,', '');
    expect(sha256Of(normalized)).toBe(PR1_WORKER_BASELINE);
  });

  it('tick.ts threads the tier: stripping decision.model restores the PR1 baseline bytes (ST Seam S2)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'supervisor/tick.ts'), 'utf8');
    // PR4 first: revert the recovery-seam drift (comment + invocation) to the
    // slice-3 tick bytes; then strip the model threading to PR1.
    const normalized = current
      .replace(PR4_TICK_COMMENT, SLICE3_TICK_COMMENT)
      .replace('  await onRecovery?.(companyId);\n', '')
      .replace(
        'export const tickCompany: TickCompany = async (\n  deps: SupervisorDeps,\n  companyId,\n  onActivate,\n  onRecovery,\n) => {',
        'export const tickCompany: TickCompany = async (deps: SupervisorDeps, companyId, onActivate) => {',
      )
      .replace('await onActivate?.(companyId, decision.model);', 'await onActivate?.(companyId);');
    expect(sha256Of(normalized)).toBe(PR1_TICK_BASELINE);
  });
});

describe('PR4 supervisor-recovery identity (work-dispatch "Designated Recovery Dispatch"; design D5)', () => {
  it('the runClaimedWork extraction is PURELY MECHANICAL: inlining the extracted function back into runWorker restores the slice-3 baseline bytes (D5 seam)', () => {
    // The extraction must be move-into-a-function only — NO logic change, NO
    // reordering — so the post-claim body (steps 2–7: authority → intent →
    // reconcile → effect → verify → finalize) produces identical bytes before
    // and after extraction. The reverse-inline below reconstructs the
    // pre-extraction module; any behavioral edit to the moved body breaks it.
    const current = readFileSync(resolve(SRC_ROOT, 'worker/worker.ts'), 'utf8');
    expect(sha256Of(inlineRunClaimedWork(current))).toBe(SLICE3_WORKER_BASELINE);
  });

  it('dispatch.ts differs ONLY by the ADDED dispatchRecovery: removing it restores the pre-recovery baseline bytes (design D5 recovery seam)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'dispatch/dispatch.ts'), 'utf8');
    // The only allowed dispatch.ts drift is the additive dispatchRecovery
    // function (dispatchCompanyActivation untouched) — strip the function
    // definition + its doc comment, and the imports it introduced
    // (`runClaimedWork` on the worker import, and the Work type).
    const stripped = current
      .replace(removeFunctionBlock(current, 'dispatchRecovery'), '')
      .replace(
        "import { runClaimedWork, runWorker } from '../worker/worker.js';",
        "import { runWorker } from '../worker/worker.js';",
      )
      .replace("import type { Work } from '@io/business-domain/src/types.js';\n", '');
    expect(sha256Of(stripped)).toBe(DISPATCH_PRE_RECOVERY_BASELINE);
  });

  it('tick.ts differs ONLY by the onRecovery invocation: stripping it restores the slice-3 tick bytes (supervisor-timer delta, design D4)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'supervisor/tick.ts'), 'utf8');
    // PR4's only allowed tick.ts drift: the recovery seam invocation placed
    // AFTER onActivate and BEFORE the checkpoint, its doc-comment lines, and
    // the widened signature. Reverting all three reproduces the slice-3 tick
    // byte-for-byte.
    const normalized = current
      .replace(PR4_TICK_COMMENT, SLICE3_TICK_COMMENT)
      .replace('  await onRecovery?.(companyId);\n', '')
      .replace(
        'export const tickCompany: TickCompany = async (\n  deps: SupervisorDeps,\n  companyId,\n  onActivate,\n  onRecovery,\n) => {',
        'export const tickCompany: TickCompany = async (deps: SupervisorDeps, companyId, onActivate) => {',
      );
    expect(sha256Of(normalized)).toBe(SLICE3_TICK_BASELINE);
  });

  it('supervisor.ts differs ONLY by the onRecovery threading: stripping it restores the slice-3 supervisor bytes (supervisor-timer delta, design D4)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'supervisor/supervisor.ts'), 'utf8');
    // PR4's only allowed supervisor.ts drift: the 4th tickCompany argument.
    expect(sha256Of(current.replace(', options.onRecovery', ''))).toBe(SLICE3_SUPERVISOR_BASELINE);
  });
});

/**
 * Slice-3 (supervisor-recovery PR 3) committed baseline of
 * `dispatch/dispatch.ts` — the pre-recovery module (dispatchCompanyActivation
 * only). PR 4's ONLY allowed dispatch.ts drift is the ADDITIVE
 * `dispatchRecovery` function + its import.
 */
const DISPATCH_PRE_RECOVERY_BASELINE =
  'b8a0de4642799fa3061432f4bbc49b7d3ac54472cb859e2e28833263de321cd5';

/** Slice-3 committed baselines of the supervisor cores (PR 4 drift documented
 * by the normalization proofs above). */
const SLICE3_TICK_BASELINE = 'aa5ddab3b052933185c37e284045483ea8df2446c6bbc890969bec7478861f25';
const SLICE3_SUPERVISOR_BASELINE =
  '5e7fa7cd205ce02daed6e5efe1d4ec176e02e7075a7f856621ccdff52be123da';

/** The slice-3 (pre-recovery) tick.ts doc comment — the PR4 comment MUST
 * revert to exactly this. */
const SLICE3_TICK_COMMENT =
  '/**\n' +
  ' * One sequential, checkpointed company tick (design "Tick order" — R4-001\n' +
  ' * crash-safety order):\n' +
  ' *\n' +
  ' * 1. require a non-empty `companyId` (ADR-0002) BEFORE any store read;\n' +
  ' * 2. read the stored cursor (or `undefined` on first contact);\n' +
  ' * 3. evaluate the companyId-only `evaluateHeartbeatGate` (read-only, the\n' +
  ' *    UNCHANGED worker-boundary gate — a new caller, never mutated);\n' +
  " * 4. read the stream tail (the supervisor's own read — two reads per tick);\n" +
  ' * 5. append ONE `heartbeat.decision` via `appendIfAbsent` (at-most-once: a\n' +
  ' *    retry with the same unadvanced cursor rebuilds the same eventId and\n' +
  ' *    no-ops; an append failure propagates — the tick fails uncheckpointed);\n' +
  ' * 6. `activate` → `await onActivate?.(companyId)` — SIDE EFFECT FIRST;\n' +
  ' * 7. persist the checkpoint LAST — never before the callback returns.\n' +
  ' *\n' +
  ' * At-least-once delivery (spec "Callback failure leaves the activation\n' +
  ' * retryable"): a crash or throw inside `onActivate` propagates with the cursor\n' +
  ' * UN-advanced (the schedule logs/swallows it), so the next tick re-evaluates\n' +
  ' * the same stream tail and re-invokes the callback. On `no-llm-heartbeat`\n' +
  ' * (no side effect) the checkpoint is upserted directly. `tailCursor([]) ===\n' +
  ' * undefined` → no checkpoint row (defensive; discovered companies have ≥1\n' +
  ' * event). Decision-event appends and cursor writes belong ONLY to the\n' +
  ' * supervisor (Non-Invasive Activation Seam).\n' +
  ' */\n';

/** The PR4 (post-recovery) tick.ts doc comment (adds the recovery seam step). */
const PR4_TICK_COMMENT =
  '/**\n' +
  ' * One sequential, checkpointed company tick (design "Tick order" — R4-001\n' +
  ' * crash-safety order):\n' +
  ' *\n' +
  ' * 1. require a non-empty `companyId` (ADR-0002) BEFORE any store read;\n' +
  ' * 2. read the stored cursor (or `undefined` on first contact);\n' +
  ' * 3. evaluate the companyId-only `evaluateHeartbeatGate` (read-only, the\n' +
  ' *    UNCHANGED worker-boundary gate — a new caller, never mutated);\n' +
  " * 4. read the stream tail (the supervisor's own read — two reads per tick);\n" +
  ' * 5. append ONE `heartbeat.decision` via `appendIfAbsent` (at-most-once: a\n' +
  ' *    retry with the same unadvanced cursor rebuilds the same eventId and\n' +
  ' *    no-ops; an append failure propagates — the tick fails uncheckpointed);\n' +
  ' * 6. `activate` → `await onActivate?.(companyId)` — SIDE EFFECT FIRST;\n' +
  ' * 7. `await onRecovery?.(companyId)` — the recovery pass (supervisor-timer\n' +
  ' *    delta, design D4): runs on BOTH decision branches, exactly once per\n' +
  ' *    company per tick, AFTER activation and BEFORE the checkpoint;\n' +
  ' * 8. persist the checkpoint LAST — never before the callbacks return.\n' +
  ' *\n' +
  ' * At-least-once delivery (spec "Callback failure leaves the activation\n' +
  ' * retryable" + "Recovery failure leaves cursor unadvanced"): a crash or throw\n' +
  ' * inside `onActivate` OR `onRecovery` propagates with the cursor UN-advanced\n' +
  ' * (the schedule logs/swallows it), so the next tick re-evaluates the same\n' +
  ' * stream tail and re-invokes the callback(s). On `no-llm-heartbeat` (no\n' +
  ' * activation side effect) recovery still runs, then the checkpoint is upserted\n' +
  ' * directly. `tailCursor([]) === undefined` → no checkpoint row (defensive;\n' +
  ' * discovered companies have ≥1 event). Decision-event appends, cursor writes,\n' +
  ' * and the recovery writes (marker/journal/undo/resume — a NEW class\n' +
  ' * legitimated by the supervisor-timer delta) belong ONLY to the supervisor\n' +
  ' * within this tick boundary.\n' +
  ' */\n';

/** Brace-match an exported top-level function (including its doc comment and
 * the preceding blank line) and return the full text to strip. */
function removeFunctionBlock(source: string, name: string): string {
  const defStart = source.indexOf(`export async function ${name}(`);
  if (defStart === -1) {
    throw new Error(`byte-identity: ${name} definition not found`);
  }
  const bodyOpen = source.indexOf('{', defStart);
  let depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`byte-identity: ${name} body never closes`);
  }
  const commentStart = source.lastIndexOf('/**', defStart);
  const start = commentStart !== -1 ? commentStart - 1 : defStart; // drop the blank line
  const endPlus = source[end] === '\n' ? end + 1 : end; // drop the trailing line terminator
  return source.slice(start, endPlus);
}
