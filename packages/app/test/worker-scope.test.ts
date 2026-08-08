import { describe, expect, it } from 'vitest';

import { runWorker } from '../src/worker/worker.js';
import {
  acceptedWork,
  activeDelegation,
  harness,
  RecordingSandbox,
  seed,
  workerInput,
} from './worker-helpers.js';

/**
 * B3 — Tenant scope on every worker operation (WC tenant-scope): every op is
 * scoped by a non-empty `companyId`; an empty companyId is rejected; access to
 * another tenant's Work surfaces as not-found, never as the foreign record;
 * every repository/journal/evidenceId op threads the command's companyId.
 */
describe('worker tenant scope (WC tenant-scope)', () => {
  it('an empty companyId is rejected (invalid-command, never processed)', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput({ companyId: '' }), h, 'flash');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-command');
  });

  it('an empty idempotencyKey is rejected (invalid-command)', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput({ idempotencyKey: '' }), h, 'flash');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-command');
  });

  it('wrong-tenant access surfaces as not-found and never returns the foreign record', async () => {
    const h = harness();
    await seed(h); // work-1 belongs to acme

    const result = await runWorker(workerInput({ companyId: 'other-tenant' }), h, 'flash');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    // Tenant A's record stays untouched: no claim, still accepted at version 1.
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.state).toBe('accepted');
    expect(stored?.version).toBe(1);
  });

  it("authority looks up the delegation under the WORK's companyId (never a global lookup)", async () => {
    const h = harness();
    await seed(h);
    // del-1 now belongs to a DIFFERENT tenant than the work: the scoped get must miss.
    await h.delegation.save(activeDelegation({ companyId: 'other-tenant' }));

    const result = await runWorker(workerInput(), h, 'flash');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('denied');
      expect(result.detail).toContain('delegation-not-found');
    }
  });

  it('the same idempotencyKey under two companies stays tenant-isolated (journal + evidenceId scoped)', async () => {
    const h = harness();
    await seed(h); // acme work-1 + del-1
    await h.work.save(
      acceptedWork({ workId: 'work-2', companyId: 'globex', delegationId: 'del-2' }),
    );
    await h.delegation.save(activeDelegation({ companyId: 'globex', delegationId: 'del-2' }));

    // Each tenant runs its own sandbox root; the JOURNAL is the shared harness
    // journal — proving company-scoped keys never collide.
    const first = await runWorker(
      workerInput({ companyId: 'acme', workId: 'work-1' }),
      {
        ...h,
        sandbox: new RecordingSandbox(h.trace),
      },
      'flash',
    );
    const second = await runWorker(
      workerInput({ companyId: 'globex', workId: 'work-2' }),
      {
        ...h,
        sandbox: new RecordingSandbox(h.trace),
      },
      'flash',
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Two independent in-flight rows: company-scoped keys, no cross-tenant collision.
    const rows = h.journal.snapshot();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.companyId).sort()).toEqual(['acme', 'globex']);
    // Distinct stable evidence identities per tenant.
    if (first.ok && second.ok && 'evidenceId' in first && 'evidenceId' in second) {
      expect(first.evidenceId).toBe('ev:acme:close-2026-q3');
      expect(second.evidenceId).toBe('ev:globex:close-2026-q3');
      expect(first.evidenceId).not.toBe(second.evidenceId);
    }
  });
});
