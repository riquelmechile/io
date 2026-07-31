import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as databaseApi from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcDir = join(pkgRoot, 'src');
const repoRoot = join(pkgRoot, '..', '..');

/**
 * Boundary & exclusion guards for the database package (Req 5; Honest Disclosure
 * & Live-PG Slice). The package now ships ONE allowed runtime dependency (`pg`),
 * confined to `src/pg-connection.ts` (D4): everywhere else stays driver-free and
 * framework-free. `pg` opens a `pg.Pool` ONLY in pg-connection.ts. There is still
 * no migration runner and `integration: true` (flipped in Slice 3, D8). Coupling
 * to @io/trust-kernel stays TYPE-ONLY. Excluded from the 8+12+10=30 canonical partition.
 */
const forbiddenSpecifiers: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'database driver',
    pattern:
      /^(pg|postgres|postgresql|mysql|mariadb|sqlite|mongodb|redis|knex|prisma|typeorm|sequelize|drizzle-orm|mssql)(\/|$)/i,
  },
  {
    label: 'HTTP/framework server',
    pattern: /^(express|fastify|koa|hapi|polka|next|@nestjs)(\/|$)/,
  },
  { label: 'filesystem/persistence', pattern: /^(node:)?fs(\/|$)/ },
  { label: 'network', pattern: /^(node:)?(net|https?|dgram)(\/|$)/ },
  { label: 'subprocess/daemon', pattern: /^(node:)?(child_process|cluster)(\/|$)/ },
  {
    label: 'LLM/agentic framework',
    pattern:
      /^(openai|anthropic|@anthropic-ai|langchain|@langchain|langgraph|@ai-sdk|^ai$|crewai|autogen|mastra|paperclip|llamaindex|@llamaindex)(\/|$)/i,
  },
];

/** Tokens that would indicate a REAL PostgreSQL connection was opened. */
const realPgTokens = ['new Client', 'new Pool', '.connect(', 'postgres('];

/** The single src file permitted to import `pg` and own a Pool (D4/D6). */
const pgDriverOwner = join(srcDir, 'pg-connection.ts');

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, entry.toString()))
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticImport = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticImport)) specs.push(match[1] ?? '');
  for (const match of source.matchAll(dynamicImport)) specs.push(match[1] ?? '');
  return specs;
}

/** Value (non-type) imports from @io/trust-kernel — forbidden under D4. */
function kernelValueImports(source: string): string[] {
  const violations: string[] = [];
  const re = /import\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(re)) {
    const isType = match[1] !== undefined;
    const specifier = match[2] ?? '';
    if (specifier.startsWith('@io/trust-kernel') && !isType) violations.push(specifier);
  }
  return violations;
}

