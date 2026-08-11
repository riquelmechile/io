import type { IdempotencyJournalPort } from '@io/business-domain/src/ports/idempotency.js';
import type {
  BusinessEventRepository,
  BusinessReceiptRepository,
  DelegationRepository,
  SkillRepository,
  WorkRepository,
} from '@io/business-domain/src/ports/repositories.js';
import type { BusinessReceipt, Work } from '@io/business-domain/src/types.js';
import type { UseCaseReason } from '@io/business-domain/src/use-cases/index.js';
import type { LlmPlanShape } from '@io/business-domain/src/validation/llm-plan.js';
import type { DbConnection } from '@io/database/src/connection.js';
import type { LlmClient } from '@io/llm-client/src/index.js';
import type { EffectRecord, SandboxPort } from '../sandbox/sandbox-port.js';

/**
 * Worker-cycle types (design "Data Flow"): the four principals of one cycle,
 * the injectable port set, and the typed result contract. The worker lives in
 * `@io/app` (the composition root) and may import all four packages — every
 * failure is a typed RESULT, never a thrown exception used for control flow.
 */

/**
 * The four principals of one worker cycle — four DISTINCT E2E IDs. SoD
 * (`checkSod`) enforces proposer≠approver and executor≠verifier at action
 * time; a collapse of any pair DENIES the cycle even at low risk.
 */
export interface WorkerPrincipals {
  readonly proposer: string;
  readonly approver: string;
  readonly executor: string;
  readonly verifier: string;
}

/** Every failure reason the worker cycle can return. Superset of the use-case
 * reasons plus the worker-only deny/recovery/plan/finalize reasons. */
export type WorkerFailureReason =
  | UseCaseReason
  | 'invalid-plan'
  | 'denied'
  | 'recovery-required'
  | 'cas-lost-retryable'
  | 'UNRESOLVED_REQUIRES_HUMAN';

export type WorkerResult =
  /** The effect ran; when a connection seam is wired (B7) the terminal close
   * committed: the work is `completed` and exactly one receipt was issued.
   * Without a connection the cycle returns pre-terminal (work still
   * `in_progress`, journal in_flight — Slice C wires the real connection). */
  | {
      ok: true;
      work: Work;
      attemptId: string;
      evidenceId: string;
      effect: EffectRecord;
      plan: LlmPlanShape;
      /** The single business receipt issued by the T1 terminal close (present
       * only when the finalize twin ran with a wired connection). */
      receipt?: BusinessReceipt;
    }
  /** Pre-effect replay: the key already completed with the same hash — recorded result returned, NO effect. */
  | { ok: true; replayed: true; resultJson: unknown }
  | { ok: false; reason: WorkerFailureReason; detail?: string; current?: Work };

/** The claim identity the claimed-work cycle operates under (design D5 seam):
 * the row identity + the stable dispatch key/hash. `runClaimedWork` is the
 * claim-gate-free entry — `dispatchRecovery` constructs this from the
 * orphaned `in_progress` Work row + `keys.ts` — so the identity is explicit,
 * never re-derived from Work (the idempotency key is CALLER-carried: unit
 * cycles pass arbitrary keys, and only dispatch derives `wk:`). */
export type ClaimedWorkIdentity = {
  readonly companyId: string;
  readonly workId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
};

/** The repository set one worker step works on, bound to ONE connection —
 * mirrors `completeWorkAtomically` (packages/database/src/complete-work-flow.ts):
 * inside the terminal transaction the factory receives the TRANSACTION-SCOPED
 * connection so CAS + receipt + journal.complete share ONE transaction; outside
 * a transaction it receives the pool for separate committed writes (§9.8). */
export interface WorkerRepositories {
  work: WorkRepository;
  receipts: BusinessReceiptRepository;
  journal: IdempotencyJournalPort;
  /** Append-only business-fact log (R5): the T1 terminal close appends ONE
   * `work.completed` event in the SAME transaction as the CAS + receipt +
   * journal.complete — atomic by construction, rolled back with the CAS. */
  events: BusinessEventRepository;
}

/** Injectable port set for one worker cycle (unit level: fakes; Slice C: PG adapters). */
export interface WorkerDeps {
  work: WorkRepository;
  delegation: DelegationRepository;
  /** Tenant skill store (skill R7 seam): the cycle fetches the company's
   * skills once after authority and passes them into the compiled context as
   * segment 7. The worker stays PG-agnostic — the adapter is bound at the
   * composition root. Read-only: the worker NEVER saves skills. */
  skills: SkillRepository;
  /**
   * Read-only heartbeat seam (heartbeat R6, skills precedent): the app
   * evaluator reads the company's business-event stream through this port to
   * decide Flash activation. Pool-bound at the composition root; the worker
   * cycle itself never calls it this slice — it is a READ-ONLY surface.
   */
  events: BusinessEventRepository;
  receipts: BusinessReceiptRepository;
  journal: IdempotencyJournalPort;
  sandbox: SandboxPort;
  llm: LlmClient;
  principals: WorkerPrincipals;
  now?: () => number;
  /**
   * Terminal-close seam (§9.8): the finalize twin (B7) runs its atomic close in
   * `connection.transaction`. The external effect MUST NEVER run inside it —
   * batch-1 wiring keeps the effect outside any transaction.
   */
  connection?: DbConnection;
  /**
   * Repository factory for the terminal close (Slice C correction): binds the
   * repos to whatever connection it is given. The finalize T1 passes the
   * transaction-scoped `tx` (ONE real transaction); T2 passes the pool for
   * separate committed writes. `@io/app` stays PG-agnostic — the PG adapters
   * are constructed at the composition root (harness), never in worker source.
   */
  repositories?: (conn: DbConnection) => WorkerRepositories;
}
