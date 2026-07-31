import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { NON_PERSISTENT_DISCLOSURE } from '../src/evidence.js';
import type { Grant } from '../src/grant.js';
import type { PrincipalIdentity } from '../src/identity.js';
import type {
  AuditEntry,
  Decision,
  InMemoryRecord,
  KernelAction,
  PersistentRecord,
  PrincipalId,
  RiskClass,
} from '../src/model.js';
import { evaluate, type EvaluationInput } from '../src/pipeline.js';
import type { AuditRepository, EvidenceRepository } from '../src/ports/repositories.js';
import { PERSISTENT_PORT_DISCLOSURE } from '../src/ports/repositories.js';
import { InMemoryAuditRepository, InMemoryEvidenceRepository } from '../src/ports/fakes.js';
import type { RiskThresholds } from '../src/risk.js';
import type { SodAssignment } from '../src/sod.js';

/**
 * Persistence port boundary (Req 1-6). Strict-TDD proof of the hexagonal port
 * pattern: PersistentRecord honesty discriminant, repository port interfaces,
 * in-memory fakes, and (in boundary.test.ts) the universal detector covering
 * ports/. Pure unit tests only (integration: false).
 */

/** A valid durable-capable record routed through a repository port (Req 3). */
function persistentFixture(overrides: Partial<PersistentRecord> = {}): PersistentRecord {
  return {
    actionId: 'action-1',
    principalId: 'principal-1' as PrincipalId,
    riskClass: 'medium' as RiskClass,
    decision: 'ALLOW' as Decision,
    reason: 'routed via repository port',
    timestamp: 1000,
    persistent: true,
    disclosure: 'routed via repository port; durability depends on the adapter',
    ...overrides,
  };
}

