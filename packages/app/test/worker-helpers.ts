import {
  InMemoryBusinessEventRepository,
  InMemoryBusinessReceiptRepository,
  InMemoryDelegationRepository,
  InMemoryIdempotencyJournalRepository,
  InMemorySkillRepository,
  InMemoryWorkRepository,
} from '@io/business-domain/src/ports/fakes.js';
import type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  NewJournalEntry,
} from '@io/business-domain/src/ports/idempotency.js';
import type {
  BusinessEventRepository,
  BusinessReceiptRepository,
  SkillRepository,
} from '@io/business-domain/src/ports/repositories.js';
import type {
  BusinessEvent,
  BusinessReceipt,
  Delegation,
  Skill,
  Work,
} from '@io/business-domain/src/types.js';
import type { LlmPlanShape } from '@io/business-domain/src/validation/llm-plan.js';
import type { LlmResponse } from '@io/llm-client/src/index.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';
import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';
import type {
  EffectRecord,
  SandboxAction,
  SandboxPort,
  UndoHandle,
} from '../src/sandbox/sandbox-port.js';
import type { WorkerDeps, WorkerPrincipals } from '../src/worker/types.js';

/**
 * Shared fixtures + recording doubles for the worker-cycle unit tests
 * (Slice B). Mirrors the repository test-helper precedent
 * (`database/test/connection-fake.ts`): pure in-memory fakes, zero infra.
 */

/** The four distinct principals of one worker cycle (design: SoD). */
export const principals: WorkerPrincipals = {
  proposer: 'principal-proposer',
  approver: 'principal-approver',
  executor: 'principal-executor',
  verifier: 'principal-verifier',
};

/** A claimable Work: `accepted` at version 1 (startWork: accepted → in_progress). */
export function acceptedWork(overrides: Partial<Work> = {}): Work {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: principals.proposer,
    description: 'execute the quarterly close',
    state: 'accepted',
    version: 1,
    evidenceRefs: [],
    ...overrides,
  };
}

/** An active delegation inside its window delegating to the executor principal. */
export function activeDelegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    delegationId: 'del-1',
    companyId: 'acme',
    delegator: 'principal-owner',
    delegate: principals.executor,
    authorityScope: { scope: 'low-risk-documents', actions: ['work.execute', 'create-document'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 4_100_000_000_000,
    expectedOutcome: 'create the quarterly close document',
    state: 'active',
    ...overrides,
  };
}

/** The canned LLM plan: one reversible create-document step. */
export function cannedPlan(): LlmPlanShape {
  return {
    steps: [
      {
        action: 'create-document',
        args: { relativePath: 'docs/quarterly-close.md', content: 'closed for Q3 2026' },
      },
    ],
    intent: 'create the quarterly close document',
  };
}

/** FakeLlmClient with a canned response whose content is the plan JSON by default. */
export function cannedLlm(content: string = JSON.stringify(cannedPlan())): FakeLlmClient {
  const response: LlmResponse = {
    model: 'deepseek-v4-flash',
    content,
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 1,
    },
  };
  return new FakeLlmClient({ responses: [response] });
}

/** The raw worker input (parsed at the boundary via parseCommand). */
export function workerInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    companyId: 'acme',
    actor: principals.executor,
    workId: 'work-1',
    expectedVersion: 1,
    idempotencyKey: 'close-2026-q3',
    requestHash: 'hash-1',
    ...overrides,
  };
}

/** Sandbox double that records every executed action and every undo, in call
 * order (the undo record lets finalize tests assert reconciliation reversed an
 * applied effect). */
export class RecordingSandbox implements SandboxPort {
  readonly executes: SandboxAction[] = [];
  readonly undos: UndoHandle[] = [];
  private readonly inner = new InMemorySandbox();

  constructor(private readonly trace?: string[]) {}

  async execute(action: SandboxAction): Promise<EffectRecord> {
    this.executes.push(action);
    this.trace?.push(`sandbox:execute:${action.relativePath}`);
    return this.inner.execute(action);
  }

  async undo(handle: UndoHandle): Promise<void> {
    this.undos.push(handle);
    return this.inner.undo(handle);
  }

  async wasApplied(handleId: string): Promise<boolean> {
    return this.inner.wasApplied(handleId);
  }
}

/** Journal double that delegates to the in-memory journal and records a
 * phase trace (shared with the sandbox double) for ordering assertions. */
export class RecordingJournal implements IdempotencyJournalPort {
  readonly log: string[] = [];
  private readonly inner = new InMemoryIdempotencyJournalRepository();

  constructor(private readonly trace?: string[]) {}

  async lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined> {
    this.log.push(`lookup:${companyId}:${idempotencyKey}`);
    return this.inner.lookup(companyId, idempotencyKey);
  }

  async insertInFlight(entry: NewJournalEntry): Promise<JournalClaimResult> {
    this.log.push(`insertInFlight:${entry.companyId}:${entry.idempotencyKey}`);
    this.trace?.push(`journal:insertInFlight:${entry.companyId}:${entry.idempotencyKey}`);
    return this.inner.insertInFlight(entry);
  }

