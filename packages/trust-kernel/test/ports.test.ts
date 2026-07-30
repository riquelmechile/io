import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  Decision,
  InMemoryRecord,
  PersistentRecord,
  PrincipalId,
  RiskClass,
} from '../src/model.js';
import type { AuditRepository, EvidenceRepository } from '../src/ports/repositories.js';
import { PERSISTENT_PORT_DISCLOSURE } from '../src/ports/repositories.js';
import { InMemoryAuditRepository, InMemoryEvidenceRepository } from '../src/ports/fakes.js';

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
    it('save -> get round-trips the same record (port contract)', () => {
      const store = new Map<string, PersistentRecord>();
      const repo: EvidenceRepository = {
        save: (record) => {
          store.set(record.actionId, record);
          return record;
        },
        get: (actionId) => store.get(actionId),
      };
      const record = persistentFixture();
      const saved = repo.save(record);

      expect(saved).toEqual(record);
      expect(repo.get(record.actionId)).toEqual(record);
    });

    it('get returns undefined for an unknown actionId', () => {
      const repo: EvidenceRepository = { save: (record) => record, get: () => undefined };

      expect(repo.get('missing')).toBeUndefined();
    });

    it('accepts a generic session/transaction context (default unknown, R7)', () => {
      type DbSession = { readonly tx: string };
      const observed: DbSession[] = [];
      const repo: EvidenceRepository<PersistentRecord, DbSession> = {
        save: (record, session) => {
          if (session) observed.push(session);
          return record;
        },
        get: () => undefined,
      };
      const session: DbSession = { tx: 'tx-1' };

      // A typed session is accepted by the port and observable through it.
      repo.save(persistentFixture(), session);
      expect(observed).toEqual([session]);

      // The session param is OPTIONAL: omitting it still type-checks.
      repo.save(persistentFixture());
      expect(observed).toHaveLength(1);

      // The default S = unknown specialization is a valid EvidenceRepository.
      const defaulted: EvidenceRepository = repo;
      expect(defaulted).toBe(repo);
    });
  });

  describe('AuditRepository<R>', () => {
    it('append preserves insertion order', () => {
      let log: readonly PersistentRecord[] = [];
      const repo: AuditRepository = {
        append: (record) => {
          log = [...log, record];
          return log;
        },
        getLog: () => log,
      };

      repo.append(persistentFixture({ actionId: 'a1', reason: 'first' }));
      const afterSecond = repo.append(persistentFixture({ actionId: 'a2', reason: 'second' }));

      expect(afterSecond).toHaveLength(2);
      expect(afterSecond[0]?.actionId).toBe('a1');
      expect(afterSecond[1]?.actionId).toBe('a2');
    });

    it('append returns a NEW state; the prior log reference is unmutated', () => {
      let log: readonly PersistentRecord[] = [];
      const repo: AuditRepository = {
        append: (record) => {
          log = [...log, record];
          return log;
        },
        getLog: () => log,
      };

      const state1 = repo.append(persistentFixture({ actionId: 'a1' }));
      const snapshot = repo.getLog();
      repo.append(persistentFixture({ actionId: 'a2' }));

      // The previously returned and snapshotted states are unchanged.
      expect(state1).toHaveLength(1);
      expect(snapshot).toHaveLength(1);
      expect(state1[0]?.actionId).toBe('a1');
      // The current log reflects both entries.
      expect(repo.getLog()).toHaveLength(2);
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
    it('satisfies EvidenceRepository and store -> read round-trips', () => {
      const repo = new InMemoryEvidenceRepository();
      const typed: EvidenceRepository = repo;
      const record = persistentFixture({ actionId: 'evidence-1' });
      const saved = typed.save(record);

      expect(saved).toEqual(record);
      expect(typed.get('evidence-1')).toEqual(record);
    });

    it('returns undefined for an unknown actionId', () => {
      const repo = new InMemoryEvidenceRepository();

      expect(repo.get('missing')).toBeUndefined();
    });

    it('accepts a session/transaction context (R7) and stores the record', () => {
      const repo = new InMemoryEvidenceRepository();
      const record = persistentFixture({ actionId: 'session-action' });

      repo.save(record, { tx: 'tx-9' });
      expect(repo.get('session-action')).toEqual(record);
    });

    it('overwrites a record stored under a repeated actionId', () => {
      const repo = new InMemoryEvidenceRepository();
      const first = persistentFixture({ actionId: 'dup', reason: 'first' });
      const second = persistentFixture({ actionId: 'dup', reason: 'second' });

      repo.save(first);
      repo.save(second);
      const stored = repo.get('dup');

      expect(stored?.reason).toBe('second');
    });
  });

  describe('InMemoryAuditRepository', () => {
    it('satisfies AuditRepository and preserves insertion order', () => {
      const repo = new InMemoryAuditRepository();
      const typed: AuditRepository = repo;

      typed.append(persistentFixture({ actionId: 'a1', reason: 'first' }));
      const log = typed.append(persistentFixture({ actionId: 'a2', reason: 'second' }));

      expect(log).toHaveLength(2);
      expect(log[0]?.actionId).toBe('a1');
      expect(log[1]?.actionId).toBe('a2');
      expect(typed.getLog()).toHaveLength(2);
    });

    it('returns a NEW state; the prior log reference is unmutated', () => {
      const repo = new InMemoryAuditRepository();
      const first = repo.append(persistentFixture({ actionId: 'a1' }));
      const snapshot = repo.getLog();

      repo.append(persistentFixture({ actionId: 'a2' }));

      expect(first).toHaveLength(1);
      expect(snapshot).toHaveLength(1);
      expect(repo.getLog()).toHaveLength(2);
    });

    it('starts with an empty log', () => {
      const repo = new InMemoryAuditRepository();

      expect(repo.getLog()).toEqual([]);
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

    it('records routed via the fake carry the honest non-durable disclosure', () => {
      const repo = new InMemoryEvidenceRepository();
      const record: PersistentRecord = {
        ...persistentFixture({ actionId: 'honest-1' }),
        disclosure: PERSISTENT_PORT_DISCLOSURE,
      };

      repo.save(record);
      const stored = repo.get('honest-1');

      expect(stored?.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      expect(stored?.disclosure.toLowerCase()).not.toContain('postgresql');
    });
  });
});

function extractStaticImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specs.push(match[1] ?? '');
  return specs;
}
