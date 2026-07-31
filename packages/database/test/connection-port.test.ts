import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { DbConnection, DbRow } from '../src/connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const connectionSource = readSource('src/connection.ts');

/**
 * Forbidden module specifiers for the DbConnection port (Req 1, scenario 2):
 * the connection is a driver-free, ORM-free, framework-free seam. SQL lives
 * ONLY in adapters — the port itself MUST carry zero table/schema knowledge.
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
  {
    label: 'LLM/agentic framework',
    pattern:
      /^(openai|anthropic|@anthropic-ai|langchain|@langchain|langgraph|@ai-sdk|^ai$|crewai|autogen|mastra|paperclip|llamaindex|@llamaindex)(\/|$)/i,
  },
];

/**
 * SQL / schema tokens the port MUST NOT mention: tables, columns, or statement
 * keywords. Their presence would mean the connection knows about the schema,
 * violating "SQL lives ONLY in adapters" (Req 1, scenario 2; threat: leakage).
 */
const schemaTokens = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'INTO',
  'FROM',
  'WHERE',
  'ORDER BY',
  'evidence',
  'audit',
  'action_id',
  'principal_id',
  'risk_class',
];

function readSource(rel: string): string {
  const abs = join(pkgRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`expected source file not found: ${rel} (RED until connection.ts exists)`);
  }
  return readFileSync(abs, 'utf8');
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticImport = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticImport)) specs.push(match[1] ?? '');
  for (const match of source.matchAll(dynamicImport)) specs.push(match[1] ?? '');
  return specs;
}

/**
 * Strip comments so schema-awareness is measured against CODE/types only, not
 * architectural documentation (the port legitimately explains "SQL lives in
 * adapters" in JSDoc). A real violation — a table/column referenced in a type or
 * runtime value — is still caught because it lives in code, not comments.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('DbConnection port interface (Req 1)', () => {
  describe('asynchronous execute and query (scenario 1)', () => {
    it('execute returns a Promise<unknown> (asynchronous; NOT a synchronous value)', () => {
      // The real `pg` driver is TCP-based and fundamentally async; a Promise
      // return is the only honest completion contract.
      expectTypeOf<DbConnection['execute']>().returns.toMatchTypeOf<Promise<unknown>>();
      // A sync `unknown` return does NOT satisfy Promise<unknown>.
      expectTypeOf<DbConnection['execute']>().returns.not.toEqualTypeOf<unknown>();
    });

    it('execute accepts a sql string and a readonly params array', () => {
      expectTypeOf<DbConnection['execute']>().parameter(0).toEqualTypeOf<string>();
      expectTypeOf<DbConnection['execute']>().parameter(1).toEqualTypeOf<readonly unknown[]>();
    });

    it('query returns a Promise<readonly row array> (asynchronous; NOT synchronous)', () => {
      // An async query<T> is assignable to a function returning Promise<rows>,
      // and is NOT assignable to one returning rows synchronously.
      expectTypeOf<DbConnection['query']>().toMatchTypeOf<
        (sql: string, params: readonly unknown[]) => Promise<readonly DbRow[]>
      >();
      expectTypeOf<DbConnection['query']>().not.toMatchTypeOf<
        (sql: string, params: readonly unknown[]) => readonly DbRow[]
      >();
    });

    it('query accepts a sql string and a readonly params array', () => {
      expectTypeOf<DbConnection['query']>().parameter(0).toEqualTypeOf<string>();
      expectTypeOf<DbConnection['query']>().parameter(1).toEqualTypeOf<readonly unknown[]>();
    });
  });

  describe('no driver types or schema knowledge (scenario 2; threat: leakage)', () => {
    it('the forbidden-import detector actually catches a known offender', () => {
      const source = "import { Client } from 'pg';\nimport express from 'express';";
      const caught = extractImportSpecifiers(source).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );

      expect(caught).toEqual(['pg', 'express']);
    });

    it('connection.ts imports nothing forbidden', () => {
      const violations = extractImportSpecifiers(connectionSource).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );

      expect(violations).toEqual([]);
    });

    it('connection.ts carries zero table/schema awareness', () => {
      const code = stripComments(connectionSource);
      const present = schemaTokens.filter((token) => code.includes(token));

      expect(present).toEqual([]);
    });
  });
});
