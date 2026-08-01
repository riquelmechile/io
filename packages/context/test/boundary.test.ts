import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcDir = join(pkgRoot, 'src');

/**
 * Forbidden specifiers for @io/context src (Req R7 / design D1/D4). The package
 * is a PURE compiler: the ONLY allowed external import is @io/business-domain
 * TYPES (erased by tsc). No llm-client, no openai/SDK, no app code, and no
 * I/O/network/subprocess builtins may enter — the compiler must stay pure and
 * byte-stable (Req R2/R6).
 */
const forbiddenSpecifiers: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'LLM/agentic SDK or framework',
    pattern:
      /^(openai|anthropic|@anthropic-ai|langchain|@langchain|langgraph|@ai-sdk|^ai$|crewai|autogen|mastra|paperclip|llamaindex|@llamaindex)(\/|$)/i,
  },
  {
    label: 'IO packages other than business-domain',
    pattern: /^@io\/(?!(business-domain)(\/|$))/,
  },
  {
    label: 'HTTP/framework server',
    pattern: /^(express|fastify|koa|hapi|polka|next|@nestjs)(\/|$)/,
  },
  {
    label: 'fetch/HTTP client',
    pattern: /^(node:)?(undici|fetch|axios|got|ky|node-fetch|superagent)(\/|$)/i,
  },
  { label: 'filesystem', pattern: /^(node:)?fs(\/|$)/ },
  { label: 'network', pattern: /^(node:)?(net|https?|dgram|dns|tls)(\/|$)/ },
  { label: 'subprocess/daemon', pattern: /^(node:)?(child_process|cluster|worker_threads)(\/|$)/ },
  { label: 'os/environment', pattern: /^(node:)?(os|process|path)(\/|$)/ },
];

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

/**
 * Package boundary for @io/context (Req: Canonical Segment Ordering;
 * design D1/D4). The package is a PURE compiler: its ONLY runtime dependency
 * is `@io/business-domain` (types only — erased by tsc). No llm-client, no
 * openai, no app code, no SDK or transport may enter. This block pins the
 * package manifest AND scans every src file's imports.
 */
describe('@io/context package boundary (design D1/D4)', () => {
  describe('package.json — business-domain is the single allowed runtime dep', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    it('is named @io/context', () => {
      expect(pkg.name).toBe('@io/context');
    });

    it('declares exactly one runtime dependency: @io/business-domain (workspace)', () => {
      expect(pkg.dependencies ?? {}).toEqual({ '@io/business-domain': 'workspace:*' });
    });

    it('declares the @types/node dev dependency for test/runtime typings', () => {
      expect(pkg.devDependencies ?? {}).toEqual({ '@types/node': expect.any(String) });
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

  describe('src — business-domain types only; zero llm-client/openai/app/forbidden builtins (D1/D4)', () => {
    const srcFiles = listTsFiles(srcDir);

    it('discovers real @io/context src files (scan is non-trivial)', () => {
      expect(srcFiles.length).toBeGreaterThanOrEqual(2);
    });

    it('the forbidden-import detector actually catches known offenders', () => {
      const source =
        "import OpenAI from 'openai';\nimport type { Work } from '@io/business-domain/src/index.js';\nimport { readFileSync } from 'node:fs';\nimport { complete } from '@io/llm-client';";
      const caught = extractImportSpecifiers(source).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );
      expect(caught).toEqual(['openai', 'node:fs', '@io/llm-client']);
    });

    it('every src file imports nothing forbidden', () => {
      expect(srcFiles.length).toBeGreaterThan(0);
      for (const file of srcFiles) {
        const violations = extractImportSpecifiers(readFileSync(file, 'utf8')).filter((spec) =>
          forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
        );
        expect(violations, relative(pkgRoot, file)).toEqual([]);
      }
    });

    it('every non-relative import is @io/business-domain, and it is TYPE-ONLY', () => {
      expect(srcFiles.length).toBeGreaterThan(0);
      for (const file of srcFiles) {
        const source = readFileSync(file, 'utf8');
        for (const spec of extractImportSpecifiers(source)) {
          if (spec.startsWith('.')) continue; // relative internal imports are fine
          expect(spec, relative(pkgRoot, file)).toMatch(/^@io\/business-domain\//);
        }
        // business-domain MUST be imported as types only (erased by tsc — no runtime dep).
        const bdImports = source.match(/import\s+([\s\S]*?)\s+from\s+['"]@io\/business-domain/g);
        if (bdImports !== null) {
          for (const bdImport of bdImports) {
            expect(bdImport, relative(pkgRoot, file)).toMatch(/^import\s+type\s/);
          }
        }
      }
    });
  });
});
