import { describe, expect, it } from 'vitest';

import type { Work } from '../src/types.js';
import type {
  CompleteWorkCommand,
  CompleteWorkDeps,
  ProposeWorkCommand,
  TransitionWorkCommand,
} from '../src/use-cases/index.js';
import {
  acceptWork,
  completeWork,
  proposeWork,
  rejectWork,
  startWork,
  verifyWork,
} from '../src/use-cases/index.js';
import {
  InMemoryBusinessReceiptRepository,
  InMemoryIdempotencyJournalRepository,
  InMemoryWorkRepository,
} from '../src/ports/fakes.js';

/**
 * Transition use-case tests (design D3, work-lifecycle spec "Transition Use
 * Cases Replace Raw Save"). Each use case takes a command + repository PORTS
 * ONLY and returns a typed `UseCaseResult<Work>` — `{ok:true,value}` on a
 * successful get + CAS transition, `{ok:false,reason,current?}` on failure,
 * NEVER a thrown exception for control flow. Raw `save()` is insert-only
 * (creating a NEW work) and is NOT the state-change path for an existing work.
 */

function sampleWork(overrides: Partial<Work> = {}): Work {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the quarterly close',
    state: 'proposed',
    version: 1,
    fencingToken: 0,
    evidenceRefs: ['evid-a'],
    ...overrides,
  };
}

function transitionCmd(overrides: Partial<TransitionWorkCommand> = {}): TransitionWorkCommand {
  return { companyId: 'acme', actor: 'principal-1', workId: 'work-1', ...overrides };
}

/** Fresh in-memory deps for every test: work + receipts repositories + journal. */
function deps(): CompleteWorkDeps & { work: InMemoryWorkRepository } {
  return {
    work: new InMemoryWorkRepository(),
    receipts: new InMemoryBusinessReceiptRepository(),
    journal: new InMemoryIdempotencyJournalRepository(),
  };
}

async function seed(repo: InMemoryWorkRepository, overrides: Partial<Work> = {}): Promise<Work> {
  const work = sampleWork(overrides);
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

describe('proposeWork', () => {
  it('creates a proposed work with version 1, proposer = actor, and the command fields', async () => {
    const d = deps();
    const cmd: ProposeWorkCommand = {
      companyId: 'acme',
      actor: 'principal-2',
      workId: 'work-new',
      delegationId: 'del-1',
      description: 'execute the close',
      evidenceRefs: ['evid-a', 'evid-b'],
    };

    const value = expectOk(await proposeWork(cmd, { work: d.work }));

    expect(value.state).toBe('proposed');
    expect(value.version).toBe(1);
    expect(value.proposer).toBe('principal-2');
    expect(value.companyId).toBe('acme');
    expect(value.delegationId).toBe('del-1');
    expect(value.evidenceRefs).toEqual(['evid-a', 'evid-b']);

    const stored = await d.work.get('acme', 'work-new');
    expect(stored).toEqual(value);
  });

  it('a duplicate workId returns {ok:false, reason:work-already-exists} WITHOUT throwing', async () => {
    const d = deps();
    const cmd: ProposeWorkCommand = {
      companyId: 'acme',
      actor: 'principal-2',
      workId: 'work-1',
      delegationId: 'del-1',
      description: 'execute the close',
    };
    await seed(d.work);

    const result = await proposeWork(cmd, { work: d.work });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('work-already-exists');
    }
  });

  it('a missing workId returns {ok:false, reason:invalid-command}', async () => {
    const d = deps();
    const result = await proposeWork(
      {
        companyId: 'acme',
        actor: 'p',
        delegationId: 'del-1',
        description: 'x',
      } as unknown as ProposeWorkCommand,
      { work: d.work },
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-command');
  });

  it('an empty companyId returns {ok:false, reason:invalid-command} (not work-already-exists)', async () => {
    const d = deps();
    const result = await proposeWork(
      {
        companyId: '',
        actor: 'p',
        workId: 'work-new',
        delegationId: 'del-1',
        description: 'x',
      } as unknown as ProposeWorkCommand,
      { work: d.work },
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-command');
  });
});

describe('acceptWork', () => {
  it('transitions proposed → accepted, version 1 → 2, returns {ok:true,value}', async () => {
    const d = deps();
    await seed(d.work);

    const value = expectOk(await acceptWork(transitionCmd(), { work: d.work }));

    expect(value.state).toBe('accepted');
    expect(value.version).toBe(2);
    expect(value.workId).toBe('work-1');

    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.state).toBe('accepted');
    expect(stored?.version).toBe(2);
  });

  it('a stale expectedVersion returns {ok:false, reason:version-conflict, current} WITHOUT throwing', async () => {
    const d = deps();
    await seed(d.work, { state: 'proposed', version: 2 });

    const result = await acceptWork(transitionCmd({ expectedVersion: 1 }), { work: d.work });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('version-conflict');
      expect(result.current?.version).toBe(2);
      expect(result.current?.state).toBe('proposed');
    }
    // Stored work unchanged.
    expect((await d.work.get('acme', 'work-1'))?.version).toBe(2);
  });

  it('a transition the state machine forbids returns {ok:false, reason:invalid-transition, current}', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });

    const result = await acceptWork(transitionCmd(), { work: d.work });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('invalid-transition');
      expect(result.current?.state).toBe('accepted');
    }
  });

  it('an unknown work returns {ok:false, reason:not-found}', async () => {
    const d = deps();
    const result = await acceptWork(transitionCmd({ workId: 'missing' }), { work: d.work });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('not-found');
  });

  it('a missing workId returns {ok:false, reason:invalid-command}', async () => {
    const d = deps();
    const result = await acceptWork(
      { companyId: 'acme', actor: 'p' } as unknown as TransitionWorkCommand,
      { work: d.work },
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-command');
  });
});

