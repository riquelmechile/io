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
 * Boundary & exclusion guards for the database package (Req 5, scenario 2). The
 * package is a driver-free, framework-free adapter slice: no `pg` import, no real
 * PostgreSQL connection, no migrations, `integration: false`, zero runtime deps,
 * and TYPE-ONLY coupling to @io/trust-kernel. It stays excluded from the
 * 8+12+10=30 canonical partition.
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
  describe('package.json — zero runtime deps; type-only kernel coupling (D4)', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    it('declares zero runtime dependencies', () => {
      expect(pkg.dependencies ?? {}).toEqual({});
    });

    it('declares zero peer/optional/bundle dependencies', () => {
      expect(pkg.peerDependencies ?? {}).toEqual({});
      expect(pkg.optionalDependencies ?? {}).toEqual({});
      expect(pkg.bundleDependencies ?? pkg.bundledDependencies ?? {}).toEqual({});
    });

    it('declares @io/trust-kernel only as a devDependency', () => {
      expect(pkg.devDependencies ?? {}).toEqual({ '@io/trust-kernel': 'workspace:*' });
    });

    it('is private strict-ESM', () => {
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe('module');
    });
  });

  describe('src — no driver/framework/db/daemon/LLM imports (threat: leakage)', () => {
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

    for (const file of srcFiles) {
      it(`${relative(pkgRoot, file)} imports nothing forbidden`, () => {
        const violations = extractImportSpecifiers(readFileSync(file, 'utf8')).filter((spec) =>
          forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
        );
        expect(violations).toEqual([]);
      });

      it(`${relative(pkgRoot, file)} couples to @io/trust-kernel TYPE-ONLY`, () => {
        const valueImports = kernelValueImports(readFileSync(file, 'utf8'));
        expect(valueImports).toEqual([]);
      });
    }

    it('opens no real PostgreSQL connection anywhere in src', () => {
      const present: string[] = [];
      for (const file of srcFiles) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const token of realPgTokens) {
          if (code.includes(token)) present.push(`${relative(pkgRoot, file)}: ${token}`);
        }
      }
      expect(present).toEqual([]);
    });
  });

  describe('exclusions — no real PG, no migrations, integration disabled', () => {
    it('has no migration directory or .sql files', () => {
      const allFiles = existsSync(pkgRoot)
        ? readdirSync(pkgRoot, { recursive: true }).map((e) => e.toString())
        : [];
      const sqlFiles = allFiles.filter((path) => path.endsWith('.sql'));
      const migrationsDir = allFiles.some(
        (path) => path.startsWith('migrations') || path.includes('migrations/'),
      );
      expect(sqlFiles).toEqual([]);
      expect(migrationsDir).toBe(false);
    });

    it('openspec/config.yaml keeps integration tests disabled', () => {
      const config = readFileSync(join(repoRoot, 'openspec', 'config.yaml'), 'utf8');
      expect(config).toMatch(/integration:\s*false/);
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
    it('exports DbConnection, DbRow, PgEvidenceRepository, PgAuditRepository', () => {
      expect(databaseApi.PgEvidenceRepository).toBeTypeOf('function');
      expect(databaseApi.PgAuditRepository).toBeTypeOf('function');
      // Type exports are erased; assert the namespace carries the runtime classes.
      expect(Object.keys(databaseApi).sort()).toEqual(
        ['PERSISTENT_PORT_DISCLOSURE', 'PgAuditRepository', 'PgEvidenceRepository'].sort(),
      );
    });
  });
});
