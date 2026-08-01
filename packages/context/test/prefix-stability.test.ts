import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Delegation, Work } from '@io/business-domain/src/index.js';
import { describe, expect, it } from 'vitest';

import type { CompileContextInput } from '../src/index.js';
import { buildStablePrefix, CONTEXT_SCHEMA_VERSION, compileContext } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Byte-stability of the stable prefix (Req R2 both + R6 silent-change). The
 * prefix is the concatenation of PRESENT segments 1–9; it MUST be byte-identical
 * within a cohort and a pure function of cohort inputs ONLY (companyId, process,
 * CONTEXT_SCHEMA_VERSION). Per-delegation detail (expectedOutcome/actions/scope)
 * is NOT a cohort discriminator and MUST NOT change the prefix bytes (R2).
 * Segments 10–13 MUST never leak into those
 * bytes. The golden file pins the exact prefix bytes for CONTEXT_SCHEMA_VERSION=1:
 * any change to the prefix bytes fails the pin until the golden is deliberately
 * regenerated AND the schema version is bumped (R6).
 */
const work: Work = {
  workId: 'work-1',
  companyId: 'acme',
  delegationId: 'delegation-1',
  proposer: 'founder',
  description: 'execute the quarterly close',
  state: 'accepted',
  version: 1,
  evidenceRefs: [],
};

const delegation: Delegation = {
  delegationId: 'delegation-1',
  companyId: 'acme',
  delegator: 'founder',
  delegate: 'worker-1',
  authorityScope: { scope: 'low-risk-documents', actions: ['create-document'] },
  budget: { currency: 'USD', limit: 100 },
  validFrom: 1,
  validUntil: 2,
  expectedOutcome: 'produce a single reversible create-document plan',
  state: 'active',
};

/** Fully-sourced seed: present stable segments are 1 (protocol) and 8 (process). */
const seed: CompileContextInput = { companyId: 'acme', process: 'planning', delegation, work };

describe('stable-prefix byte stability (R2 + R6)', () => {
  it('golden pin: prefix bytes for CONTEXT_SCHEMA_VERSION are frozen', () => {
    const goldenPath = join(here, 'fixtures', `prefix.v${CONTEXT_SCHEMA_VERSION}.golden.txt`);
    const golden = readFileSync(goldenPath, 'utf8');
    expect(buildStablePrefix(seed)).toBe(golden);
  });

  it('same cohort + different work ⇒ byte-identical prefix (work is NOT read)', () => {
    const differentWork: CompileContextInput = {
      ...seed,
      work: {
        workId: 'work-2',
        companyId: 'acme',
        delegationId: 'delegation-2',
        proposer: 'founder',
        description: 'a completely different task with unique markers',
        state: 'in_progress',
        version: 3,
        evidenceRefs: ['ev-99'],
      },
    };
    expect(buildStablePrefix(differentWork)).toBe(buildStablePrefix(seed));
  });

  it('leak guard: unique seg 10–13 values are ABSENT from the prefix', () => {
    const workLeak: CompileContextInput = {
      ...seed,
      work: {
        ...work,
        workId: 'WORK-LEAK-777',
        description: 'SECRET-QUARTERLY-CLOSE',
        evidenceRefs: ['ev-LEAK-1'],
      },
    };
    const prefix = buildStablePrefix(workLeak);
    expect(prefix).not.toContain('WORK-LEAK-777');
    expect(prefix).not.toContain('SECRET-QUARTERLY-CLOSE');
    expect(prefix).not.toContain('ev-LEAK-1');
  });

  it('leak guard: delegation ids and PII never enter the prefix (seg 5 is ABSENT — prefix reads no delegation)', () => {
    const delegationLeak: Delegation = {
      ...delegation,
      delegationId: 'DELEG-LEAK-99',
      delegator: 'founder-name@io.dev',
      delegate: 'worker-email@io.dev',
      expectedOutcome: 'produce a single reversible create-document plan',
    };
    const prefix = buildStablePrefix({ ...seed, delegation: delegationLeak });
    expect(prefix).not.toContain('DELEG-LEAK-99');
    expect(prefix).not.toContain('founder-name@io.dev');
    expect(prefix).not.toContain('worker-email@io.dev');
  });

  it('structural purity: prefix IS a function of process — changing it changes the bytes', () => {
    expect(buildStablePrefix({ ...seed, process: 'close' })).not.toBe(buildStablePrefix(seed));
  });

  it('R2 inverse: same cohort + ANY delegation variation ⇒ byte-identical prefix AND same cohort', () => {
    // The stable prefix MUST be a pure function of the cache cohort
    // {companyId, process, schemaVersion}. Delegation detail (expectedOutcome,
    // actions, scope) is per-request dynamic content — NOT a cohort discriminator
    // (deriveCohort reads only companyId/process/version) — so it MUST NOT change
    // the prefix bytes. Otherwise a cache hit could serve a role contract the
    // current request never supplied (DeepSeek KV-cache poisoning, R2 violation).
    const baseline = compileContext(seed);

    const differentOutcome: CompileContextInput = {
      ...seed,
      delegation: { ...delegation, expectedOutcome: 'a completely different outcome' },
    };
    const differentActions: CompileContextInput = {
      ...seed,
      delegation: {
        ...delegation,
        authorityScope: {
          scope: 'low-risk-documents',
          actions: ['create-document', 'delete-document'],
        },
      },
    };
    const differentScope: CompileContextInput = {
      ...seed,
      delegation: {
        ...delegation,
        authorityScope: { scope: 'high-risk-ledger', actions: ['create-document'] },
      },
    };
    const noDelegation: CompileContextInput = { companyId: 'acme', process: 'planning', work };

    for (const variant of [differentOutcome, differentActions, differentScope, noDelegation]) {
      const compiled = compileContext(variant);
      expect(compiled.messages[0]?.content).toBe(baseline.messages[0]?.content);
      expect(compiled.user).toBe(baseline.user);
    }
    expect(buildStablePrefix(differentOutcome)).toBe(buildStablePrefix(seed));
  });

  it('deterministic (no clock/nonce): same input twice ⇒ byte-identical prefix', () => {
    expect(buildStablePrefix(seed)).toBe(buildStablePrefix(seed));
  });
});