describe('startWork', () => {
  it('transitions accepted → in_progress, version 1 → 2', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });

    const value = expectOk(await startWork(transitionCmd(), { work: d.work }));

    expect(value.state).toBe('in_progress');
    expect(value.version).toBe(2);
    expect((await d.work.get('acme', 'work-1'))?.state).toBe('in_progress');
  });

  it('a claim mints and returns the NEXT server-side fencing token (epoch 0 → 1) (work-lifecycle "Claim mints from the pre-fencing epoch")', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });

    const value = expectOk(await startWork(transitionCmd(), { work: d.work }));

    expect(value.fencingToken).toBe(1);
    expect((await d.work.get('acme', 'work-1'))?.fencingToken).toBe(1);
  });

  it('every fresh claim mints from its OWN epoch 0 → 1 (triangulation: token is per-work, not global)', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });
    await d.work.save({ ...sampleWork({ workId: 'work-2' }), state: 'accepted' });

    const first = expectOk(await startWork(transitionCmd(), { work: d.work }));
    const second = expectOk(await startWork(transitionCmd({ workId: 'work-2' }), { work: d.work }));

    expect(first.fencingToken).toBe(1);
    expect(second.fencingToken).toBe(1);
    expect((await d.work.get('acme', 'work-2'))?.fencingToken).toBe(1);
  });

  it('start on a proposed work is forbidden (invalid-transition)', async () => {
    const d = deps();
    await seed(d.work, { state: 'proposed' });

    const result = await startWork(transitionCmd(), { work: d.work });

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-transition');
  });
});

