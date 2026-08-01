import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Company, Delegation, Work } from '@io/business-domain/src/index.js';
import {
  type PgBusinessReceiptRepository,
  PgCompanyRepository,
  type PgDelegationRepository,
  type PgIdempotencyJournalRepository,
  type PgWorkRepository,
} from '@io/database/src/index.js';
import { PgDbConnection, pgConnectionString } from '@io/database/src/pg-connection.js';
import type { LlmClient, LlmResponse } from '@io/llm-client/src/index.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';

import { buildWorkerDeps } from '../../src/composition/worker-deps.js';
import type { FileDocumentSandbox } from '../../src/sandbox/file-document-sandbox.js';
import type { WorkerDeps, WorkerPrincipals } from '../../src/worker/types.js';

/**
 * E2E harness (Slice C, C1 — design "E2E wiring"): boots the FULL real worker
 * stack against a live PostgreSQL 18.4 (`io_pg`) SCRATCH database and wires it
 * for `runWorker`. Following the existing PG integration pattern
 * (business-pg-roundtrip): a per-run scratch database is CREATED, migrated
 * (001 → 005, in order), and DROPPED on close — `io_dev` is never polluted.
 *
 * The wired stack is the REAL one (the point of Slice C): `PgDbConnection` +
 * the real PG repository adapters (`PgWorkRepository`, `PgDelegationRepository`,
 * `PgCompanyRepository`, `PgBusinessReceiptRepository`,
 * `PgIdempotencyJournalRepository`) + the real terminal transaction
 * (`finalizeInFlightWorkAtomically` over the live connection) + the worker
 * cycle + `FakeLlmClient` (canned create-document plan — real DeepSeek is out
 * of scope) + the shipped `FileDocumentSandbox` over a tmp root.
 *
 * Honest 3-mode reachability guard (C6, mirrors the database package's
 * pattern — business-pg-roundtrip.integration.test.ts + pg-required
 * .integration.test.ts):
 *   1. LOCAL without PG and IO_REQUIRE_PG unset → the E2E suites SKIP
 *      (`describe.skipIf(!reachable && !e2eRequirePg)`) — correct for a dev
 *      without the io_pg container.
 *   2. PG reachable (local or CI) → the E2E suites RUN against live PG.
 *   3. CI with IO_REQUIRE_PG=1 and PG unreachable → the suites RUN and
 *      `createE2eHarness` FAILS LOUDLY (ECONNREFUSED propagates) — a skipped
 *      integration hides defects, and CI can never silently skip the E2E.
 */

/** The four distinct principals of one worker cycle (design: SoD). */
export const E2E_PRINCIPALS: WorkerPrincipals = {
  proposer: 'principal-proposer',
  approver: 'principal-approver',
  executor: 'principal-executor',
  verifier: 'principal-verifier',
};

/** Default tenant + ids shared by the C2 happy-path fixtures. */
export const E2E_COMPANY = 'acme-corp';
export const E2E_WORK_ID = 'work-e2e';
export const E2E_DELEGATION_ID = 'del-e2e';
export const E2E_IDEMPOTENCY_KEY = 'e2e-close-1';
export const E2E_REQUEST_HASH = 'hash-e2e-1';

/**
 * Reachability probe for the honest 3-mode guard — mirrors the database
 * package's probe (business-pg-roundtrip.integration.test.ts:55-65): true when
 * live PostgreSQL answers `SELECT 1` over `pgConnectionString()`.
 */
