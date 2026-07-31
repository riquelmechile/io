import { describe, expect, it } from 'vitest';

import {
  acceptWork,
  completeWork,
  IdempotencyConflictError,
  InMemoryIdempotencyStore,
  InMemoryWorkRepository,
  proposeWork,
  rejectWork,
  startWork,
  ValidationError,
  verifyWork,
  type WorkUseCaseDeps,
} from '../src/index.js';

function deps(overrides: Partial<WorkUseCaseDeps> = {}): WorkUseCaseDeps {
  return {
    workRepo: new InMemoryWorkRepository(),
    tx: {
      runInTransaction: async (fn) => fn(),
    },
    ...overrides,
  };
}

describe('proposeWork', () => {
  it('creates Work in proposed at version 0', async () => {
    const d = deps();
    const result = await proposeWork(d, {
      companyId: 'acme',
      workId: 'w1',
      delegationId: 'd1',
      proposer: 'p1',
      description: 'close Q4',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.work.state).toBe('proposed');
    expect(result.work.version).toBe(0);
    expect(result.work.companyId).toBe('acme');
    const got = await d.workRepo.get('w1', 'acme');
    expect(got).toEqual(result.work);
  });

  it('rejects invalid command', async () => {
    const d = deps();
    await expect(
      proposeWork(d, {
        companyId: '',
        workId: 'w1',
        delegationId: 'd1',
        proposer: 'p1',
        description: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('transition use cases', () => {
  async function proposed(d: WorkUseCaseDeps) {
    await proposeWork(d, {
      companyId: 'acme',
      workId: 'w1',
      delegationId: 'd1',
      proposer: 'p1',
      description: 'task',
    });
  }

  it('acceptWork moves proposed -> accepted and bumps version', async () => {
    const d = deps();
    await proposed(d);
    const result = await acceptWork(d, {
      companyId: 'acme',
      workId: 'w1',
      principalId: 'p2',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.work.state).toBe('accepted');
    expect(result.work.version).toBe(1);
  });

  it('startWork then completeWork then verifyWork happy path', async () => {
    const d = deps();
    await proposed(d);
    await acceptWork(d, { companyId: 'acme', workId: 'w1', principalId: 'p2' });
    await startWork(d, { companyId: 'acme', workId: 'w1', principalId: 'p3' });
    await completeWork(d, {
      companyId: 'acme',
      workId: 'w1',
      principalId: 'p3',
      outcome: { result: 'done', success: true },
    });
    const verified = await verifyWork(d, { companyId: 'acme', workId: 'w1', principalId: 'p4' });
    expect(verified.status).toBe('ok');
    if (verified.status !== 'ok') return;
    expect(verified.work.state).toBe('verified');
    expect(verified.work.version).toBe(4);
  });

  it('rejectWork from proposed', async () => {
    const d = deps();
    await proposed(d);
    const result = await rejectWork(d, {
      companyId: 'acme',
      workId: 'w1',
      principalId: 'p2',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.work.state).toBe('rejected');
  });

  it('illegal transition verify from accepted is rejected and not persisted', async () => {
    const d = deps();
    await proposed(d);
    await acceptWork(d, { companyId: 'acme', workId: 'w1', principalId: 'p2' });
    await expect(
      verifyWork(d, { companyId: 'acme', workId: 'w1', principalId: 'p4' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const got = await d.workRepo.get('w1', 'acme');
    expect(got?.state).toBe('accepted');
    expect(got?.version).toBe(1);
  });

  it('self-approval denied when evaluate returns DENY — no persist', async () => {
    const record = {
      actionId: 'a',
      principalId: 'p1',
      riskClass: 'low' as const,
      decision: 'DENY' as const,
      reason: 'sod',
      timestamp: 1,
      persistent: false as const,
      disclosure: 'x',
    };
    const d = deps({
      evaluate: async () => ({
        decision: 'DENY',
        reason: 'separation of duties violated: proposer/approver share a principal',
        risk: 'low',
        steps: [],
        evidence: record,
        auditLog: [record],
      }),
    });
    await proposed(d);
    const result = await acceptWork(d, {
      companyId: 'acme',
      workId: 'w1',
      principalId: 'p1',
      evaluation: {} as never,
    });
    expect(result.status).toBe('denied');
    const got = await d.workRepo.get('w1', 'acme');
    expect(got?.state).toBe('proposed');
    expect(got?.version).toBe(0);
  });
});

describe('idempotency', () => {
  it('same key + same hash replays prior result', async () => {
    const store = new InMemoryIdempotencyStore();
    const d = deps({ idempotency: store });
    const cmd = {
      companyId: 'acme',
      workId: 'w1',
      delegationId: 'd1',
      proposer: 'p1',
      description: 'task',
      idempotencyKey: 'k1',
      requestHash: 'h1',
    };
    const first = await proposeWork(d, cmd);
    const second = await proposeWork(d, cmd);
    expect(first.status).toBe('ok');
    expect(second.status).toBe('replay');
    if (first.status === 'ok' && second.status === 'replay') {
      expect(second.work).toEqual(first.work);
    }
  });

  it('same key + different hash throws IdempotencyConflictError', async () => {
    const store = new InMemoryIdempotencyStore();
    const d = deps({ idempotency: store });
    await proposeWork(d, {
      companyId: 'acme',
      workId: 'w1',
      delegationId: 'd1',
      proposer: 'p1',
      description: 'task',
      idempotencyKey: 'k1',
      requestHash: 'h1',
    });
    await expect(
      proposeWork(d, {
        companyId: 'acme',
        workId: 'w2',
        delegationId: 'd1',
        proposer: 'p1',
        description: 'other',
        idempotencyKey: 'k1',
        requestHash: 'h2',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