describe('completeWork (plain, no idempotency key)', () => {
  it('transitions in_progress → completed and merges outcome, deliverable, and evidenceRefs', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', evidenceRefs: ['evid-a'] });
    const cmd: CompleteWorkCommand = {
      ...transitionCmd(),
      outcome: { result: 'closed successfully', success: true },
      deliverable: { description: 'close-report.pdf', format: 'pdf' },
      evidenceRefs: ['evid-b'],
    };

    const value = expectOk(await completeWork(cmd, d));

    expect(value.state).toBe('completed');
    expect(value.version).toBe(2);
    expect(value.outcome).toEqual({ result: 'closed successfully', success: true });
    expect(value.deliverable).toEqual({ description: 'close-report.pdf', format: 'pdf' });
    expect(value.evidenceRefs).toEqual(['evid-a', 'evid-b']);

    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.state).toBe('completed');
    expect(stored?.version).toBe(2);
  });

  it('complete on a proposed work is forbidden (invalid-transition)', async () => {
    const d = deps();
    await seed(d.work, { state: 'proposed' });

    const result = await completeWork(transitionCmd(), d);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-transition');
  });

  it('a claim-owned close with the MATCHING fencingToken succeeds and retains the token (work-lifecycle "Stale token cannot close Work" happy path)', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });
    const claimed = expectOk(await startWork(transitionCmd(), { work: d.work }));
    expect(claimed.fencingToken).toBe(1);

    const cmd: CompleteWorkCommand = {
      ...transitionCmd(),
      fencingToken: claimed.fencingToken,
      outcome: { result: 'closed', success: true },
    };
    const value = expectOk(await completeWork(cmd, d));

    expect(value.state).toBe('completed');
    expect(value.fencingToken).toBe(1);
    expect((await d.work.get('acme', 'work-1'))?.state).toBe('completed');
  });

  it('a claim-owned close with a STALE fencingToken is rejected as fencing-conflict and Work is unchanged (work-lifecycle "Stale token cannot close Work")', async () => {
    const d = deps();
    await seed(d.work, { state: 'accepted' });
    const claimed = expectOk(await startWork(transitionCmd(), { work: d.work }));
    expect(claimed.fencingToken).toBe(1);

    const cmd: CompleteWorkCommand = {
      ...transitionCmd(),
      fencingToken: 0, // stale — the work is owned by token 1
      outcome: { result: 'closed', success: true },
    };
    const result = await completeWork(cmd, d);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('fencing-conflict');
      expect(result.current?.fencingToken).toBe(1);
    }
    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
    expect(stored?.fencingToken).toBe(1);
  });

  it('a claim-owned close WITHOUT a fencingToken stays version-only (plain admin close is unaffected)', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress', fencingToken: 0 });

    const value = expectOk(
      await completeWork({ ...transitionCmd(), outcome: { result: 'closed', success: true } }, d),
    );

    expect(value.state).toBe('completed');
    expect(value.fencingToken).toBe(0);
  });
});

describe('verifyWork', () => {
  it('transitions completed → verified, version 1 → 2', async () => {
    const d = deps();
    await seed(d.work, { state: 'completed' });

    const value = expectOk(await verifyWork(transitionCmd(), { work: d.work }));

    expect(value.state).toBe('verified');
    expect(value.version).toBe(2);
    expect((await d.work.get('acme', 'work-1'))?.state).toBe('verified');
  });

  it('verify on an in_progress work is forbidden (invalid-transition)', async () => {
    const d = deps();
    await seed(d.work, { state: 'in_progress' });

    const result = await verifyWork(transitionCmd(), { work: d.work });

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-transition');
  });
});

describe('rejectWork', () => {
  it('transitions proposed → rejected, version 1 → 2', async () => {
    const d = deps();
    await seed(d.work, { state: 'proposed' });

    const value = expectOk(await rejectWork(transitionCmd(), { work: d.work }));

    expect(value.state).toBe('rejected');
    expect(value.version).toBe(2);
    expect((await d.work.get('acme', 'work-1'))?.state).toBe('rejected');
  });

  it('transitions completed → rejected (triangulation: reject is legal from completed)', async () => {
    const d = deps();
    await seed(d.work, { state: 'completed' });

    const value = expectOk(await rejectWork(transitionCmd(), { work: d.work }));

    expect(value.state).toBe('rejected');
    expect(value.version).toBe(2);
  });

  it('a terminal (verified) work rejects all further transitions', async () => {
    const d = deps();
    await seed(d.work, { state: 'verified' });

    const result = await verifyWork(transitionCmd(), { work: d.work });

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-transition');
  });
});

describe('raw save() is not the transition path', () => {
  it('state changes go through the use case (get + CAS); a raw save of an existing work is rejected and mutates nothing', async () => {
    const d = deps();
    const work = await seed(d.work, { state: 'proposed' });

    const value = expectOk(await acceptWork(transitionCmd(), { work: d.work }));
    expect(value.state).toBe('accepted');
    expect(value.version).toBe(2);

    // Raw save() is INSERT-only: re-saving an existing workId must be rejected
    // (mirrors uq_work_work_id) — it can never be the state-change path.
    await expect(d.work.save({ ...work, state: 'in_progress' })).rejects.toThrow(/already/i);

    const stored = await d.work.get('acme', 'work-1');
    expect(stored?.state).toBe('accepted');
    expect(stored?.version).toBe(2);
  });
});