export async function pgReachable(): Promise<boolean> {
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

/**
 * CI marker — same convention as the database guard
 * (packages/database/test/pg-required.integration.test.ts): when
 * `IO_REQUIRE_PG=1` the E2E suites RUN even if the probe fails, so an
 * unreachable PG FAILS LOUDLY instead of skipping. CI (ci.yml) sets this on the
 * `check` job alongside the postgres:18 service.
 */
export const e2eRequirePg = process.env.IO_REQUIRE_PG === '1';

/** Canned LLM plan: one reversible create-document step (FakeLlmClient). */
export const E2E_PLAN_JSON = JSON.stringify({
  steps: [
    {
      action: 'create-document',
      args: { relativePath: 'docs/quarterly-close.md', content: 'closed for Q3 2026' },
    },
  ],
  intent: 'create the quarterly close document',
});

/** A fully wired E2E harness over the REAL stack. */
export interface E2eHarness {
  /** The per-run scratch database name (created + dropped; io_dev untouched). */
  readonly databaseName: string;
  /** The live scratch connection — a PLAIN PgDbConnection pool. Atomicity is
   * NOT provided by a routing decorator: the finalize twin's T1 builds its own
   * repos on the transaction-scoped client via the `repositories` factory
   * (mirrors `completeWorkAtomically`) — atomic by construction. */
  readonly conn: PgDbConnection;
  readonly company: PgCompanyRepository;
  readonly delegation: PgDelegationRepository;
  readonly work: PgWorkRepository;
  readonly receipts: PgBusinessReceiptRepository;
  readonly journal: PgIdempotencyJournalRepository;
  readonly sandbox: FileDocumentSandbox;
  readonly sandboxRoot: string;
  /** The LLM client driving the cycle: the injected one, or `cannedLlm()`. */
  readonly llm: LlmClient;
  readonly principals: WorkerPrincipals;
  /** Fully wired worker deps over the REAL adapters + terminal transaction. */
  readonly deps: WorkerDeps;
  /** Close the connections, DROP the scratch database, remove the tmp root. */
  close(): Promise<void>;
}

export interface E2eHarnessOptions {
  /** Per-run scratch database name (created + dropped; io_dev is untouched). */
  readonly databaseName: string;
  /** Canned LLM plan JSON (default: the create-document plan). */
  readonly llmContent?: string;
  /** Optional injected LlmClient (default: `cannedLlm(llmContent)`). */
  readonly llm?: LlmClient;
}

const here = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(here, '../../../database/sql');
const MIGRATIONS = [
  '001_create_tables.sql',
  '002_create_business_tables.sql',
  '003_harden_columns.sql',
  '004_harden_constraints.sql',
  '005_journal_retryable_status.sql',
  '006_business_events.sql',
];

/** Boot the harness: probe PG, recreate the scratch DB, migrate, wire the stack. */
export async function createE2eHarness(options: E2eHarnessOptions): Promise<E2eHarness> {
  const { databaseName } = options;
  const admin = new PgDbConnection(pgConnectionString());
  try {
    // NEVER silently skip: when this suite runs (PG reachable, or CI forces it
    // via IO_REQUIRE_PG=1), an unreachable PostgreSQL FAILS the E2E loudly.
    await admin.execute('SELECT 1', []);
  } catch (error) {
    await admin.close();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Slice C E2E requires live PostgreSQL 18.4 (${pgConnectionString()}, container io_pg) — ` +
        `the E2E must RUN, never skip (IO_REQUIRE_PG=${process.env.IO_REQUIRE_PG ?? 'unset'}): ${reason}`,
    );
  }

  // Isolation: drop any leftover scratch DB, then create a fresh one per run.
  await admin.execute(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`, []);
  await admin.execute(`CREATE DATABASE ${databaseName}`, []);

  // The raw pool connection: the REAL adapters used by the cycle's standalone
  // reads/writes (claim, reconcile, verify, E2E assertions) bind to it. The
  // finalize twin's T1 gets its OWN tx-scoped repos from `deps.repositories(tx)`
  // — no statement routing is needed, atomicity is by construction.
  const conn = new PgDbConnection(scratchConnectionString(databaseName));
  try {
    for (const migration of MIGRATIONS) {
      await conn.execute(readFileSync(join(SQL_DIR, migration), 'utf8'), []);
    }
  } catch (error) {
    await conn.close();
    await admin.execute(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`, []);
    await admin.close();
    throw error;
  }

  const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-e2e-sandbox-'));
  const llm = options.llm ?? cannedLlm(options.llmContent);
  const principals = E2E_PRINCIPALS;

  // Deps assembly is DELEGATED to the production composition root
  // (packages/app/src/composition/worker-deps.ts — Req 1): ONE wiring path for
  // the harness and any other composition root consumer. The pool-bound PG
  // adapters + FileDocumentSandbox over `sandboxRoot` + the injected llm +
  // the `repositories(conn)` factory (mirrors completeWorkAtomically) all come
  // from `buildWorkerDeps`. The finalize twin's T1 binds its repos to the
  // transaction-scoped `tx` — atomic by construction, no statement routing.
  const deps = buildWorkerDeps({
    connection: conn,
    llm,
    sandboxRoot,
    principals,
  });

  const harness: E2eHarness = {
    databaseName,
    conn,
    company: new PgCompanyRepository(conn),
    delegation: deps.delegation as PgDelegationRepository,
    work: deps.work as PgWorkRepository,
    receipts: deps.receipts as PgBusinessReceiptRepository,
    journal: deps.journal as PgIdempotencyJournalRepository,
    sandbox: deps.sandbox as FileDocumentSandbox,
    sandboxRoot,
    llm,
    principals,
    deps,
    close: async () => {
      await conn.close();
      await admin.execute(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`, []);
      await admin.close();
      rmSync(sandboxRoot, { recursive: true, force: true });
    },
  };
  return harness;
}

