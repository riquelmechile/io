import { describe, expect, it } from 'vitest';

import { CONTEXT_SCHEMA_VERSION, deriveCohort } from '../src/index.js';

/**
 * Cache-cohort derivation (Req R5). `user` MUST be derived as
 * `io:{companyId}:{process}:v{schemaVersion}` — NEVER caller-supplied. The
 * derivation is a pure function of EXACTLY {companyId, process, schemaVersion}:
 * it structurally cannot read work, names, emails, or segments 10–13 (they are
 * not inputs), so cohort peers share policy, privacy, and exact prefix bytes.
 * (The compileContext-level user scenarios land with compileContext in task 4.1.)
 */
describe('cache-cohort derivation — deriveCohort (R5)', () => {
  it('derives the cohort shape io:{companyId}:{process}:v{schemaVersion}', () => {
    expect(deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 2 })).toBe(
      'io:acme:planning:v2',
    );
  });

  it('is a pure function of exactly companyId/process/schemaVersion — no work input exists', () => {
    // Different caller data cannot fragment the cohort: deriveCohort accepts NO
    // work/name/email parameter, so the result depends on cohort inputs only.
    const a = deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 2 });
    const b = deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 2 });
    expect(b).toBe(a);
    expect(a).toBe('io:acme:planning:v2');
  });

  it('excludes personal data — the derived string carries no name/email/work tokens', () => {
    const user = deriveCohort({
      companyId: 'acme',
      process: 'planning',
      schemaVersion: 2,
    });
    expect(user).not.toContain('founder');
    expect(user).not.toContain('@');
    expect(user).not.toContain('work');
    expect(user).toBe('io:acme:planning:v2');
  });

  it('CONTEXT_SCHEMA_VERSION is exported and currently 2 (golden pins v2)', () => {
    expect(CONTEXT_SCHEMA_VERSION).toBe(2);
  });

  it('schema version is part of the derivation — same cohort, different version differs', () => {
    expect(deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 1 })).not.toBe(
      deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 2 }),
    );
  });
});

/**
 * Schema-versioned cohort bump (Req R6 bump). A stable-segment change MUST
 * change schemaVersion and user — vN ≠ vN+1 for identical cohort inputs. The
 * schema version is the SINGLE discriminator: it is part of the derivation and
 * the exported constant must stay coherent with the golden pin (a bump without
 * regenerating the golden file breaks the pin, so a silent prefix change under
 * an existing cohort is impossible).
 */
describe('schema-versioned cohort bump (R6)', () => {
  it('vN ≠ vN+1 — a version bump changes user for identical cohort inputs', () => {
    const v1 = deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 1 });
    const v2 = deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 2 });
    expect(v2).not.toBe(v1);
    expect(v2).toBe('io:acme:planning:v2');
  });

  it('same cohort + same version ⇒ identical user (deterministic, no silent change)', () => {
    const a = deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 3 });
    const b = deriveCohort({ companyId: 'acme', process: 'planning', schemaVersion: 3 });
    expect(b).toBe(a);
    expect(a).toBe('io:acme:planning:v3');
  });

  it('CONTEXT_SCHEMA_VERSION is the version embedded in the current cohort', () => {
    expect(
      deriveCohort({
        companyId: 'acme',
        process: 'planning',
        schemaVersion: CONTEXT_SCHEMA_VERSION,
      }),
    ).toBe(`io:acme:planning:v${CONTEXT_SCHEMA_VERSION}`);
  });
});
