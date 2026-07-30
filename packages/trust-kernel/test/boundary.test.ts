import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { transitionalDescriptor } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcDir = join(pkgRoot, 'src');

/**
 * Forbidden module specifiers for the kernel boundary (Req 1): the trust kernel
 * is persistence-free, adapter-free, and free of network, database, daemon, LLM,
 * and agentic/business frameworks. Relative imports between kernel modules are
 * allowed; only external/builtin offenders are rejected.
 */
const forbiddenSpecifiers: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'filesystem/persistence', pattern: /^(node:)?fs(\/|$)/ },
  { label: 'network', pattern: /^(node:)?(net|https?|dgram)(\/|$)/ },
  { label: 'subprocess/daemon', pattern: /^(node:)?(child_process|cluster)(\/|$)/ },
  {
    label: 'database adapter',
    pattern:
      /^(pg|postgres|postgresql|mysql|mariadb|sqlite|mongodb|redis|knex|prisma|typeorm|sequelize|drizzle-orm|mssql)(\/|$)/i,
  },
  {
    label: 'HTTP/framework server',
    pattern: /^(express|fastify|koa|hapi|polka|next|@nestjs)(\/|$)/,
  },
  {
    label: 'LLM/agentic framework',
    pattern:
      /^(openai|anthropic|@anthropic-ai|langchain|@langchain|langgraph|@ai-sdk|^ai$|crewai|autogen|mastra|paperclip|llamaindex|@llamaindex)(\/|$)/i,
  },
];

describe('trust-kernel transitional boundary', () => {
  describe('package.json — no runtime dependencies (Req 1)', () => {
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

    it('is private strict-ESM', () => {
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe('module');
    });
  });

  describe('src — no persistence/adapter/network/db/daemon/LLM/framework imports (Req 1)', () => {
    const srcFiles = listTsFiles(srcDir);

    it('discovers real kernel src files (scan is non-trivial)', () => {
      expect(srcFiles.length).toBeGreaterThan(0);
    });

    it('the forbidden-import detector actually catches a known offender', () => {
      const source = "import { readFileSync } from 'node:fs';\nimport express from 'express';";
      const caught = extractImportSpecifiers(source).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );

      expect(caught).toEqual(['node:fs', 'express']);
    });

    for (const file of srcFiles) {
      it(`${relative(pkgRoot, file)} imports nothing forbidden`, () => {
        const specifiers = extractImportSpecifiers(readFileSync(file, 'utf8'));
        const violations = specifiers.filter((spec) =>
          forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
        );

        expect(violations).toEqual([]);
      });
    }
  });

  describe('README — transitional, not canonical, extraction targets recorded (Req 1, 10)', () => {
    const readme = readFileSync(join(pkgRoot, 'README.md'), 'utf8').toLowerCase();

    it('is marked transitional', () => {
      expect(readme).toContain('transitional');
    });

    it('is excluded from the 8 + 12 + 10 = 30 canonical partition', () => {
      expect(readme).toContain('canonical');
      expect(readme).toContain('30');
    });

    it('records all six extraction targets', () => {
      for (const target of [
        'organization',
        'policy',
        'approvals',
        'evidence',
        'receipts',
        'audit',
      ]) {
        expect(readme).toContain(target);
      }
    });
  });

  describe('public surface — pure, no surviving state (Req 1)', () => {
    it('returns an honest transitional descriptor with independent values per call', () => {
      const a = transitionalDescriptor();
      const b = transitionalDescriptor();

      expect(a.packageId).toBe('trust-kernel');
      expect(a.transitional).toBe(true);
      expect(a.canonicalPartitionExcluded).toBe(true);
      expect(a.extractionTargets).toEqual([
        'organization',
        'policy',
        'approvals',
        'evidence',
        'receipts',
        'audit',
      ]);
      // Equal value but distinct references: no shared mutable module state leaks.
      expect(a).toEqual(b);
      expect(a.extractionTargets).not.toBe(b.extractionTargets);
    });

    it('never shares the extraction-target array across repeated calls', () => {
      const arrays = [
        transitionalDescriptor(),
        transitionalDescriptor(),
        transitionalDescriptor(),
      ].map((descriptor) => descriptor.extractionTargets);
      const fixture = ['organization', 'policy', 'approvals', 'evidence', 'receipts', 'audit'];

      // Every reference is mutually distinct, yet all carry equal content.
      expect(arrays[0]).not.toBe(arrays[1]);
      expect(arrays[0]).not.toBe(arrays[2]);
      expect(arrays[1]).not.toBe(arrays[2]);
      expect(arrays[0]).toEqual(fixture);
      expect(arrays[1]).toEqual(fixture);
      expect(arrays[2]).toEqual(fixture);
    });
  });
});

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, entry.toString()))
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticImport = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticImport)) specs.push(match[1] ?? '');
  for (const match of source.matchAll(dynamicImport)) specs.push(match[1] ?? '');
  return specs;
}