/** Seed the claimable company + active delegation + accepted Work (version 1). */
export async function seedAcceptedWork(
  harness: E2eHarness,
  overrides: {
    readonly companyId?: string;
    readonly workId?: string;
    readonly delegationId?: string;
  } = {},
): Promise<void> {
  const companyId = overrides.companyId ?? E2E_COMPANY;
  const delegationId = overrides.delegationId ?? E2E_DELEGATION_ID;
  const workId = overrides.workId ?? E2E_WORK_ID;
  const company: Company = { companyId, purpose: 'E2E tenant scope' };
  const delegation: Delegation = {
    delegationId,
    companyId,
    delegator: 'principal-owner',
    delegate: harness.principals.executor,
    authorityScope: { scope: 'low-risk-documents', actions: ['work.execute', 'create-document'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 4_100_000_000_000,
    expectedOutcome: 'create the E2E quarterly close document',
    state: 'active',
  };
  const work: Work = {
    workId,
    companyId,
    delegationId,
    proposer: harness.principals.proposer,
    description: 'execute the low-risk quarterly close document create',
    state: 'accepted',
    version: 1,
    evidenceRefs: [],
  };
  await harness.company.save(company);
  await harness.delegation.save(delegation);
  await harness.work.save(work);
}

/** The raw `runWorker` input for the seeded accepted Work (parsed at the boundary). */
export function workerInputFor(
  harness: E2eHarness,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    companyId: E2E_COMPANY,
    actor: harness.principals.executor,
    workId: E2E_WORK_ID,
    expectedVersion: 1,
    idempotencyKey: E2E_IDEMPOTENCY_KEY,
    requestHash: E2E_REQUEST_HASH,
    ...overrides,
  };
}

/** FakeLlmClient serving the canned create-document plan as its response. */
function cannedLlm(content: string | undefined): FakeLlmClient {
  const response: LlmResponse = {
    model: 'deepseek-v4-flash',
    content: content ?? E2E_PLAN_JSON,
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 1,
    },
  };
  return new FakeLlmClient({ responses: [response] });
}

/** The scratch DB connection string: same server/user as pgConnectionString,
 * different database name (URL-rewritten — no string surgery). */
export function scratchConnectionString(databaseName: string): string {
  const url = new URL(pgConnectionString());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** A FRESH worker stack over the same scratch database (C5 restart): a
 * brand-new `PgDbConnection` pool (new TCP connection) + fresh REAL adapters +
 * fresh worker deps over the SAME sandbox root — the non-vacuous restart. */
export interface FreshWorkerStack {
  readonly conn: PgDbConnection;
  readonly deps: WorkerDeps;
  close(): Promise<void>;
}

/** Boot a fresh worker stack for a restart simulation (C5): connects to the
 * harness's scratch database with a NEW PgDbConnection pool and builds a fully
 * wired fresh worker via the production composition root (`buildWorkerDeps`):
 * plain pool + fresh REAL adapters + FileDocumentSandbox over the SAME root +
 * the harness's LLM client (default FakeLlmClient unless injected). The
 * database, migrations and committed rows are untouched — the fresh connection
 * reads exactly what the crashed instance persisted. */
export function openFreshWorkerStack(harness: E2eHarness): FreshWorkerStack {
  const conn = new PgDbConnection(scratchConnectionString(harness.databaseName));
  const deps = buildWorkerDeps({
    connection: conn,
    llm: harness.llm,
    sandboxRoot: harness.sandboxRoot,
    principals: harness.principals,
  });
  return { conn, deps, close: async () => conn.close() };
}