  async complete(attemptId: string, resultJson: unknown): Promise<void> {
    this.log.push(`complete:${attemptId}`);
    return this.inner.complete(attemptId, resultJson);
  }

  async markRetryable(attemptId: string): Promise<void> {
    this.log.push(`markRetryable:${attemptId}`);
    return this.inner.markRetryable(attemptId);
  }

  snapshot(): readonly JournalEntry[] {
    return this.inner.snapshot();
  }
}

/** Receipt-repository double that records every save (batch-1 cycles never save). */
export class RecordingReceipts implements BusinessReceiptRepository {
  readonly saves: BusinessReceipt[] = [];
  private readonly inner = new InMemoryBusinessReceiptRepository();

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    const saved = await this.inner.save(receipt);
    this.saves.push(saved);
    return saved;
  }

  async get(companyId: string, receiptId: string): Promise<BusinessReceipt | undefined> {
    return this.inner.get(companyId, receiptId);
  }
}

/** Event-repository double (R5, PR3): records every appended event so the
 * finalize tests can assert EXACTLY ONE `work.completed` append per close,
 * zero appends on CAS loss / replay, and R6 determinism. Also records every
 * tenant-scoped `listByCompany` call (heartbeat R6 read-only seam) so the
 * evaluator tests can assert EXACTLY ONE list per evaluation and zero writes. */
export class RecordingEvents implements BusinessEventRepository {
  readonly appends: BusinessEvent[] = [];
  /** Every tenant passed to `listByCompany`, in call order (heartbeat R6). */
  readonly listCalls: string[] = [];
  private readonly inner = new InMemoryBusinessEventRepository();

  async append(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    const saved = await this.inner.append(event);
    this.appends.push(saved);
    return saved;
  }

  async appendIfAbsent(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    return this.inner.appendIfAbsent(event);
  }

  async listByCompany(companyId: string): Promise<readonly BusinessEvent[]> {
    this.listCalls.push(companyId);
    return this.inner.listByCompany(companyId);
  }

  async listCompanyIds(): Promise<readonly string[]> {
    return this.inner.listCompanyIds();
  }
}

/** Skill-store double (R7 worker seam): delegates to the in-memory skill
 * repository and records every `listByCompany` call so tests can assert the
 * cycle fetches the tenant skills EXACTLY once, after authority. */
export class RecordingSkills implements SkillRepository {
  readonly listCalls: string[] = [];
  private readonly inner = new InMemorySkillRepository();

  async save(skill: Skill): Promise<Readonly<Skill>> {
    return this.inner.save(skill);
  }

  async get(companyId: string, skillId: string): Promise<Skill | undefined> {
    return this.inner.get(companyId, skillId);
  }

  async listByCompany(companyId: string): Promise<readonly Skill[]> {
    this.listCalls.push(companyId);
    return this.inner.listByCompany(companyId);
  }
}

/** A fully wired in-memory worker harness (all four packages over fakes). */
export interface WorkerHarness extends WorkerDeps {
  work: InMemoryWorkRepository;
  delegation: InMemoryDelegationRepository;
  skills: RecordingSkills;
  receipts: RecordingReceipts;
  journal: RecordingJournal;
  events: RecordingEvents;
  sandbox: RecordingSandbox;
  llm: FakeLlmClient;
  /** Shared phase trace: journal + sandbox doubles record into this array. */
  trace: string[];
}

export function harness(overrides: Partial<WorkerDeps> = {}): WorkerHarness {
  const trace: string[] = [];
  const base: WorkerHarness = {
    work: new InMemoryWorkRepository(),
    delegation: new InMemoryDelegationRepository(),
    skills: new RecordingSkills(),
    receipts: new RecordingReceipts(),
    journal: new RecordingJournal(trace),
    events: new RecordingEvents(),
    sandbox: new RecordingSandbox(trace),
    llm: cannedLlm(),
    principals,
    repositories: () => ({
      work: base.work,
      receipts: base.receipts,
      journal: base.journal,
      events: base.events,
    }),
    trace,
  };
  // The repository factory returns the SHARED in-memory fakes for ANY
  // connection (the fakes ignore the connection — the same instances serve the
  // transaction-scoped and the pool connection, mirroring the unit-level
  // "rollback" proof via TxTrackingConnection). A test that overrides
  // work/journal/receipts AND expects the finalize twin to use the double must
  // also override `repositories` (the spread `{ ...h, work: double }` shadows
  // the field but not this closure).
  return { ...base, ...overrides } as WorkerHarness;
}

/** Seed the claimable work + its active delegation. */
export async function seed(h: WorkerHarness, workOverrides: Partial<Work> = {}): Promise<void> {
  await h.work.save(acceptedWork(workOverrides));
  await h.delegation.save(activeDelegation());
}
