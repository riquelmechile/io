import type { DbConnection } from '@io/database/src/connection.js';
import {
  PgBusinessEventRepository,
  PgBusinessReceiptRepository,
  PgDelegationRepository,
  PgIdempotencyJournalRepository,
  PgSkillRepository,
  PgWorkRepository,
} from '@io/database/src/index.js';
import type { LlmClient } from '@io/llm-client/src/index.js';

import { FileDocumentSandbox } from '../sandbox/file-document-sandbox.js';
import type { WorkerDeps, WorkerPrincipals } from '../worker/types.js';

/**
 * The production composition root (design decision C — "thin module", Req 1
 * "Production Composition Root"): assembles ONE fully wired {@link WorkerDeps}
 * from a connection, an injected {@link LlmClient}, a sandbox root and the
 * worker principals.
 *
 * The worker source stays PG-agnostic (its `WorkerDeps` ports are interfaces):
 * the PG adapters are constructed HERE — pool-bound work/delegation/receipts/
 * journal over the given `connection`, plus the shipped
 * {@link FileDocumentSandbox} over `sandboxRoot`. The LLM client is a plain
 * injection seam: whatever fake or real client the caller supplies is the one
 * the worker calls (FakeLlmClient in tests, DeepSeekClient in the live E2E).
 *
 * The `repositories(conn)` factory (task 1.2) mirrors
 * `completeWorkAtomically` (packages/database/src/complete-work-flow.ts): it
 * binds FRESH PG adapters to whatever connection it is given, so the finalize
 * twin's T1 passes the TRANSACTION-SCOPED `tx` and the CAS + receipt +
 * journal.complete + business-event append share ONE real PostgreSQL
 * transaction — atomic by construction, with no statement-routing decorator.
 */

/** Inputs to the composition root. `now` is optional (defaults to Date.now). */
export type BuildWorkerDepsInput = {
  readonly connection: DbConnection;
  readonly llm: LlmClient;
  readonly sandboxRoot: string;
  readonly principals: WorkerPrincipals;
  readonly now?: () => number;
};

export function buildWorkerDeps(input: BuildWorkerDepsInput): WorkerDeps {
  const { connection, llm, sandboxRoot, principals } = input;
  return {
    work: new PgWorkRepository(connection),
    delegation: new PgDelegationRepository(connection),
    skills: new PgSkillRepository(connection),
    receipts: new PgBusinessReceiptRepository(connection),
    journal: new PgIdempotencyJournalRepository(connection),
    sandbox: new FileDocumentSandbox(sandboxRoot),
    llm,
    principals,
    now: input.now ?? (() => Date.now()),
    connection,
    repositories: (conn: DbConnection) => ({
      work: new PgWorkRepository(conn),
      receipts: new PgBusinessReceiptRepository(conn),
      journal: new PgIdempotencyJournalRepository(conn),
      events: new PgBusinessEventRepository(conn),
    }),
  };
}