describe('PersistentRecord honesty discriminant (Req 3)', () => {
  it('carries persistent:true literal and a non-empty durability disclosure', () => {
    const record = persistentFixture();

    expect(record.persistent).toBe(true);
    expect(typeof record.disclosure).toBe('string');
    expect(record.disclosure.length).toBeGreaterThan(0);
  });

  it('InMemoryRecord (persistent:false) and PersistentRecord (persistent:true) coexist', () => {
    const inMemory: InMemoryRecord = {
      actionId: 'a',
      principalId: 'p',
      riskClass: 'low',
      decision: 'DENY',
      reason: 'in-memory capture',
      timestamp: 1,
      persistent: false,
      disclosure: 'in-memory only; not persisted',
    };
    const persistent = persistentFixture();

    // Discriminated by the literal, not just a boolean value.
    expect(inMemory.persistent).toBe(false);
    expect(persistent.persistent).toBe(true);
    expectTypeOf<InMemoryRecord['persistent']>().toEqualTypeOf<false>();
    expectTypeOf<PersistentRecord['persistent']>().toEqualTypeOf<true>();
  });

  it('tsc rejects cross-assignment via the persistent literal (compile-time guard)', () => {
    const persistent = persistentFixture();

    // A durable-capable record MUST NOT be silently treated as a non-persistent
    // in-memory record. The literal makes this a compile-time error.
    // @ts-expect-error persistent:true is not assignable to persistent:false
    const asInMemory: InMemoryRecord = persistent;

    // Runtime sanity: the object identity is unchanged; the guard is type-only.
    expect(asInMemory).toBe(persistent);
    expect(asInMemory.persistent).toBe(true);
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const repositoriesPath = join(here, '..', 'src', 'ports', 'repositories.ts');
const fakesPath = join(here, '..', 'src', 'ports', 'fakes.ts');

describe('Repository port interfaces (Req 1, 2, 6)', () => {
  describe('EvidenceRepository<R, S = unknown>', () => {
    it('save -> get round-trips the same record (port contract)', async () => {
      // Port contract (D1): save/get are ASYNC, returning Promise<...>.
      expectTypeOf<EvidenceRepository['save']>().returns.toMatchTypeOf<
        Promise<Readonly<PersistentRecord>>
      >();
      expectTypeOf<EvidenceRepository['get']>().returns.toMatchTypeOf<
        Promise<PersistentRecord | undefined>
      >();
      const store = new Map<string, PersistentRecord>();
      const repo: EvidenceRepository = {
        save: async (record) => {
          store.set(record.actionId, record);
          return record;
        },
        get: async (actionId) => store.get(actionId),
      };
      const record = persistentFixture();
      const saved = await repo.save(record);

      expect(saved).toEqual(record);
      expect(await repo.get(record.actionId)).toEqual(record);
    });

    it('get returns undefined for an unknown actionId', async () => {
      const repo: EvidenceRepository = {
        save: async (record) => record,
        get: async () => undefined,
      };

      expect(await repo.get('missing')).toBeUndefined();
    });

    it('accepts a generic session/transaction context (default unknown, R7)', async () => {
      type DbSession = { readonly tx: string };
      const observed: DbSession[] = [];
      const repo: EvidenceRepository<PersistentRecord, DbSession> = {
        save: async (record, session) => {
          if (session) observed.push(session);
          return record;
        },
        get: async () => undefined,
      };
      const session: DbSession = { tx: 'tx-1' };

      // A typed session is accepted by the port and observable through it.
      await repo.save(persistentFixture(), session);
      expect(observed).toEqual([session]);

      // The session param is OPTIONAL: omitting it still type-checks.
      await repo.save(persistentFixture());
      expect(observed).toHaveLength(1);

      // The default S = unknown specialization is a valid EvidenceRepository.
      const defaulted: EvidenceRepository = repo;
      expect(defaulted).toBe(repo);
    });
  });

  describe('AuditRepository<R>', () => {
    it('append preserves insertion order', async () => {
      // Port contract (D1): append/getLog are ASYNC, returning Promise<...>.
      expectTypeOf<AuditRepository['append']>().returns.toMatchTypeOf<
        Promise<readonly PersistentRecord[]>
      >();
      expectTypeOf<AuditRepository['getLog']>().returns.toMatchTypeOf<
        Promise<readonly PersistentRecord[]>
      >();
      let log: readonly PersistentRecord[] = [];
      const repo: AuditRepository = {
        append: async (record) => {
          log = [...log, record];
          return log;
        },
        getLog: async () => log,
      };

      await repo.append(persistentFixture({ actionId: 'a1', reason: 'first' }));
      const afterSecond = await repo.append(
        persistentFixture({ actionId: 'a2', reason: 'second' }),
      );

      expect(afterSecond).toHaveLength(2);
      expect(afterSecond[0]?.actionId).toBe('a1');
      expect(afterSecond[1]?.actionId).toBe('a2');
    });

    it('append returns a NEW state; the prior log reference is unmutated', async () => {
      let log: readonly PersistentRecord[] = [];
      const repo: AuditRepository = {
        append: async (record) => {
          log = [...log, record];
          return log;
        },
        getLog: async () => log,
      };

      const state1 = await repo.append(persistentFixture({ actionId: 'a1' }));
      const snapshot = await repo.getLog();
      await repo.append(persistentFixture({ actionId: 'a2' }));

      // The previously returned and snapshotted states are unchanged.
      expect(state1).toHaveLength(1);
      expect(snapshot).toHaveLength(1);
      expect(state1[0]?.actionId).toBe('a1');
      // The current log reflects both entries.
      expect(await repo.getLog()).toHaveLength(2);
    });
  });

  describe('ports/repositories.ts boundary purity (Req 6, D3/D4)', () => {
    it('exists as a ports module', () => {
      expect(existsSync(repositoriesPath)).toBe(true);
    });

    it('imports only relative kernel types (no pg/ORM/framework)', () => {
      const source = readFileSync(repositoriesPath, 'utf8');
      const imports = extractStaticImportSpecifiers(source);

      expect(imports.length).toBeGreaterThan(0);
      for (const spec of imports) {
        expect(spec.startsWith('.')).toBe(true);
      }
      expect(source).not.toMatch(
        /\b(pg|postgres|prisma|typeorm|sequelize|drizzle-orm|express|fastify|langchain|langgraph|@ai-sdk)\b/i,
      );
    });

    it('uses import type only (erased -> zero runtime deps, D4)', () => {
      const source = readFileSync(repositoriesPath, 'utf8');

      expect(source).toContain('import type');
      // No value import from an external (non-relative) module.
      expect(source).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+['"][^.]/m);
    });
  });
});

describe('In-memory fake adapters (Req 4, D6)', () => {
  describe('InMemoryEvidenceRepository', () => {
    it('satisfies EvidenceRepository and store -> read round-trips', async () => {
      const repo = new InMemoryEvidenceRepository();
      const typed: EvidenceRepository = repo;
      const record = persistentFixture({ actionId: 'evidence-1' });
      const saved = await typed.save(record);

      expect(saved).toEqual(record);
      expect(await typed.get('evidence-1')).toEqual(record);
    });

    it('returns undefined for an unknown actionId', async () => {
      const repo = new InMemoryEvidenceRepository();

      expect(await repo.get('missing')).toBeUndefined();
    });

    it('accepts a session/transaction context (R7) and stores the record', async () => {
      const repo = new InMemoryEvidenceRepository();
      const record = persistentFixture({ actionId: 'session-action' });

      await repo.save(record, { tx: 'tx-9' });
      expect(await repo.get('session-action')).toEqual(record);
    });

    it('overwrites a record stored under a repeated actionId', async () => {
      const repo = new InMemoryEvidenceRepository();
      const first = persistentFixture({ actionId: 'dup', reason: 'first' });
      const second = persistentFixture({ actionId: 'dup', reason: 'second' });

      await repo.save(first);
      await repo.save(second);
      const stored = await repo.get('dup');

      expect(stored?.reason).toBe('second');
    });
  });

  describe('InMemoryAuditRepository', () => {
    it('satisfies AuditRepository and preserves insertion order', async () => {
      const repo = new InMemoryAuditRepository();
      const typed: AuditRepository = repo;

      await typed.append(persistentFixture({ actionId: 'a1', reason: 'first' }));
      const log = await typed.append(persistentFixture({ actionId: 'a2', reason: 'second' }));

      expect(log).toHaveLength(2);
      expect(log[0]?.actionId).toBe('a1');
      expect(log[1]?.actionId).toBe('a2');
      expect(await typed.getLog()).toHaveLength(2);
    });

    it('returns a NEW state; the prior log reference is unmutated', async () => {
      const repo = new InMemoryAuditRepository();
      const first = await repo.append(persistentFixture({ actionId: 'a1' }));
      const snapshot = await repo.getLog();

      await repo.append(persistentFixture({ actionId: 'a2' }));

      expect(first).toHaveLength(1);
      expect(snapshot).toHaveLength(1);
      expect(await repo.getLog()).toHaveLength(2);
    });

    it('starts with an empty log', async () => {
      const repo = new InMemoryAuditRepository();

      expect(await repo.getLog()).toEqual([]);
    });
  });

  describe('ports/fakes.ts boundary purity (Req 4)', () => {
    it('imports only in-memory structures (no driver/net/daemon/framework)', () => {
      const source = readFileSync(fakesPath, 'utf8');
      const imports = extractStaticImportSpecifiers(source);

      expect(imports.length).toBeGreaterThan(0);
      for (const spec of imports) {
        expect(spec.startsWith('.')).toBe(true);
      }
      expect(source).not.toMatch(
        /\b(pg|postgres|net|https?|dgram|child_process|cluster|express|fastify|langchain|langgraph)\b/i,
      );
    });
  });

  describe('fake honesty — NON-durable disclosure (D6)', () => {
    it('disclosure is honest and does NOT claim durable in PostgreSQL', () => {
      expect(typeof PERSISTENT_PORT_DISCLOSURE).toBe('string');
      expect(PERSISTENT_PORT_DISCLOSURE.length).toBeGreaterThan(0);

      const lower = PERSISTENT_PORT_DISCLOSURE.toLowerCase();
      // MUST NOT overclaim durability or a specific durable store.
      expect(lower).not.toContain('postgresql');
      expect(lower).not.toMatch(/durable in/);
      // MUST defer durability to the adapter (honest, non-durable baseline).
      expect(lower).toContain('adapter');
    });

    it('each fake supplies the honest NON-durable disclosure', () => {
      const evidence = new InMemoryEvidenceRepository();
      const audit = new InMemoryAuditRepository();

      // The fake is the adapter; it honestly declares it is NOT durable.
      expect(evidence.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      expect(audit.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      expect(evidence.disclosure.toLowerCase()).not.toContain('postgresql');
    });

    it('records routed via the fake carry the honest non-durable disclosure', async () => {
      const repo = new InMemoryEvidenceRepository();
      const record: PersistentRecord = {
        ...persistentFixture({ actionId: 'honest-1' }),
        disclosure: PERSISTENT_PORT_DISCLOSURE,
      };

      await repo.save(record);
      const stored = await repo.get('honest-1');

      expect(stored?.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      expect(stored?.disclosure.toLowerCase()).not.toContain('postgresql');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — Backward-compatible pipeline wiring (Req 5, D1/D5/D6).
// ---------------------------------------------------------------------------

const wirePrincipalId: PrincipalId = 'p1';
const wireCommand = 'execute';
const wireThresholds: RiskThresholds = { lowMax: 10, mediumMax: 50 };

/** Medium risk (impact 25) needs 4-way distinct SOD. */
const fourWaySod: SodAssignment[] = [
  { role: 'proposer', principalId: 'p1' },
  { role: 'approver', principalId: 'p2' },
  { role: 'executor', principalId: 'p3' },
  { role: 'verifier', principalId: 'p4' },
];

function wireGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    grantId: 'g1',
    principalId: wirePrincipalId,
    command: 'execute',
    authority: 'op:execute',
    scope: 'region:us',
    start: 1000,
    expiry: 9000,
    ...overrides,
  };
}

function wirePrincipal(overrides: Partial<PrincipalIdentity> = {}): PrincipalIdentity {
  return {
    principalId: wirePrincipalId,
    primaryRole: 'operator',
    temporaryAssignments: [],
    ...overrides,
  };
}

function wireAction(overrides: Partial<KernelAction> = {}): KernelAction {
  return { actionId: 'a1', command: wireCommand, impactScore: 25, ...overrides };
}

/** A valid prior audit entry independent of the production builder. */
function wirePriorEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actionId: 'prior',
    principalId: wirePrincipalId,
    riskClass: 'low',
    decision: 'DENY',
    reason: 'prior evaluation',
    timestamp: 500,
    persistent: false,
    disclosure: NON_PERSISTENT_DISCLOSURE,
    ...overrides,
  };
}

function wireInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    principal: wirePrincipal(),
    action: wireAction(),
    grants: [wireGrant()],
    sodAssignments: fourWaySod,
    thresholds: wireThresholds,
    now: 1500,
    ...overrides,
  };
}

describe('Backward-compatible pipeline wiring — no repository (Req 5, D1)', () => {
  it('produces no persistence field when no repository is injected', async () => {
    const result = await evaluate(wireInput());

    expect(result).not.toHaveProperty('persistence');
  });

  it('keeps evidence and auditLog as InMemoryRecord persistent:false', async () => {
    const result = await evaluate(wireInput());

    expect(result.evidence.persistent).toBe(false);
    expect(result.evidence.disclosure).toBe(NON_PERSISTENT_DISCLOSURE);
    expect(result.auditLog.at(-1)?.persistent).toBe(false);
  });

  it('keeps decision, evidence, receipt, and steps identical to the persistence-free kernel', async () => {
    const result = await evaluate(wireInput());

    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toBe('all enforced gates passed');
    expect(result.risk).toBe('medium');
    expect(result.steps).toHaveLength(16);
    expect(result.evidence).toEqual({
      actionId: 'a1',
      principalId: 'p1',
      riskClass: 'medium',
      decision: 'ALLOW',
      reason: 'all enforced gates passed',
      timestamp: 1500,
      persistent: false,
      disclosure: NON_PERSISTENT_DISCLOSURE,
    });
    expect(result.receipt?.terminalState).toBe('ALLOW');
  });

  it('a DENY evaluation also stays byte-identical with no persistence field', async () => {
    const result = await evaluate(wireInput({ grants: [] }));

    expect(result.decision).toBe('DENY');
    expect(result).not.toHaveProperty('persistence');
    expect(result.evidence.persistent).toBe(false);
    expect(result.auditLog.at(-1)?.persistent).toBe(false);
    expect(result.receipt).toBeUndefined();
  });
});

describe('Pipeline wiring — repositories injected routes through the ports (Req 5, D5)', () => {
  it('evidence and auditLog STILL carry the captured InMemoryRecord (persistent:false, D5)', async () => {
    const result = await evaluate(
      wireInput({
        evidenceRepository: new InMemoryEvidenceRepository(),
        auditRepository: new InMemoryAuditRepository(),
      }),
    );

    // Consumer contract D5: the captured in-memory records are NOT replaced.
    expect(result.evidence.persistent).toBe(false);
    expect(result.evidence.disclosure).toBe(NON_PERSISTENT_DISCLOSURE);
    expect(result.auditLog.at(-1)?.persistent).toBe(false);
  });

  it('persistence.evidenceRecord and auditRecord carry the routed PersistentRecord (persistent:true, D5)', async () => {
    const result = await evaluate(
      wireInput({
        evidenceRepository: new InMemoryEvidenceRepository(),
        auditRepository: new InMemoryAuditRepository(),
      }),
    );

    expect(result.persistence?.evidenceRecord?.persistent).toBe(true);
    expect(result.persistence?.auditRecord?.persistent).toBe(true);
    // The routed record carries the port-contract disclosure (D6 path marker).
    expect(result.persistence?.evidenceRecord?.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
  });

  it('saves the evidence record via the evidence port (R7)', async () => {
    const evidenceRepo = new InMemoryEvidenceRepository();
    await evaluate(
      wireInput({
        action: wireAction({ actionId: 'routed-evidence' }),
        evidenceRepository: evidenceRepo,
      }),
    );

    const stored = await evidenceRepo.get('routed-evidence');
    expect(stored).toBeDefined();
    expect(stored?.persistent).toBe(true);
    expect(stored?.decision).toBe('ALLOW');
    expect(stored?.riskClass).toBe('medium');
  });

  it('appends the audit entry via the audit port (R16)', async () => {
    const auditRepo = new InMemoryAuditRepository();
    await evaluate(
      wireInput({
        action: wireAction({ actionId: 'routed-audit' }),
        auditRepository: auditRepo,
      }),
    );

    const log = await auditRepo.getLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.persistent).toBe(true);
    expect(log[0]?.actionId).toBe('routed-audit');
  });

  it('routing never mutates the prior audit log', async () => {
    const prior = [wirePriorEntry()];
    const auditRepo = new InMemoryAuditRepository();
    await evaluate(wireInput({ priorAuditLog: prior, auditRepository: auditRepo }));

    // The caller's prior log is untouched; the audit repo received only the one
    // routed entry (it is NOT fed the prior in-memory log).
    expect(prior).toHaveLength(1);
    const log = await auditRepo.getLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.persistent).toBe(true);
  });

  it('routes only evidence when only the evidence repository is present', async () => {
    const result = await evaluate(
      wireInput({ evidenceRepository: new InMemoryEvidenceRepository() }),
    );

    expect(result.persistence?.evidenceRecord).toBeDefined();
    expect(result.persistence?.evidenceRecord?.persistent).toBe(true);
    expect(result.persistence?.auditRecord).toBeUndefined();
  });

  it('routes only audit when only the audit repository is present', async () => {
    const result = await evaluate(wireInput({ auditRepository: new InMemoryAuditRepository() }));

    expect(result.persistence?.auditRecord).toBeDefined();
    expect(result.persistence?.auditRecord?.persistent).toBe(true);
    expect(result.persistence?.evidenceRecord).toBeUndefined();
  });

  it('the routed PersistentRecord mirrors the captured evidence core fields (D8)', async () => {
    const result = await evaluate(
      wireInput({
        evidenceRepository: new InMemoryEvidenceRepository(),
        auditRepository: new InMemoryAuditRepository(),
      }),
    );

    const captured = result.evidence;
    const routed = result.persistence?.evidenceRecord;
    expect(routed).toBeDefined();
    // Core fields mirror the captured InMemoryRecord (D8 field order).
    expect(routed?.actionId).toBe(captured.actionId);
    expect(routed?.principalId).toBe(captured.principalId);
    expect(routed?.riskClass).toBe(captured.riskClass);
    expect(routed?.decision).toBe(captured.decision);
    expect(routed?.reason).toBe(captured.reason);
    expect(routed?.timestamp).toBe(captured.timestamp);
    // Diverges ONLY on the persistent literal + disclosure.
    expect(routed?.persistent).toBe(true);
    expect(captured.persistent).toBe(false);
  });

  it('a DENY evaluation also routes through the ports when present (triangulation)', async () => {
    const evidenceRepo = new InMemoryEvidenceRepository();
    const auditRepo = new InMemoryAuditRepository();
    const result = await evaluate(
      wireInput({
        grants: [],
        evidenceRepository: evidenceRepo,
        auditRepository: auditRepo,
      }),
    );

    expect(result.decision).toBe('DENY');
    // Captured in-memory records stay non-persistent.
    expect(result.evidence.persistent).toBe(false);
    // Routed records are durable-capable.
    expect(result.persistence?.evidenceRecord?.persistent).toBe(true);
    expect(result.persistence?.auditRecord?.persistent).toBe(true);
    expect(result.persistence?.evidenceRecord?.decision).toBe('DENY');
    expect((await evidenceRepo.get(result.evidence.actionId))?.persistent).toBe(true);
    expect(await auditRepo.getLog()).toHaveLength(1);
  });
});

function extractStaticImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specs.push(match[1] ?? '');
  return specs;
}
