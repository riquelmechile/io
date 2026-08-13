import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '@io/business-domain/src/index.js';
import type {
  CasResult,
  CompleteWorkCommand,
  CompleteWorkDeps,
  TransitionWorkCommand,
} from '@io/business-domain/src/index.js';
import { completeWork } from '@io/business-domain/src/index.js';
import { evidenceId } from '@io/business-domain/src/index.js';
import {
  InMemoryCompanyRepository,
  InMemoryWorkRepository,
} from '@io/business-domain/src/index.js';

import { acceptWorkAtomically } from '../src/accept-work-flow.js';
import { PgBusinessEventRepository } from '../src/business-event-adapter.js';
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
const SCHEMA_006 = join(pkgRoot, 'sql', '006_business_events.sql');
const SCHEMA_009 = join(pkgRoot, 'sql', '009_work_company_state_index.sql');
const SCHEMA_010 = join(pkgRoot, 'sql', '010_fencing_tokens.sql');
const SCHEMA_011 = join(pkgRoot, 'sql', '011_recovery_designation.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for all four business-domain
 * aggregates (design §Testing Strategy) plus the Slice B concurrency surface.
 * Connects to live PG 18.4 via PgDbConnection, applies the shipped schema DDL
 * (001 → 002 → 003 → 004 → 006 → 009 → 010 → 011), and round-trips each type through
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
 *   - atomic acceptance (cold-start delta, D2): acceptWorkAtomically COMMITS
 *     the accepted Work @vN+1 AND exactly one work.accepted event in one tx;
 *     every typed failure COMMITS an empty tx (persists NEITHER); a post-CAS
 *     duplicate-append THROWS ⇒ ROLLBACK ⇒ persists NEITHER; a duplicate
 *     accept resolves invalid-transition (proposed→accepted is one-shot).
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
    await conn.execute(readFileSync(SCHEMA_006, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_009, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_010, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_011, 'utf8'), []);
    companyRepo = new PgCompanyRepository(conn);
    delegationRepo = new PgDelegationRepository(conn);
    workRepo = new PgWorkRepository(conn);
    receiptRepo = new PgBusinessReceiptRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute(
      'TRUNCATE company, delegation, work, business_event, business_receipt, idempotency_journal RESTART IDENTITY',
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
      fencingToken: 0,
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
        fencingToken: 0,
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

  describe('Work listActionableByCompany — insertion order, tenant scope, InMemory parity (work-dispatch, 009)', () => {
    /** An ACCEPTED Work — the only actionable state (ACTIONABLE_WORK_STATES). */
    function accepted(workId: string, companyId: string): Work {
      return { ...sampleWork(), workId, companyId, state: 'accepted' };
    }

    it("returns ONLY the tenant's accepted Work, oldest first (insertion order, mixed state/tenant)", async () => {
      await workRepo.save(accepted('work-a1', 'acme-corp'));
      await workRepo.save({ ...accepted('work-a2', 'acme-corp'), state: 'proposed' });
      await workRepo.save(accepted('work-b1', 'other-corp'));
      await workRepo.save(accepted('work-a3', 'acme-corp'));
      await workRepo.save({ ...accepted('work-a4', 'acme-corp'), state: 'in_progress' });

      const actionable = await workRepo.listActionableByCompany('acme-corp');
      expect(actionable.map((w) => w.workId)).toEqual(['work-a1', 'work-a3']);
    });

    it('returns empty for a tenant with no accepted Work', async () => {
      await workRepo.save({ ...accepted('work-a1', 'acme-corp'), state: 'in_progress' });
      await workRepo.save(accepted('work-b1', 'other-corp'));

      expect(await workRepo.listActionableByCompany('acme-corp')).toEqual([]);
    });

    it('rejects an empty companyId before issuing SQL, exactly like the InMemory fake', async () => {
      await workRepo.save(accepted('work-a1', 'acme-corp'));
      const pgError = await workRepo
        .listActionableByCompany('')
        .then(() => undefined)
        .catch((error: Error) => error);
      const fakeError = await new InMemoryWorkRepository()
        .listActionableByCompany('')
        .then(() => undefined)
        .catch((error: Error) => error);

      expect(pgError).toBeInstanceOf(Error);
      expect(fakeError).toBeInstanceOf(Error);
      expect(pgError?.message).toBe('a non-empty companyId is required');
      expect(pgError?.message).toBe(fakeError?.message); // same shape, same message
    });

    it('parity: InMemory and PG return IDENTICAL actionable lists for the SAME seed (parity.test.ts pattern)', async () => {
      const seed: Work[] = [
        accepted('work-a1', 'acme-corp'),
        { ...accepted('work-a2', 'acme-corp'), state: 'proposed' },
        accepted('work-b1', 'other-corp'),
        accepted('work-a3', 'acme-corp'),
        { ...accepted('work-a4', 'acme-corp'), state: 'completed' },
      ];
      const pg = new PgWorkRepository(conn);
      const fake = new InMemoryWorkRepository();
      for (const w of seed) {
        await pg.save(w);
        await fake.save(w);
      }

      const pgList = await pg.listActionableByCompany('acme-corp');
      const fakeList = await fake.listActionableByCompany('acme-corp');
      expect(pgList).toEqual(fakeList);
      expect(pgList.map((w) => w.workId)).toEqual(['work-a1', 'work-a3']);
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
    it('two PgDbConnection instances from different connection strings affect only their own database', {
      // Pre-existing flake on loaded hosts: CREATE/DROP DATABASE on the shared
      // docker PG can take >5s (vitest default testTimeout). Timeout bumped —
      // behavior/assertions untouched (mirrors boot-smoke's 30s integration
      // timeout).
      timeout: 30_000,
    }, async () => {
      // Scratch database on the SAME server the suite is pointed at
      // (DATABASE_URL / pgConnectionString). Hardcoding io:io_dev@localhost:5432
      // would dial the shared dev server even when DATABASE_URL targets an
      // exclusive harness — the coupling that invalidated the prior shared-DB
      // evidence (#6474). Created here and dropped after — the write must NOT
      // leak across databases.
      const isoName = 'io_dev_iso';
      const isoUrl = new URL(pgConnectionString());
      isoUrl.pathname = `/${isoName}`;
      const dbs = await conn.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE datname = $1',
        [isoName],
      );
      if (dbs.length === 0) {
        await conn.execute('CREATE DATABASE io_dev_iso', []);
      }

      const isoConn = new PgDbConnection(isoUrl.toString());
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
        fencingToken: 0,
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

  describe('journal result_json replay row-guard (D7) — live PG', () => {
    it('guards a malformed stored result_json on replay lookup — fails loudly instead of returning raw bytes', async () => {
      const repo = new PgIdempotencyJournalRepository(conn);
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'guard-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:guard-key',
        fencingToken: 0,
      });
      // Simulate a stale/inconsistent stored result: a completed journal row
      // whose result_json is NOT a well-formed Work (missing required fields).
      await repo.complete('att:acme-corp:guard-key', { bogus: 'not-a-work' });

      await expect(repo.lookup('acme-corp', 'guard-key')).rejects.toThrow(
        /corrupt journal result_json/i,
      );
    });

    it('passes through the legitimate UNRESOLVED_REQUIRES_HUMAN sentinel on lookup — a same-key retry returns the typed result, NOT a throw (F1)', async () => {
      const repo = new PgIdempotencyJournalRepository(conn);
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'unresolved-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:unresolved-key',
        fencingToken: 0,
      });
      // Production legitimately closes an unresolvable attempt with the NON-Work
      // UNRESOLVED sentinel (finalize T2(ii), worker.ts) — it has NO workId. A
      // same-key retry / lookup MUST return it typed, not throw `corrupt journal
      // result_json` (which would poison the key and break the honest
      // UNRESOLVED_REQUIRES_HUMAN retry contract).
      await repo.complete('att:acme-corp:unresolved-key', {
        ok: false,
        reason: 'UNRESOLVED_REQUIRES_HUMAN',
      });

      const entry = await repo.lookup('acme-corp', 'unresolved-key');
      expect(entry?.status).toBe('completed');
      expect(entry?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    });

    it('a well-formed stored result_json on replay lookup returns the correct guarded Work', async () => {
      const repo = new PgIdempotencyJournalRepository(conn);
      const completedWork: Work = { ...sampleWork(), state: 'completed', version: 3 };
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'guard-ok-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:guard-ok-key',
        fencingToken: 0,
      });
      await repo.complete('att:acme-corp:guard-ok-key', completedWork);

      const entry = await repo.lookup('acme-corp', 'guard-ok-key');
      expect(entry?.status).toBe('completed');
      // The replayed result_json survived the parseWorkRow guard byte-for-byte.
      expect(entry?.resultJson).toEqual(completedWork);
    });
  });

  describe('fencing tokens (010) — claim→close cycle against live PostgreSQL (fencing-tokens e2e)', () => {
    /** An ACCEPTED Work at version 1, token 0 — claimable. */
    async function seedAccepted(): Promise<Work> {
      const w: Work = {
        ...sampleWork(),
        state: 'accepted',
        version: 1,
        fencingToken: 0,
        evidenceRefs: ['evid-1'],
      };
      await workRepo.save(w);
      return w;
    }

    it('end-to-end claim→close: the claim mints token 1, the token-checked close completes, and exactly one receipt persists (worker-cycle "End-to-end happy path against live PostgreSQL")', async () => {
      const w = await seedAccepted();

      // 1. Claim: accepted → in_progress with the claim directive — the CAS
      //    mints the NEXT token server-side (0 → 1) and returns it.
      const claimed = (await workRepo.updateIfVersion({ ...w, state: 'in_progress' }, w.version, {
        kind: 'claim',
      })) as Extract<CasResult, { ok: true }>;
      expect(claimed.ok).toBe(true);
      expect(claimed.value.fencingToken).toBe(1);
      expect(claimed.value.version).toBe(2);

      // 2. Terminal close: the claim owner presents the minted token — the
      //    token-checked CAS lands (completed, token retained).
      const closed = (await workRepo.updateIfVersion(
        { ...claimed.value, state: 'completed' },
        claimed.value.version,
        { kind: 'terminal', expectedFencingToken: claimed.value.fencingToken },
      )) as Extract<CasResult, { ok: true }>;
      expect(closed.ok).toBe(true);
      expect(closed.value.state).toBe('completed');
      expect(closed.value.fencingToken).toBe(1);

      // 3. Terminal Work persisted: completed, token 1, version 3.
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('completed');
      expect(stored?.fencingToken).toBe(1);
      expect(stored?.version).toBe(3);

      // 4. One receipt for the terminal close (terminal_event_id = attempt id).
      await receiptRepo.save({
        receiptId: 'rcpt:att:acme-corp:fencing-e2e',
        companyId: 'acme-corp',
        workId: 'work-001',
        delegationId: 'del-001',
        actor: 'principal-2',
        policyHash: 'sha256:policy-hash-123',
        evidenceRefs: ['evid-1'],
        terminalState: 'completed',
        terminalEventId: 'att:acme-corp:fencing-e2e',
        artifactHash: 'sha256:artifact-hash-789',
        issuedAt: 1750000000000,
      });
      const receipts = await conn.query<{ receipt_id: string }>(
        'SELECT receipt_id FROM business_receipt WHERE work_id = $1',
        ['work-001'],
      );
      expect(receipts).toHaveLength(1);
    });

    it('stale-token close against live PG: the terminal CAS is rejected as fencing-conflict and no terminal mutation persists (worker-cycle "Stale-token close rolls back atomically")', async () => {
      const w = await seedAccepted();
      const claimed = await workRepo.updateIfVersion({ ...w, state: 'in_progress' }, w.version, {
        kind: 'claim',
      });
      if (!claimed.ok) throw new Error('test setup: claim failed');

      // A zombie holder with token 0 tries to close a work owned by token 1.
      const stale = (await workRepo.updateIfVersion(
        { ...claimed.value, state: 'completed' },
        claimed.value.version,
        { kind: 'terminal', expectedFencingToken: 0 },
      )) as Extract<CasResult, { ok: false }>;

      expect(stale.ok).toBe(false);
      expect(stale.reason).toBe('fencing-conflict');
      expect(stale.current?.fencingToken).toBe(1);
      // Work unchanged: still in_progress, token 1, version 2.
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('in_progress');
      expect(stored?.fencingToken).toBe(1);
      expect(stored?.version).toBe(2);
    });

    it('pre-fencing rows are inert: a version-only close on token 0 works exactly as before (no token required)', async () => {
      const w: Work = {
        ...sampleWork(),
        state: 'in_progress',
        version: 2,
        fencingToken: 0, // legacy row: the epoch token
        evidenceRefs: ['evid-1'],
      };
      await workRepo.save(w);

      // Plain (version-only) close — no directive — still succeeds on token 0.
      const closed = await workRepo.updateIfVersion({ ...w, state: 'completed' }, 2);
      expect(closed.ok).toBe(true);
      if (closed.ok) {
        expect(closed.value.state).toBe('completed');
        expect(closed.value.fencingToken).toBe(0);
      }
    });
  });

  describe('journal fencing tokens (task 2.7) — token store / stale gate / status guard / restart durability — live PG', () => {
    /** A journal adapter over the pool (no transaction needed for standalone reads). */
    const poolJournal = () => new PgIdempotencyJournalRepository(conn);

    it('insertInFlight stores the claim token PRE-effect in live PG: the in_flight row carries the token', async () => {
      const repo = poolJournal();
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'token-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:token-key',
        fencingToken: 7,
      });

      const row = await repo.lookup('acme-corp', 'token-key');
      expect(row?.status).toBe('in_flight');
      expect(row?.fencingToken).toBe(7);
    });

    it('matching-token markRetryable persists the marker WITH token N in live PG; a FRESH read (restart simulation) still sees it (spec "Marker survives a restart")', async () => {
      const repo = poolJournal();
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'restart-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:restart-key',
        fencingToken: 7,
      });

      await repo.markRetryable('att:acme-corp:restart-key', 7);

      // A FRESH adapter over the pool = a fresh read path (restart at the DB
      // layer): the marker AND its claim token survive.
      const fresh = poolJournal();
      const row = await fresh.lookup('acme-corp', 'restart-key');
      expect(row?.status).toBe('aborted_retryable');
      expect(row?.attemptId).toBe('att:acme-corp:restart-key');
      expect(row?.fencingToken).toBe(7);
      expect(row?.resultJson).toBeUndefined();
    });

    it('a STALE token cannot mark retryable in live PG: TYPED stale-token failure WITHOUT mutation — status and token unchanged (spec "Stale token cannot mark retryable")', async () => {
      const repo = poolJournal();
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'stale-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:stale-key',
        fencingToken: 7,
      });

      // A typed failure value (never a thrown rejection)…
      const result = await repo.markRetryable('att:acme-corp:stale-key', 3);
      expect(result).toMatchObject({ ok: false, reason: 'stale-token' });
      if (!result.ok) {
        expect(result.reason).toBe('stale-token');
        expect(result.current?.status).toBe('in_flight');
        expect(result.current?.fencingToken).toBe(7);
      }

      const row = await repo.lookup('acme-corp', 'stale-key');
      expect(row?.status).toBe('in_flight');
      expect(row?.fencingToken).toBe(7);
    });

    it('complete is STATUS-GUARDED and TOKEN-FREE in live PG: a completed row is rejected unchanged, and the honest UNRESOLVED T2(ii) close lands without a token', async () => {
      const repo = poolJournal();
      const completedWork: Work = { ...sampleWork(), state: 'completed', version: 3 };
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'guard-key-2',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:guard-key-2',
        fencingToken: 3,
      });
      await repo.complete('att:acme-corp:guard-key-2', completedWork);

      // A second complete on the completed row is REJECTED (0 rows) unchanged.
      await expect(repo.complete('att:acme-corp:guard-key-2', completedWork)).rejects.toThrow(
        /in_flight|attempt/i,
      );
      const done = await repo.lookup('acme-corp', 'guard-key-2');
      expect(done?.status).toBe('completed');
      expect(done?.resultJson).toEqual(completedWork);

      // The honest token-free UNRESOLVED close (T2(ii)) on an in_flight row:
      // NO token argument, status guard passes, sentinel stored.
      await repo.insertInFlight({
        companyId: 'acme-corp',
        idempotencyKey: 'unresolved-key-2',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:unresolved-key-2',
        fencingToken: 3,
      });
      await repo.complete('att:acme-corp:unresolved-key-2', {
        ok: false,
        reason: 'UNRESOLVED_REQUIRES_HUMAN',
      });
      const closed = await repo.lookup('acme-corp', 'unresolved-key-2');
      expect(closed?.status).toBe('completed');
      expect(closed?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    });

    it('stale-token terminal close rolls back the WHOLE journal+receipt write in live PG: an IdempotentFlowAbortError leaves NO in_flight row and NO receipt (worker-cycle "Stale-token close rolls back atomically", journal layer)', async () => {
      // A work claimed at token 1 (accepted → in_progress, claim directive).
      const w: Work = {
        ...sampleWork(),
        state: 'accepted',
        version: 1,
        fencingToken: 0,
        evidenceRefs: ['evid-1'],
      };
      await workRepo.save(w);
      const claimed = await workRepo.updateIfVersion({ ...w, state: 'in_progress' }, 1, {
        kind: 'claim',
      });
      if (!claimed.ok) throw new Error('test setup: claim failed');

      // A ZOMBIE (token 0) tries the atomic idempotent close: the T1 CAS is
      // token-checked, so it fails as fencing-conflict AFTER the in_flight
      // insert — the enclosing transaction must ROLL BACK the journal row and
      // never issue a receipt.
      const cmd: CompleteWorkCommand = {
        companyId: 'acme-corp',
        actor: 'principal-2',
        workId: 'work-001',
        idempotencyKey: 'stale-close-key',
        requestHash: 'hash-1',
        policyHash: 'sha256:policy-hash-123',
        artifactHash: 'sha256:artifact-hash-789',
        outcome: { result: 'closed successfully', success: true },
        evidenceRefs: ['evid-2'],
        fencingToken: 0, // STALE — the claim minted 1
      };
      await expect(completeWorkAtomically(conn, cmd)).rejects.toThrow(/fencing-conflict/i);

      // FULL rollback: no journal row, no receipt, work untouched (in_progress,
      // token 1, version 2).
      const journalRows = await conn.query<{ attempt_id: string }>(
        'SELECT attempt_id FROM idempotency_journal',
        [],
      );
      expect(journalRows).toEqual([]);
      expect(
        await receiptRepo.get('acme-corp', 'rcpt:att:acme-corp:stale-close-key'),
      ).toBeUndefined();
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('in_progress');
      expect(stored?.fencingToken).toBe(1);
      expect(stored?.version).toBe(2);
    });
  });

  describe('same-key race loser — typed result + exactly-one-effect (D6) — live PG', () => {
    it('two concurrent claims on the same key: exactly one wins, the loser gets a typed attempt-in-flight (never a throw)', async () => {
      const claimKey = {
        companyId: 'acme-corp',
        idempotencyKey: 'race-key',
        requestHash: 'hash-1',
        attemptId: 'att:acme-corp:race-key',
        fencingToken: 0,
      };
      const [a, b] = await Promise.all([
        conn.transaction((tx) => new PgIdempotencyJournalRepository(tx).insertInFlight(claimKey)),
        conn.transaction((tx) => new PgIdempotencyJournalRepository(tx).insertInFlight(claimKey)),
      ]);

      const wins = [a, b].filter((r) => r.ok === true);
      const losses = [a, b].filter((r) => r.ok === false && r.reason === 'attempt-in-flight');
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
    });

    it('HAMMER (task 2.3 race fix): 25 consecutive same-key claim races on DISTINCT keys ALL resolve typed — exactly one winner each, NEVER a throw (the no-target ON CONFLICT DO NOTHING arbitrates BOTH unique indexes; the historical ~10-25% attempt_id duplicate-key throw is gone)', async () => {
      const repo = new PgIdempotencyJournalRepository(conn);
      // Same attempt_id for BOTH concurrent claims — the exact surface that
      // used to throw on UNIQUE(attempt_id) when the targeted ON CONFLICT
      // clause did not arbitrate it. 25 independent keys × 2 racing claims.
      for (let i = 0; i < 25; i++) {
        const key = `race-key-${i}`;
        const claimKey = {
          companyId: 'acme-corp',
          idempotencyKey: key,
          requestHash: `hash-${i}`,
          attemptId: `att:acme-corp:${key}`,
          fencingToken: i,
        };
        const [a, b] = await Promise.all([
          conn.transaction((tx) => repo.insertInFlight(claimKey)),
          conn.transaction((tx) => repo.insertInFlight(claimKey)),
        ]);
        const wins = [a, b].filter((r) => r.ok === true);
        const losses = [a, b].filter((r) => r.ok === false && r.reason === 'attempt-in-flight');
        expect(wins, `iteration ${i}: expected exactly one winner`).toHaveLength(1);
        expect(losses, `iteration ${i}: loser must be a TYPED attempt-in-flight`).toHaveLength(1);
        // The winning row persists with its claim token (pre-effect store).
        const row = await repo.lookup('acme-corp', key);
        expect(row?.status).toBe('in_flight');
        expect(row?.fencingToken).toBe(i);
      }
    });

    it('two concurrent terminal closes on the same key issue EXACTLY ONE receipt and bump the version once (no throw)', async () => {
      const w: Work = {
        ...sampleWork(),
        state: 'in_progress',
        version: 2,
        fencingToken: 0,
        evidenceRefs: ['evid-1'],
      };
      await workRepo.save(w);
      const cmd: CompleteWorkCommand = {
        companyId: 'acme-corp',
        actor: 'principal-2',
        workId: 'work-001',
        idempotencyKey: 'race-close-key',
        requestHash: 'hash-1',
        policyHash: 'sha256:policy-hash-123',
        artifactHash: 'sha256:artifact-hash-789',
        outcome: { result: 'closed successfully', success: true },
        evidenceRefs: ['evid-2'],
      };

      // Two genuine concurrent terminal closes — BOTH resolve (no thrown error):
      // the winner completes; the loser gets a typed attempt-in-flight (or a
      // replay if the winner committed before the loser's lookup).
      const [a, b] = await Promise.all([
        completeWorkAtomically(conn, cmd),
        completeWorkAtomically(conn, cmd),
      ]);
      expect(a.ok === true || (a.ok === false && a.reason === 'attempt-in-flight')).toBe(true);
      expect(b.ok === true || (b.ok === false && b.reason === 'attempt-in-flight')).toBe(true);

      // EXACTLY ONE effect: one receipt, the version bumped once, one journal row.
      const receipts = await conn.query<{ receipt_id: string }>(
        'SELECT receipt_id FROM business_receipt WHERE work_id = $1',
        ['work-001'],
      );
      expect(receipts).toHaveLength(1);
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(3); // bumped ONCE, not twice
      const journalRows = await conn.query<{ attempt_id: string }>(
        'SELECT attempt_id FROM idempotency_journal',
        [],
      );
      expect(journalRows).toHaveLength(1);
    });
  });

  describe('recovery designation (011) — setRecoveryRequest CAS + partial-index discovery + marker lifecycle — live PG (work-lifecycle "Operator Recovery Designation", supervisor-recovery slice 5)', () => {
    /** An in_progress orphan at version 2 with the minted claim token 1 — the
     * row an operator designates for recovery. */
    async function seedOrphan(): Promise<Work> {
      const w: Work = {
        ...sampleWork(),
        state: 'in_progress',
        version: 2,
        fencingToken: 1,
        evidenceRefs: ['evid-1'],
      };
      await workRepo.save(w);
      return w;
    }

    it('designation→discovery→clear roundtrip: the CAS bumps version (state + token preserved), the partial-index query finds ONLY the designated in_progress orphan, and clearing removes it', async () => {
      const orphan = await seedOrphan();
      // A non-designated in_progress orphan in the SAME tenant — invisible to
      // the partial-index discovery (marker gate).
      await workRepo.save({
        ...sampleWork(),
        workId: 'work-other',
        state: 'in_progress',
        version: 2,
        fencingToken: 1,
        evidenceRefs: [],
      });

      const designated = await workRepo.setRecoveryRequest(
        'acme-corp',
        orphan.workId,
        orphan.version,
        true,
      );
      expect(designated.ok).toBe(true);
      if (designated.ok) {
        expect(designated.value.version).toBe(3); // plain version+1 CAS
        expect(designated.value.state).toBe('in_progress'); // NOT a transition
        expect(designated.value.fencingToken).toBe(1); // token preserved
      }

      const discovered = await workRepo.listRecoveryRequestedByCompany('acme-corp');
      expect(discovered.map((w) => w.workId)).toEqual(['work-001']);
      expect(discovered[0]?.state).toBe('in_progress');

      // Clearing: marker off, version bumped again, discovery empty.
      const cleared = await workRepo.setRecoveryRequest('acme-corp', 'work-001', 3, false);
      expect(cleared.ok).toBe(true);
      expect(await workRepo.listRecoveryRequestedByCompany('acme-corp')).toEqual([]);
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.version).toBe(4);
      expect(stored?.state).toBe('in_progress'); // clearing is not a transition either
    });

    it('stale-version designation CAS → version-conflict, row unchanged (the version bump fences a stale zombie designation)', async () => {
      const orphan = await seedOrphan();
      await workRepo.setRecoveryRequest('acme-corp', orphan.workId, orphan.version, true);

      // A stale expected version (2 — already bumped to 3) is fenced.
      const stale = await workRepo.setRecoveryRequest(
        'acme-corp',
        orphan.workId,
        orphan.version,
        false,
      );
      expect(stale.ok).toBe(false);
      if (!stale.ok) {
        expect(stale.reason).toBe('version-conflict');
        expect(stale.current?.version).toBe(3);
      }
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.version).toBe(3);
      expect(stored?.state).toBe('in_progress');
      // The stale attempt did NOT clear the marker.
      expect(await workRepo.listRecoveryRequestedByCompany('acme-corp')).toHaveLength(1);
    });

    it('the partial index IS used by the discovery query — EXPLAIN shows idx_work_recovery_requested, not a sequential scan', async () => {
      const orphan = await seedOrphan();
      await workRepo.setRecoveryRequest('acme-corp', orphan.workId, orphan.version, true);

      // SET LOCAL inside a transaction: disable seqscan for THIS statement so
      // the plan proves the partial index covers the discovery predicate (a
      // tiny table would otherwise be scanned sequentially). The setting is
      // transaction-scoped — the pool is never polluted.
      const plan = await conn.transaction(async (tx) => {
        await tx.execute('SET LOCAL enable_seqscan = off', []);
        return tx.query<{ 'QUERY PLAN': string }>(
          "EXPLAIN SELECT work_id FROM work WHERE company_id = $1 AND recovery_requested AND state = 'in_progress'",
          ['acme-corp'],
        );
      });
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');
      expect(text).toContain('idx_work_recovery_requested');
      expect(text).not.toMatch(/Seq Scan/);
    });

    it('a designated TERMINAL Work is never discovered — the partial-index predicate excludes it (the inert-stale-marker semantics)', async () => {
      const done: Work = {
        ...sampleWork(),
        state: 'completed',
        version: 3,
        fencingToken: 1,
        evidenceRefs: [],
      };
      await workRepo.save(done);
      // Out-of-band completion left a stale designation marker on a terminal row.
      await workRepo.setRecoveryRequest('acme-corp', done.workId, 3, true);

      // The partial index (WHERE recovery_requested AND state='in_progress')
      // hides it — discovery returns NOTHING for the completed row.
      expect(await workRepo.listRecoveryRequestedByCompany('acme-corp')).toEqual([]);
      // The marker is still physically set (inert) — the supervisor's list→get
      // race net clears it when it observes a terminal Work.
      const stored = await workRepo.get('acme-corp', 'work-001');
      expect(stored?.state).toBe('completed');
    });
  });

  describe('atomic acceptance — acceptWorkAtomically (D2, Atomic Acceptance Fact) — live PG', () => {
    /** A PROPOSED Work at version 1 — the valid pre-accept row. */
    async function seedProposed(overrides: Partial<Work> = {}): Promise<Work> {
      const w: Work = {
        ...sampleWork(),
        workId: 'work-acc-001',
        state: 'proposed',
        version: 1,
        fencingToken: 0,
        evidenceRefs: [],
        ...overrides,
      };
      await workRepo.save(w);
      return w;
    }

    function acceptCmd(overrides: Partial<TransitionWorkCommand> = {}): TransitionWorkCommand {
      return {
        companyId: 'acme-corp',
        actor: 'principal-2',
        workId: 'work-acc-001',
        ...overrides,
      };
    }

    const eventsRepo = (): PgBusinessEventRepository => new PgBusinessEventRepository(conn);
    const eventCount = async (): Promise<number> =>
      (await eventsRepo().listByCompany('acme-corp')).length;

    it('success: COMMITS the accepted Work at version N+1 AND exactly one work.accepted event in the SAME transaction', async () => {
      await seedProposed();

      const result = await acceptWorkAtomically(conn, acceptCmd());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('accepted');
        expect(result.value.version).toBe(2);
      }
      // The Work CAS and the event append committed TOGETHER — both visible
      // outside the transaction.
      const stored = await workRepo.get('acme-corp', 'work-acc-001');
      expect(stored?.state).toBe('accepted');
      expect(stored?.version).toBe(2);

      const events = await eventsRepo().listByCompany('acme-corp');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventId: 'evt:acc:work-acc-001',
        companyId: 'acme-corp',
        aggregateKind: 'work',
        aggregateId: 'work-acc-001',
        eventType: 'work.accepted',
        source: 'acceptor',
      });
      expect(events[0]?.payload).toEqual({
        workId: 'work-acc-001',
        state: 'accepted',
        actor: 'principal-2',
      });
    });

    it('version-conflict: COMMITS an EMPTY transaction — the Work stays proposed@v1 AND no event persists', async () => {
      await seedProposed();

      const result = await acceptWorkAtomically(conn, acceptCmd({ expectedVersion: 99 }));

      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toBe('version-conflict');
      const stored = await workRepo.get('acme-corp', 'work-acc-001');
      expect(stored?.state).toBe('proposed');
      expect(stored?.version).toBe(1);
      expect(await eventCount()).toBe(0);
    });

    it('invalid-transition: COMMITS an EMPTY transaction — a non-proposed Work cannot be accepted, no event persists', async () => {
      await seedProposed({ state: 'in_progress' });

      const result = await acceptWorkAtomically(conn, acceptCmd());

      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toBe('invalid-transition');
      expect((await workRepo.get('acme-corp', 'work-acc-001'))?.state).toBe('in_progress');
      expect(await eventCount()).toBe(0);
    });

    it('not-found: COMMITS an EMPTY transaction — an unknown workId resolves not-found, no event persists', async () => {
      await seedProposed();

      const result = await acceptWorkAtomically(conn, acceptCmd({ workId: 'work-missing' }));

      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toBe('not-found');
      expect(await eventCount()).toBe(0);
    });

    it('invalid-command: COMMITS an EMPTY transaction — a missing workId resolves invalid-command before any write', async () => {
      await seedProposed();

      const result = await acceptWorkAtomically(conn, acceptCmd({ workId: '' }));

      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toBe('invalid-command');
      expect(await eventCount()).toBe(0);
    });

    it('post-CAS duplicate-append THROWS ⇒ ROLLBACK: NEITHER the accepted Work NOR a new event persists (uq_business_event_event_id)', async () => {
      await seedProposed();
      // Crash-gap residue: an ORPHAN acceptor event row already occupies the
      // eventId the acceptance will append (single issuance, R7). The CAS
      // lands inside the tx (accepted v2), then the append rejects on the
      // UNIQUE constraint — the shared transaction MUST roll back BOTH.
      await conn.execute(
        'INSERT INTO business_event (event_id, company_id, aggregate_kind, aggregate_id, ' +
          'event_type, occurred_at, payload, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          'evt:acc:work-acc-001',
          'acme-corp',
          'work',
          'work-acc-001',
          'work.accepted',
          1,
          '{}',
          'acceptor',
          Date.now(),
        ],
      );

      await expect(acceptWorkAtomically(conn, acceptCmd())).rejects.toThrow(
        /duplicate key|unique/i,
      );

      // FULL rollback: the Work CAS did NOT persist…
      const stored = await workRepo.get('acme-corp', 'work-acc-001');
      expect(stored?.state).toBe('proposed');
      expect(stored?.version).toBe(1);
      // …and exactly ONE event row remains — the pre-existing orphan, unchanged.
      const events = await eventsRepo().listByCompany('acme-corp');
      expect(events).toHaveLength(1);
      expect(events[0]?.eventId).toBe('evt:acc:work-acc-001');
    });

    it('duplicate accept: a SECOND accept of an already-accepted Work resolves invalid-transition — proposed→accepted is one-shot', async () => {
      await seedProposed();
      await acceptWorkAtomically(conn, acceptCmd());
      expect((await workRepo.get('acme-corp', 'work-acc-001'))?.state).toBe('accepted');

      const second = await acceptWorkAtomically(conn, acceptCmd());

      expect(second.ok).toBe(false);
      if (second.ok === false) expect(second.reason).toBe('invalid-transition');
      // No second event: exactly one acceptor row from the first accept.
      const events = await eventsRepo().listByCompany('acme-corp');
      expect(events).toHaveLength(1);
      expect(events[0]?.eventId).toBe('evt:acc:work-acc-001');
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
