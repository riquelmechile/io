import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Non-invasive runtime boundary (R6): the daemon capability MUST add no
 * runtime dependency and MUST preserve the verified
 * supervisor/worker/heartbeat/dispatch cores byte-identically. The hashes
 * below pin the COMMITTED baseline (slice 1a `5b6aec6` and prior verified
 * work); any byte drift fails here (RED proof: mutate → FAIL → restore is
 * part of task 2.3). Runtime deps are pinned at the package level.
 */

/** `packages/app/src` — the root every protected source is relative to. */
const SRC_ROOT = resolve(fileURLToPath(new URL('../../src', import.meta.url)));

/** Protected core sources: path relative to SRC_ROOT → pinned SHA-256 (baseline). */
const PROTECTED_SOURCES: Record<string, string> = {
  'supervisor/supervisor.ts': '5e7fa7cd205ce02daed6e5efe1d4ec176e02e7075a7f856621ccdff52be123da',
  'supervisor/tick.ts': 'b8e81aab75232af7fe2cea2329582a113bc710d68fbbed782bc14139294c880d',
  'supervisor/types.ts': '7d795f73e0db4ee26dd302b092b55a366b45cbad6b22101a089bee7c4092c935',
  'worker/worker.ts': 'f20a9403439d9f8b3aa926518febb34e7afc78a4a1a2a61f8786ee044ff49a28',
  'heartbeat/cycle.ts': '9808756b51a37907bfc0b070fbf364c15f028e0ff3e0777abf94af1c90a50e75',
  'heartbeat/evaluate.ts': '56984e32f758e1a17b02937b20658cb91452a016d33331f5b907d806540efbe0',
  'dispatch/dispatch.ts': '848d7a305bb034ad3fa86d3f709af925b73929dc26593aeb335aa208d6034c1b',
  'dispatch/keys.ts': 'b775263af51439182634523973535e3db0487fc0c1bda4723b417824fd7300cb',
  'dispatch/types.ts': '0534731cfa5d4aee04bc7c6d365c9c625fc1b2cf271ac425b712d96fbff81d17',
};

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
