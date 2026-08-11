import { describe, expect, it } from 'vitest';

import type { Work } from '../../src/types.js';
import { canTransitionWork } from '../../src/transitions.js';
import { InMemoryWorkRepository } from '../../src/ports/fakes.js';
import type { RequestRecoveryCommand } from '../../src/use-cases/request-recovery.js';
import { requestRecovery } from '../../src/use-cases/request-recovery.js';

/**
 * requestRecovery (supervisor-recovery design D2, work-lifecycle "Operator
 * Recovery Designation"): the OPERATOR's designation entry point. Designation
 * is operational repository metadata, NOT a lifecycle transition — the CAS
 * bumps `version` (fencing a stale-version zombie's terminal close) while
 * leaving `state` and the claim `fencing_token` UNCHANGED (plain CAS, no
 * FencingDirective, no token mint). The domain `Work` type stays pure (no
 * `recoveryRequested` field) and `WORK_TRANSITIONS` keeps `in_progress ->
 * ['completed']` as the only outgoing edge. Failures are VALUES, never throws
 * for control flow.
 */

function inProgressWork(overrides: Partial<Work> = {}): Work {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the quarterly close',
    state: 'in_progress',
    version: 2,
    fencingToken: 3,
    evidenceRefs: ['evid-a'],
    ...overrides,
  };
}

function designateCmd(overrides: Partial<RequestRecoveryCommand> = {}): RequestRecoveryCommand {
  return {
    companyId: 'acme',
    actor: 'operator-1',
    workId: 'work-1',
    requested: true,
    ...overrides,
  };
}

function deps(): { work: InMemoryWorkRepository } {
  return { work: new InMemoryWorkRepository() };
}

async function seed(repo: InMemoryWorkRepository, overrides: Partial<Work> = {}): Promise<Work> {
  const work = inProgressWork(overrides);
  await repo.save(work);
  return work;
}

/** Narrow a result to ok; fail loudly (with the reason) if it is not ok. */
function expectOk<T>(
  result: { ok: boolean } & ({ ok: true; value: T } | { ok: false; reason: string }),
): T {
  if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
  return result.value;
}

describe('requestRecovery — designation preserves lifecycle state (S1)', () => {
  it('designates in_progress Work at version N with expected version N: state STAYS in_progress, version becomes N + 1', async () => {
    const d = deps();
    await seed(d.work);

    const value = expectOk(await requestRecovery(designateCmd({ expectedVersion: 2 }), d));

    expect(value.state).toBe('in_progress');
    expect(value.version).toBe(3);
    expect(value.workId).toBe('work-1');

    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
    expect(stored?.version).toBe(3);
  });

  it('a designation WITHOUT an expectedVersion early-out still CASes on the FRESH version (version N → N + 1)', async () => {
    const d = deps();
    await seed(d.work);

    const value = expectOk(await requestRecovery(designateCmd(), d));

    expect(value.state).toBe('in_progress');
    expect(value.version).toBe(3);
  });
});

describe('requestRecovery — designation fences stale-version zombies WITHOUT a new token (S2)', () => {
  it('worker holding version N and token T: designation succeeds, stored version N + 1, token STAYS T', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', version: 4, fencingToken: 7 });

    const value = expectOk(await requestRecovery(designateCmd({ expectedVersion: 4 }), d));

    // The claim token is preserved: designation is NOT a re-claim, no mint.
    expect(value.fencingToken).toBe(7);
    expect(value.version).toBe(5);
    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.fencingToken).toBe(7);
    expect(stored?.version).toBe(5);
  });

  it('a stale version-N close FAILS after designation (version bump is the fence)', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', version: 2, fencingToken: 3 });

    await requestRecovery(designateCmd({ expectedVersion: 2 }), d);

    // The zombie worker still holds version 2: its terminal close CAS at the
    // OLD version must lose (version-conflict) — the stored version is now 3.
    const zombieClose = await d.work.updateIfVersion(
      { ...inProgressWork(), state: 'completed', version: 2 },
      2,
      { kind: 'terminal', expectedFencingToken: 3 },
    );
    expect(zombieClose.ok).toBe(false);
    if (zombieClose.ok === false) {
      expect(zombieClose.reason).toBe('version-conflict');
      expect(zombieClose.current?.version).toBe(3);
    }
    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
    expect(stored?.version).toBe(3);
  });
});

