import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '@io/business-domain/src/index.js';
import type { CompleteWorkCommand, CompleteWorkDeps } from '@io/business-domain/src/index.js';
import { completeWork } from '@io/business-domain/src/index.js';
import { evidenceId } from '@io/business-domain/src/index.js';
import { InMemoryCompanyRepository } from '@io/business-domain/src/index.js';

import { PgBusinessReceiptRepository } from '../src/business-receipt-adapter.js';
import { PgCompanyRepository } from '../src/company-adapter.js';
import { PgDelegationRepository } from '../src/delegation-adapter.js';
import { PgWorkRepository } from '../src/work-adapter.js';
import { PgIdempotencyJournalRepository } from '../src/idempotency-adapter.js';
import { completeWorkAtomically } from '../src/complete-work-flow.js';
import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';

import { InMemoryDbConnection } from './connection-fake.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_001 = join(pkgRoot, 'sql', '001_create_tables.sql');
const SCHEMA_002 = join(pkgRoot, 'sql', '002_create_business_tables.sql');
const SCHEMA_003 = join(pkgRoot, 'sql', '003_harden_columns.sql');
const SCHEMA_004 = join(pkgRoot, 'sql', '004_harden_constraints.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for all four business-domain
 * aggregates (design §Testing Strategy) plus the Slice B concurrency surface.
 * Connects to live PG 18.4 via PgDbConnection, applies the shipped schema DDL
 * (001 → 002 → 003 → 004, in order), and round-trips each type through
 * save→get, asserting byte-identical field-level equality including JSONB
 * nested objects and nullable fields. Slice B additions covered here:
 *   - transaction(): commit persists, error rolls back with NO partial write,
 *     nesting throws (D1, spec scenarios) — live PG.
 *   - the InMemoryDbConnection fake produces the SAME observable outcomes as
 *     live PG for those transaction scenarios (spec scenario: fake mirrors PG).
 *   - connection-string isolation: two PgDbConnection instances targetting
 *     different databases affect only their own (scratch DB io_dev_iso).
 *   - Work CAS updateIfVersion: success N→N+1, stale → version-conflict with
 *     current, and concurrent writers ⇒ exactly one winner (D4).
 *   - Work save is INSERT-only: uq_work_work_id rejects a duplicate workId.
 *   - BusinessReceipt single issuance: uq_receipt_receipt_id rejects a
 *     duplicate receiptId; uq_receipt_work_terminal rejects a second receipt
 *     for the same (work_id, terminal_event_id) with a different receiptId.
 *   - idempotency_journal (004): usable, UNIQUE(attempt_id) and UNIQUE
 *     (company_id, idempotency_key) enforced (the LOGIC is Slice C).
 * State is isolated via TRUNCATE in beforeEach. The whole suite is SKIPPED when
 * no live PG is reachable.
 */

async function pgReachable(): Promise<boolean> {
  const probe = new PgDbConnection(pgConnectionString());
  try {
    await probe.execute('SELECT 1', []);
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const reachable = await pgReachable();

describe.skipIf(!reachable)('integration: real PG business-domain round-trip', () => {
  let conn!: PgDbConnection;
  let companyRepo!: PgCompanyRepository;
  let delegationRepo!: PgDelegationRepository;
  let workRepo!: PgWorkRepository;
  let receiptRepo!: PgBusinessReceiptRepository;

  beforeAll(async () => {
    conn = new PgDbConnection(pgConnectionString());
    await conn.execute(readFileSync(SCHEMA_001, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_002, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_003, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_004, 'utf8'), []);
    companyRepo = new PgCompanyRepository(conn);
    delegationRepo = new PgDelegationRepository(conn);
    workRepo = new PgWorkRepository(conn);
    receiptRepo = new PgBusinessReceiptRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute(
      'TRUNCATE company, delegation, work, business_receipt, idempotency_journal RESTART IDENTITY',
      [],
    );
  });

  afterAll(async () => {
    await conn?.close();
  });

  function sampleCompany(): Company {
    return { companyId: 'acme-corp', purpose: 'global tenant scope' };
  }

  function sampleDelegation(): Delegation {
    return {
      delegationId: 'del-001',
      companyId: 'acme-corp',
      delegator: 'principal-1',
      delegate: 'principal-2',
      authorityScope: { scope: 'finance', actions: ['approve', 'reject', 'view'] },
      budget: { currency: 'USD', limit: 250000 },
      validFrom: 1700000000000,
      validUntil: 1800000000000,
      expectedOutcome: 'quarterly report filed and approved',
      state: 'active',
    };
  }

  function sampleWork(): Work {
    return {
      workId: 'work-001',
      companyId: 'acme-corp',
      delegationId: 'del-001',
      proposer: 'principal-2',
      description: 'execute the Q4 financial close',
      state: 'completed',
      version: 1,
      evidenceRefs: ['evid-1', 'evid-2', 'evid-3'],
      deliverable: { description: 'q4-close-report.pdf', format: 'pdf' },
      outcome: { result: 'closed successfully', success: true },
    };
  }

  function sampleReceipt(): BusinessReceipt {
    return {
      receiptId: 'receipt-001',
      companyId: 'acme-corp',
      workId: 'work-001',
      delegationId: 'del-001',
      actor: 'principal-2',
      policyHash: 'sha256:abc123def456',
      evidenceRefs: ['evid-1', 'evid-2', 'evid-3'],
      terminalState: 'verified',
      terminalEventId: 'attempt-001',
      artifactHash: 'sha256:artifact-hash-789',
      issuedAt: 1750000000000,
    };
  }

  describe('Company save → get', () => {
    it('round-trips byte-identically', async () => {
      const company = sampleCompany();
      await companyRepo.save(company);
      const got = await companyRepo.get(company.companyId);
      expect(got).toEqual(company);
    });

    it('get(unknown) returns undefined', async () => {
      expect(await companyRepo.get('nonexistent')).toBeUndefined();
    });
  });

  describe('Company empty-companyId guard — live PG matches the fake (parity)', () => {
    it('PG save rejects an empty companyId, exactly like the fake', async () => {
      const pgError = await companyRepo
        .save({ companyId: '', purpose: 'no tenant' })
        .then(() => undefined)
        .catch((error: Error) => error);
      const fakeError = await new InMemoryCompanyRepository()
        .save({ companyId: '', purpose: 'no tenant' })
        .then(() => undefined)
        .catch((error: Error) => error);

      expect(pgError).toBeInstanceOf(Error);
      expect(fakeError).toBeInstanceOf(Error);
      expect(pgError?.message).toBe('a non-empty companyId is required');
      expect(pgError?.message).toBe(fakeError?.message); // same shape, same message
    });

    it('PG get rejects an empty companyId, exactly like the fake', async () => {
      const pgError = await companyRepo
        .get('')
        .then(() => undefined)
        .catch((error: Error) => error);
      const fakeError = await new InMemoryCompanyRepository()
        .get('')
        .then(() => undefined)
        .catch((error: Error) => error);

      expect(pgError).toBeInstanceOf(Error);
      expect(fakeError).toBeInstanceOf(Error);
      expect(pgError?.message).toBe('a non-empty companyId is required');
      expect(pgError?.message).toBe(fakeError?.message);
    });
  });

  describe('Delegation save → get', () => {
    it('round-trips byte-identically including nested JSONB', async () => {
      const delegation = sampleDelegation();
      await delegationRepo.save(delegation);
      const got = await delegationRepo.get(delegation.companyId, delegation.delegationId);
      expect(got).toEqual(delegation);
      expect(got?.authorityScope).toEqual({
        scope: 'finance',
        actions: ['approve', 'reject', 'view'],
      });
      expect(got?.budget).toEqual({ currency: 'USD', limit: 250000 });
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      expect(await delegationRepo.get('acme-corp', 'nonexistent')).toBeUndefined();
    });
  });

  describe('Work save → get', () => {
    it('round-trips with deliverable and outcome present', async () => {
      const w = sampleWork();
      await workRepo.save(w);
      const got = await workRepo.get(w.companyId, w.workId);
      expect(got).toEqual(w);
      expect(got?.deliverable).toEqual({ description: 'q4-close-report.pdf', format: 'pdf' });
      expect(got?.outcome).toEqual({ result: 'closed successfully', success: true });
      expect(got?.evidenceRefs).toEqual(['evid-1', 'evid-2', 'evid-3']);
    });

    it('round-trips without deliverable/outcome (nullable JSONB → undefined)', async () => {
      const w: Work = {
        workId: 'work-minimal',
        companyId: 'acme-corp',
        delegationId: 'del-001',
        proposer: 'principal-2',
        description: 'minimal work item',
        state: 'proposed',
        version: 1,
        evidenceRefs: [],
      };
      await workRepo.save(w);
      const got = await workRepo.get('acme-corp', 'work-minimal');
      expect(got).toEqual(w);
      expect(got?.deliverable).toBeUndefined();
      expect(got?.outcome).toBeUndefined();
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      expect(await workRepo.get('acme-corp', 'nonexistent')).toBeUndefined();
    });

    it('save is INSERT-only — uq_work_work_id rejects a duplicate workId', async () => {
      const w = sampleWork();
      await workRepo.save(w);
      // Second save of the SAME workId: uq_work_work_id (004) must reject it —
      // raw save() is not the state-change path for an existing work (D4).
      await expect(workRepo.save({ ...w, state: 'in_progress' })).rejects.toThrow(
        /duplicate key|unique/i,
      );
      const stored = await workRepo.get(w.companyId, w.workId);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(1);
    });
  });

  describe('Work CAS updateIfVersion (D4) — live PG', () => {
    it('successful CAS bumps the stored version N → N+1', async () => {
      const w = sampleWork();
      await workRepo.save(w);

      const result = await workRepo.updateIfVersion({ ...w, state: 'in_progress' }, 1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe(2);
        expect(result.value.state).toBe('in_progress');
      }
      expect((await workRepo.get('acme-corp', 'work-001'))?.version).toBe(2);
    });

    it('stale expectedVersion yields version-conflict with current, stored work unchanged', async () => {
      const w = sampleWork();
      await workRepo.save(w);

      const result = await workRepo.updateIfVersion({ ...w, state: 'in_progress' }, 99);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('version-conflict');
        expect(result.current?.version).toBe(1);
        expect(result.current?.state).toBe('completed');
      }
      expect((await workRepo.get('acme-corp', 'work-001'))?.state).toBe('completed');
    });

    it('concurrent writers: exactly one wins, the other gets version-conflict', async () => {
      const w = sampleWork();
      await workRepo.save(w);

      // Two genuine concurrent writers (two pooled clients, same expected
      // version). The row lock serializes them; the loser's WHERE version=$1
      // matches 0 rows after the winner commits.
      const [winner, loser] = await Promise.all([
        workRepo.updateIfVersion({ ...w, state: 'in_progress' }, 1),
        workRepo.updateIfVersion({ ...w, state: 'rejected' }, 1),
      ]);

      const oks = [winner, loser].filter((result) => result.ok === true);
      const conflicts = [winner, loser].filter(
        (result) => result.ok === false && result.reason === 'version-conflict',
      );
      expect(oks).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      // The stored work reflects the winner's write, version N+1.
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.version).toBe(2);
    });
  });

  describe('BusinessReceipt save → get', () => {
    it('round-trips byte-identically including terminalEventId', async () => {
      const receipt = sampleReceipt();
      await receiptRepo.save(receipt);
      const got = await receiptRepo.get(receipt.companyId, receipt.receiptId);
      expect(got).toEqual(receipt);
      expect(got?.evidenceRefs).toEqual(['evid-1', 'evid-2', 'evid-3']);
      expect(got?.terminalState).toBe('verified');
      expect(got?.terminalEventId).toBe('attempt-001');
    });

    it('single issuance — uq_receipt_receipt_id rejects a duplicate receiptId', async () => {
      const receipt = sampleReceipt();
      await receiptRepo.save(receipt);
      const original = await receiptRepo.get(receipt.companyId, receipt.receiptId);
      expect(original).toEqual(receipt);

      // A second save with the SAME receiptId (even different payload) MUST be
      // rejected by uq_receipt_receipt_id (004) — single issuance, no re-issue.
      await expect(
        receiptRepo.save({ ...receipt, terminalEventId: 'attempt-002' }),
      ).rejects.toThrow(/duplicate key|unique/i);
      const unchanged = await receiptRepo.get(receipt.companyId, receipt.receiptId);
      expect(unchanged).toEqual(receipt);
    });

    it('uq_receipt_work_terminal rejects a second receipt for the same (work_id, terminal_event_id) with a DIFFERENT receiptId', async () => {
      const receipt = sampleReceipt();
      await receiptRepo.save(receipt);

      const second: BusinessReceipt = {
        ...receipt,
        receiptId: 'receipt-002', // different receiptId — still rejected
      };
      await expect(receiptRepo.save(second)).rejects.toThrow(/duplicate key|unique/i);

      const original = await receiptRepo.get('acme-corp', 'receipt-001');
      expect(original).toEqual(receipt);
      expect(await receiptRepo.get('acme-corp', 'receipt-002')).toBeUndefined();
    });

    it('the SAME work with a DIFFERENT terminal event is allowed (triangulation)', async () => {
      await receiptRepo.save(sampleReceipt());
      const second: BusinessReceipt = {
        ...sampleReceipt(),
        receiptId: 'receipt-002',
        terminalEventId: 'attempt-002',
      };
      await expect(receiptRepo.save(second)).resolves.toEqual(second);
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      expect(await receiptRepo.get('acme-corp', 'nonexistent')).toBeUndefined();
    });
  });

  describe('transaction() — D1 live PG', () => {
    it('COMMIT persists the insert for later reads outside the transaction', async () => {
      await conn.transaction(async (tx) => {
        await new PgCompanyRepository(tx).save(sampleCompany());
      });
      expect(await companyRepo.get('acme-corp')).toEqual(sampleCompany());
    });

    it('error rolls back with NO partial write, and rethrows the original error', async () => {
      const boom = new Error('boom inside tx');
      await expect(
        conn.transaction(async (tx) => {
          await new PgCompanyRepository(tx).save(sampleCompany());
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(await companyRepo.get('acme-corp')).toBeUndefined();
    });

    it('a transaction on the tx-scoped connection throws (nesting forbidden)', async () => {
      await conn.transaction(async (tx) => {
        await expect(tx.transaction(async () => 1)).rejects.toThrow(/nested/i);
      });
    });
  });

  describe('fake mirrors PostgreSQL transaction semantics (spec scenario 4, literal)', () => {
    it('fake and live PG produce the same observable outcomes for commit / rollback / nesting', async () => {
      const fake = new InMemoryDbConnection();

      // 1) COMMIT persists for later reads.
      await fake.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['c']);
      });
      await conn.transaction(async (tx) => {
        await tx.execute(
          'INSERT INTO company (company_id, purpose, created_at) VALUES ($1,$2,$3)',
          ['mirror-c', 'p', Date.now()],
        );
      });
      const fakeCommitted = await fake.query<{ a: string }>('SELECT a FROM t WHERE a = $1', ['c']);
      const pgCommitted = await companyRepo.get('mirror-c');
      expect(fakeCommitted).toEqual([{ a: 'c' }]);
      expect(pgCommitted?.companyId).toBe('mirror-c');

      // 2) ROLLBACK leaves no partial write, original error rethrown.
      const fakeBoom = new Error('fake boom');
      await expect(
        fake.transaction(async (tx) => {
          await tx.execute('INSERT INTO t (a) VALUES ($1)', ['p']);
          throw fakeBoom;
        }),
      ).rejects.toBe(fakeBoom);
      const pgBoom = new Error('pg boom');
      await expect(
        conn.transaction(async (tx) => {
          await new PgCompanyRepository(tx).save(sampleCompany());
          throw pgBoom;
        }),
      ).rejects.toBe(pgBoom);
      expect(await fake.query<{ a: string }>('SELECT a FROM t WHERE a = $1', ['p'])).toEqual([]);
      expect(await companyRepo.get('acme-corp')).toBeUndefined();

      // 3) Nesting throws on the tx-scoped connection.
      await fake.transaction(async (tx) => {
        await expect(tx.transaction(async () => 1)).rejects.toThrow(/nested/i);
      });
      await conn.transaction(async (tx) => {
        await expect(tx.transaction(async () => 1)).rejects.toThrow(/nested/i);
      });
    });
  });

  describe('connection string drives the pool (spec scenario: conn-string isolation)', () => {
    it('two PgDbConnection instances from different connection strings affect only their own database', async () => {
      // Scratch database on the SAME server; the io role is superuser in the
      // dev container. Created here and dropped after — the write must NOT
      // leak across databases.
      const isoName = 'io_dev_iso';
      const isoUrl = `postgresql://io:io_dev@localhost:5432/${isoName}`;
      const dbs = await conn.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE datname = $1',
        [isoName],
      );
      if (dbs.length === 0) {
        await conn.execute('CREATE DATABASE io_dev_iso', []);
      }

      const isoConn = new PgDbConnection(isoUrl);
      try {
        await isoConn.execute(readFileSync(SCHEMA_001, 'utf8'), []);

        // Write into io_dev_iso only.
        await isoConn.execute(
          'INSERT INTO evidence (action_id, principal_id, risk_class, decision, reason, timestamp, persistent, disclosure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          ['iso-only', 'p', 'low', 'ALLOW', 'isolation probe', 1, true, 'x'],
        );
        // The main io_dev connection MUST NOT see it.
        const mainView = await conn.query<{ action_id: string }>(
          'SELECT action_id FROM evidence WHERE action_id = $1',
          ['iso-only'],
        );
        expect(mainView).toEqual([]);

        // And io_dev writes must not leak into io_dev_iso: write to io_dev
        // via the pool, read back through the isolation connection.
        await conn.execute(
          'INSERT INTO evidence (action_id, principal_id, risk_class, decision, reason, timestamp, persistent, disclosure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          ['main-only', 'p', 'low', 'ALLOW', 'isolation probe', 1, true, 'x'],
        );
        const isoView = await isoConn.query<{ action_id: string }>(
          'SELECT action_id FROM evidence WHERE action_id = $1',
          ['main-only'],
        );
        expect(isoView).toEqual([]);
      } finally {
        await isoConn.close();
        await conn.execute('DROP DATABASE IF EXISTS io_dev_iso WITH (FORCE)', []);
      }
    });
  });

  describe('idempotency_journal (004, D6) — table usable, uniques enforced', () => {
    it('round-trips a journal row', async () => {
      await conn.execute(
        'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, result_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        ['acme-corp', 'key-1', 'hash-1', 'attempt-1', 'in_flight', null, Date.now()],
      );
      const rows = await conn.query<{ attempt_id: string; status: string }>(
        'SELECT attempt_id, status FROM idempotency_journal WHERE attempt_id = $1',
        ['attempt-1'],
      );
      expect(rows).toEqual([{ attempt_id: 'attempt-1', status: 'in_flight' }]);
    });

    it('UNIQUE(attempt_id) rejects a duplicate attempt', async () => {
      const insert = async (attemptId: string): Promise<void> => {
        await conn.execute(
          'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          ['acme-corp', `key-${attemptId}`, 'hash', attemptId, 'in_flight', Date.now()],
        );
      };
      await insert('attempt-dup');
      await expect(insert('attempt-dup')).rejects.toThrow(/duplicate key|unique/i);
    });

    it('UNIQUE(company_id, idempotency_key) rejects a duplicate key per company, allows across companies', async () => {
      const insert = (companyId: string): Promise<unknown> =>
        conn.execute(
          'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [companyId, 'same-key', 'hash', `attempt-${companyId}`, 'in_flight', Date.now()],
        );
      await insert('acme-corp');
      await expect(insert('acme-corp')).rejects.toThrow(/duplicate key|unique/i);
      await expect(insert('other-corp')).resolves.toBeDefined();
    });
  });

  describe('TRUNCATE isolation', () => {
    it('starts each test with empty tables', async () => {
      expect(await companyRepo.get('acme-corp')).toBeUndefined();
      expect(await delegationRepo.get('acme-corp', 'del-001')).toBeUndefined();
      expect(await workRepo.get('acme-corp', 'work-001')).toBeUndefined();
      expect(await receiptRepo.get('acme-corp', 'receipt-001')).toBeUndefined();
    });
  });

  describe('idempotent complete-work — atomic terminal close (D6) — live PG', () => {
    /** A work in_progress at version 2, ready for the terminal close. */
    async function seedInProgress(): Promise<Work> {
      const w: Work = {
        ...sampleWork(),
        state: 'in_progress',
        version: 2,
        evidenceRefs: ['evid-1'],
      };
      await workRepo.save(w);
      return w;
    }

    function closeCmd(overrides: Partial<CompleteWorkCommand> = {}): CompleteWorkCommand {
      return {
        companyId: 'acme-corp',
        actor: 'principal-2',
        workId: 'work-001',
        idempotencyKey: 'close-key-1',
        requestHash: 'hash-1',
        policyHash: 'sha256:policy-hash-123',
        artifactHash: 'sha256:artifact-hash-789',
        outcome: { result: 'closed successfully', success: true },
        evidenceRefs: ['evid-2'],
        ...overrides,
      };
    }

    it('fresh key: completes the work, issues the receipt (terminal_event_id = attempt id + stable evidence id), and closes the journal — one tx', async () => {
      await seedInProgress();

      const result = await completeWorkAtomically(conn, closeCmd());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('completed');
        expect(result.value.version).toBe(3);
        expect(result.value.evidenceRefs).toEqual(['evid-1', 'evid-2']);
      }
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(3);

      const receipt = await receiptRepo.get('acme-corp', 'rcpt:att:acme-corp:close-key-1');
      expect(receipt).toBeDefined();
      expect(receipt?.terminalEventId).toBe('att:acme-corp:close-key-1');
      expect(receipt?.terminalState).toBe('completed');
      expect(receipt?.actor).toBe('principal-2');
      expect(receipt?.evidenceRefs).toContain(evidenceId('acme-corp', 'close-key-1'));

      const journal = await conn.query<{ status: string; request_hash: string }>(
        'SELECT status, request_hash FROM idempotency_journal WHERE attempt_id = $1',
        ['att:acme-corp:close-key-1'],
      );
      expect(journal).toEqual([{ status: 'completed', request_hash: 'hash-1' }]);
    });

    it('replay: the SAME key + hash returns the stored result WITHOUT re-running the effect', async () => {
      await seedInProgress();
      const first = await completeWorkAtomically(conn, closeCmd());
      expect(first.ok).toBe(true);

      const second = await completeWorkAtomically(conn, closeCmd());

      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.value.state).toBe('completed');
        expect(second.value.version).toBe(3); // NOT 4 — no re-execution.
      }
      // Exactly one journal row, one receipt — no second attempt recorded.
      const journalRows = await conn.query<{ attempt_id: string }>(
        'SELECT attempt_id FROM idempotency_journal',
        [],
      );
      expect(journalRows).toEqual([{ attempt_id: 'att:acme-corp:close-key-1' }]);
      expect(await workRepo.get('acme-corp', 'work-001')).toMatchObject({
        state: 'completed',
        version: 3,
      });
    });

    it('DENY: the SAME key with a DIFFERENT request hash is rejected as idempotency-conflict', async () => {
      await seedInProgress();
      await completeWorkAtomically(conn, closeCmd());

      const result = await completeWorkAtomically(
        conn,
        closeCmd({ requestHash: 'hash-DIFFERENT' }),
      );

      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toBe('idempotency-conflict');
      // Nothing new was written.
      const journalRows = await conn.query<{ attempt_id: string }>(
        'SELECT attempt_id FROM idempotency_journal',
        [],
      );
      expect(journalRows).toEqual([{ attempt_id: 'att:acme-corp:close-key-1' }]);
      expect(await workRepo.get('acme-corp', 'work-001')).toMatchObject({
        state: 'completed',
        version: 3,
      });
    });

    it('no partial write: a throw mid-flow rolls back the journal row, the CAS, AND the receipt', async () => {
      await seedInProgress();
      const cmd = closeCmd();

      await expect(
        conn.transaction(async (tx) => {
          const deps: CompleteWorkDeps = {
            work: new PgWorkRepository(tx),
            receipts: new PgBusinessReceiptRepository(tx),
            journal: new ExplodingJournalRepository(tx),
          };
          return completeWork(cmd, deps);
        }),
      ).rejects.toThrow(/exploded/);

      // FULL rollback: work untouched, no receipt, no journal row.
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('in_progress');
      expect(stored?.version).toBe(2);
      expect(await receiptRepo.get('acme-corp', 'rcpt:att:acme-corp:close-key-1')).toBeUndefined();
      const journalRows = await conn.query<{ attempt_id: string }>(
        'SELECT attempt_id FROM idempotency_journal',
        [],
      );
      expect(journalRows).toEqual([]);
    });
  });
});

/** Journal adapter whose terminal close ALWAYS fails — proves the enclosing
 * transaction rolls everything back (D6: throw → full rollback, no partial). */
class ExplodingJournalRepository extends PgIdempotencyJournalRepository {
  override async complete(): Promise<void> {
    throw new Error('journal complete exploded');
  }
}