describe('database package boundary & exclusions (Req 5, scenario 2)', () => {
  describe('package.json — pg is the single allowed runtime dep; type-only coupling (D4)', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    it('declares exactly one allowed runtime dependency: pg', () => {
      // pg is the ONLY runtime dep (D4); it is confined to pg-connection.ts.
      expect(pkg.dependencies ?? {}).toEqual({ pg: expect.any(String) });
      expect((pkg.dependencies as Record<string, string>).pg).toMatch(/^\^?8\./);
    });

    it('declares zero peer/optional/bundle dependencies', () => {
      expect(pkg.peerDependencies ?? {}).toEqual({});
      expect(pkg.optionalDependencies ?? {}).toEqual({});
      expect(pkg.bundleDependencies ?? pkg.bundledDependencies ?? {}).toEqual({});
    });

    it('declares only the kernel + business-domain + pg type declarations as devDependencies', () => {
      // @io/trust-kernel and @io/business-domain stay devDependencies (type-only
      // coupling, D4). @types/pg is a TYPE-ONLY devDep because pg 8.x ships no
      // bundled declarations; it adds NO runtime coupling. No other devDeps.
      expect(pkg.devDependencies ?? {}).toEqual({
        '@io/business-domain': 'workspace:*',
        '@io/trust-kernel': 'workspace:*',
        '@types/pg': expect.any(String),
      });
    });

    it('is private strict-ESM', () => {
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe('module');
    });
  });

  describe('src — pg confined to pg-connection.ts; everything else driver-free (D4)', () => {
    const srcFiles = listTsFiles(srcDir);

    it('discovers real database src files (scan is non-trivial)', () => {
      expect(srcFiles.length).toBeGreaterThanOrEqual(4);
    });

    it('the forbidden-import detector actually catches a known offender', () => {
      const source = "import { Client } from 'pg';\nimport express from 'express';";
      const caught = extractImportSpecifiers(source).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );
      expect(caught).toEqual(['pg', 'express']);
    });

    it('pg is imported by EXACTLY one src file: pg-connection.ts', () => {
      const importers = srcFiles
        .filter((file) =>
          extractImportSpecifiers(readFileSync(file, 'utf8')).some((spec) => spec === 'pg'),
        )
        .map((file) => relative(pkgRoot, file));
      expect(importers).toEqual(['src/pg-connection.ts']);
    });

    for (const file of srcFiles) {
      if (file !== pgDriverOwner) {
        it(`${relative(pkgRoot, file)} imports nothing forbidden`, () => {
          const violations = extractImportSpecifiers(readFileSync(file, 'utf8')).filter((spec) =>
            forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
          );
          expect(violations).toEqual([]);
        });
      }

      it(`${relative(pkgRoot, file)} couples to @io/trust-kernel TYPE-ONLY`, () => {
        const valueImports = kernelValueImports(readFileSync(file, 'utf8'));
        expect(valueImports).toEqual([]);
      });
    }

    it('pg-connection.ts imports only pg + local relative modules (scoped exemption)', () => {
      const specs = extractImportSpecifiers(readFileSync(pgDriverOwner, 'utf8'));
      for (const spec of specs) {
        const isPg = spec === 'pg';
        const isLocal = spec.startsWith('.') || spec.startsWith('/');
        expect(isPg || isLocal).toBe(true);
      }
    });

    it('opens no real PostgreSQL connection outside pg-connection.ts', () => {
      const present: string[] = [];
      for (const file of srcFiles) {
        if (file === pgDriverOwner) continue; // exempt: it owns the pool (D6)
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const token of realPgTokens) {
          if (code.includes(token)) present.push(`${relative(pkgRoot, file)}: ${token}`);
        }
      }
      expect(present).toEqual([]);
    });

    it('pg-connection.ts owns a Pool and may checkout a client for transactions', () => {
      const code = stripComments(readFileSync(pgDriverOwner, 'utf8'));
      expect(code).toContain('new Pool');
      expect(code).not.toMatch(/new\s+Client/);
      // pool.connect() is allowed for transaction-scoped clients (BEGIN/COMMIT).
      expect(code).toMatch(/getPool\(\)\.connect\(/);
    });
  });

  describe('exclusions — no migration runner; integration enabled (Slice 3)', () => {
    it('ships no migration-runner directory', () => {
      const allFiles = existsSync(pkgRoot)
        ? readdirSync(pkgRoot, { recursive: true }).map((e) => e.toString())
        : [];
      const migrationsDir = allFiles.some(
        (path) => path.startsWith('migrations') || path.includes('migrations/'),
      );
      expect(migrationsDir).toBe(false);
    });

    it('openspec/config.yaml enables integration tests (Slice 3; D8)', () => {
      const config = readFileSync(join(repoRoot, 'openspec', 'config.yaml'), 'utf8');
      expect(config).toMatch(/integration:\s*true/);
    });
  });

  describe('schema DDL — evidence & audit tables (Req: Database Schema for Evidence and Audit)', () => {
    function readSql(): string {
      const path = join(pkgRoot, 'sql', '001_create_tables.sql');
      return existsSync(path) ? readFileSync(path, 'utf8') : '';
    }

    it('ships sql/001_create_tables.sql', () => {
      expect(existsSync(join(pkgRoot, 'sql', '001_create_tables.sql'))).toBe(true);
    });

    it('creates evidence and audit tables', () => {
      const sql = readSql();
      expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+evidence/i);
      expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+audit/i);
    });

    it('evidence and audit carry an id SERIAL PRIMARY KEY', () => {
      expect(readSql()).toMatch(/id\s+SERIAL\s+PRIMARY\s+KEY/i);
    });

    it('covers every PersistentRecord column with $N-compatible types', () => {
      const sql = readSql();
      for (const column of [
        'action_id',
        'principal_id',
        'risk_class',
        'decision',
        'reason',
        'timestamp',
        'persistent',
        'disclosure',
      ]) {
        expect(sql).toContain(column);
      }
      expect(sql).toMatch(/timestamp\s+BIGINT/i);
      expect(sql).toMatch(/persistent\s+BOOLEAN/i);
    });

    it('indexes evidence(action_id) as idx_evidence_action_id', () => {
      expect(readSql()).toMatch(
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_evidence_action_id\s+ON\s+evidence\s*\(\s*action_id\s*\)/i,
      );
    });
  });

  describe('canonical partition — excluded from 8 + 12 + 10 = 30', () => {
    const readme = readFileSync(join(pkgRoot, 'README.md'), 'utf8').toLowerCase();

    it('records the canonical partition and exclusion', () => {
      expect(readme).toContain('canonical');
      expect(readme).toContain('30');
      expect(readme).toContain('excluded');
    });
  });

  describe('public surface — structural assertions (no extra prod code)', () => {
    it('exports hardened database public surface including transaction + idempotency', () => {
      expect(databaseApi.PgEvidenceRepository).toBeTypeOf('function');
      expect(databaseApi.PgAuditRepository).toBeTypeOf('function');
      expect(databaseApi.PgCompanyRepository).toBeTypeOf('function');
      expect(databaseApi.PgDelegationRepository).toBeTypeOf('function');
      expect(databaseApi.PgWorkRepository).toBeTypeOf('function');
      expect(databaseApi.PgBusinessReceiptRepository).toBeTypeOf('function');
      expect(databaseApi.PgIdempotencyStore).toBeTypeOf('function');
      expect(databaseApi.PgDbConnection).toBeTypeOf('function');
      expect(databaseApi.NestedTransactionError).toBeTypeOf('function');
      // Type exports are erased; assert the namespace carries the runtime classes.
      expect(Object.keys(databaseApi).sort()).toEqual(
        [
          'NestedTransactionError',
          'PERSISTENT_PORT_DISCLOSURE',
          'PgAuditRepository',
          'PgBusinessReceiptRepository',
          'PgCompanyRepository',
          'PgDbConnection',
          'PgDelegationRepository',
          'PgEvidenceRepository',
          'PgIdempotencyStore',
          'PgWorkRepository',
        ].sort(),
      );
    });
  });
});