describe('requestRecovery — stale expectedVersion → typed version-conflict (no throw)', () => {
  it('returns {ok:false, reason:version-conflict, current} and leaves the stored work unchanged', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', version: 2 });

    const result = await requestRecovery(designateCmd({ expectedVersion: 1 }), d);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('version-conflict');
      expect(result.current?.version).toBe(2);
      expect(result.current?.state).toBe('in_progress');
    }
    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.version).toBe(2);
  });
});

describe('requestRecovery — command guards', () => {
  it('an empty companyId is rejected (propagates the repository guard, never a silent read)', async () => {
    const d = deps();
    await seed(d.work);

    await expect(requestRecovery(designateCmd({ companyId: '' }), d)).rejects.toThrow(/companyId/i);
  });

  it('a missing workId returns {ok:false, reason:invalid-command}', async () => {
    const d = deps();
    const result = await requestRecovery(
      { ...designateCmd(), workId: '' } as unknown as RequestRecoveryCommand,
      d,
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-command');
  });

  it('an unknown work returns {ok:false, reason:not-found}', async () => {
    const d = deps();
    const result = await requestRecovery(designateCmd({ workId: 'ghost' }), d);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('not-found');
  });
});

describe('requestRecovery — designation targets in_progress ONLY (not a transition)', () => {
  it('a terminal (completed) Work is rejected as invalid-transition — designation is not a lifecycle edge', async () => {
    const d = deps();
    await seed(d.work, { state: 'completed', version: 3 });

    const result = await requestRecovery(designateCmd({ expectedVersion: 3 }), d);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('invalid-transition');
      expect(result.current?.state).toBe('completed');
    }
  });

  it('an accepted Work is rejected as invalid-transition (designation targets orphans)', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });

    const result = await requestRecovery(designateCmd(), d);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-transition');
  });
});

describe('requestRecovery — recovery metadata stays OUTSIDE Work (S3)', () => {
  it('the domain Work type carries NO recoveryRequested field (pure — tsc rejects the moment it appears)', () => {
    // Type-level: this assignment is `never` the day Work gains the field, so
    // tsc fails to compile the file — a compile-time guarantee, not a runtime
    // smoke test.
    const check: 'recoveryRequested' extends keyof Work ? never : true = true;
    expect(check).toBe(true);

    // Runtime complement: the value returned by a successful designation has
    // no marker key (the marker lives only in the repository row + port).
    // A claim token and state round-trip untouched.
  });

  it('a designated Work value exposes exactly the domain fields — no marker leaked through the use case', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', version: 2, fencingToken: 3 });

    const value = expectOk(await requestRecovery(designateCmd(), d));

    expect(Object.keys(value)).not.toContain('recoveryRequested');
    expect(value.state).toBe('in_progress');
    expect(value.version).toBe(3);
    expect(value.fencingToken).toBe(3);
  });

  it('WORK_TRANSITIONS keeps in_progress → [completed] as the ONLY outgoing edge (no recovery edge)', () => {
    // The transition table is module-private; the observable contract is the
    // public guard: `completed` is the ONLY legal target from `in_progress`.
    expect(canTransitionWork('in_progress', 'completed')).toBe(true);
    for (const forbidden of [
      'proposed',
      'accepted',
      'rejected',
      'verified',
      'in_progress',
    ] as const) {
      expect(canTransitionWork('in_progress', forbidden), `in_progress -> ${forbidden}`).toBe(
        false,
      );
    }
  });
});

describe('requestRecovery — unresolved escalation permits explicit re-designation (S4)', () => {
  it('designate → clear → re-designate: each is a fresh operator action, version bumps every time', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', version: 2 });

    // Designate (the operator marks the orphan).
    const designated = expectOk(await requestRecovery(designateCmd(), d));
    expect(designated.version).toBe(3);

    // Recovery resolves to UNRESOLVED_REQUIRES_HUMAN → the flow clears the
    // marker (slice 4 wiring) — the use case exposes the clear operation.
    const cleared = expectOk(await requestRecovery(designateCmd({ requested: false }), d));
    expect(cleared.version).toBe(4);
    expect(cleared.state).toBe('in_progress');

    // A LATER explicit re-designation is a NEW operator action and succeeds.
    const reDesignated = expectOk(await requestRecovery(designateCmd({ requested: true }), d));
    expect(reDesignated.version).toBe(5);
    expect(reDesignated.state).toBe('in_progress');
    expect((await d.work.get('acme', 'work-1'))?.version).toBe(5);
  });
});
