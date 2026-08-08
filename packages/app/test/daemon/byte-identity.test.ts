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
  'supervisor/supervisor.ts': '5e7fa7cd205ce02daed6e5efe1d4ec176e02e7075a7f856621ccdff52be123da',
  'supervisor/tick.ts': 'aa5ddab3b052933185c37e284045483ea8df2446c6bbc890969bec7478861f25',
  'supervisor/types.ts': '0e6a67b80a111e04e6f91d5e3e318b573a05ef60aba06b5f482690d8b75e2948',
  'worker/worker.ts': '948e7c21f3deabe9c10d1461933978b95d034d31b4210ae94795358cbdf30e62',
  'heartbeat/cycle.ts': '9808756b51a37907bfc0b070fbf364c15f028e0ff3e0777abf94af1c90a50e75',
  'heartbeat/evaluate.ts': '56984e32f758e1a17b02937b20658cb91452a016d33331f5b907d806540efbe0',
  'dispatch/dispatch.ts': 'b8a0de4642799fa3061432f4bbc49b7d3ac54472cb859e2e28833263de321cd5',
  'dispatch/keys.ts': 'b775263af51439182634523973535e3db0487fc0c1bda4723b417824fd7300cb',
  'dispatch/types.ts': '0534731cfa5d4aee04bc7c6d365c9c625fc1b2cf271ac425b712d96fbff81d17',
};

/** PR1 (pre-PR2) committed baselines of the two files whose ONLY allowed drift
 * is model-tier threading — used by the normalization proofs below. */
const PR1_TICK_BASELINE = '674c9eb4415e690b6a0cc0b6e553bc6d59322ab93f201beb1ccc7951ea8ce43c';
const PR1_WORKER_BASELINE = 'f20a9403439d9f8b3aa926518febb34e7afc78a4a1a2a61f8786ee044ff49a28';

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

  it('runWorker differs ONLY by the model parameter: stripping the model threading restores the PR1 baseline bytes (ST Seam S2)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'worker/worker.ts'), 'utf8');
    // Normalize away the model-tier threading: the required 3rd arg (biome
    // wraps the long signature), its type-only import, and the `model` field
    // fed to prepareIntent. The result must be byte-identical to the PR1
    // single-line signature baseline.
    const normalized = current
      .replace("import type { ModelTier } from '@io/business-domain/src/index.js';\n", '')
      .replace(
        'export async function runWorker(\n  input: unknown,\n  deps: WorkerDeps,\n  model: ModelTier,\n): Promise<WorkerResult> {',
        'export async function runWorker(input: unknown, deps: WorkerDeps): Promise<WorkerResult> {',
      )
      .replace(/\n {4}model,\n/, '\n');
    expect(sha256Of(normalized)).toBe(PR1_WORKER_BASELINE);
  });

  it('tick.ts threads the tier: stripping decision.model restores the PR1 baseline bytes (ST Seam S2)', () => {
    const current = readFileSync(resolve(SRC_ROOT, 'supervisor/tick.ts'), 'utf8');
    const normalized = current.replace(
      'await onActivate?.(companyId, decision.model);',
      'await onActivate?.(companyId);',
    );
    expect(sha256Of(normalized)).toBe(PR1_TICK_BASELINE);
  });
});
