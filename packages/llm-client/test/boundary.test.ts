import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as llmClientApi from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcDir = join(pkgRoot, 'src');

/**
 * Boundary guards for the llm-client package (Req: LlmClient Port Purity;
 * design D2/D4). The package ships ONE allowed runtime dependency (`openai`),
 * confined to `src/deepseek-client.ts`: everywhere else stays SDK-free,
 * driver-free, and framework-free. The port (`llm-client.ts`) carries ZERO SDK
 * or transport knowledge. Coupling between modules is type-only where the port
 * is involved (tsc erases `import type`).
 */
const forbiddenSpecifiers: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'LLM/agentic SDK or framework',
    pattern:
      /^(openai|anthropic|@anthropic-ai|langchain|@langchain|langgraph|@ai-sdk|^ai$|crewai|autogen|mastra|paperclip|llamaindex|@llamaindex)(\/|$)/i,
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
];

/** The single src file permitted to import `openai` and own the SDK client (D4/D6). */
const driverOwner = join(srcDir, 'deepseek-client.ts');

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

describe('llm-client package boundary (Req: LlmClient Port Purity; D2/D4)', () => {
  describe('package.json — openai is the single allowed runtime dep', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    it('declares exactly one allowed runtime dependency: openai', () => {
      expect(pkg.dependencies ?? {}).toEqual({ openai: expect.any(String) });
      expect((pkg.dependencies as Record<string, string>).openai).toMatch(/^\^?7\./);
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

  describe('src — openai confined to deepseek-client.ts; everything else SDK-free (D4)', () => {
    const srcFiles = listTsFiles(srcDir);

    it('discovers real llm-client src files (scan is non-trivial)', () => {
      expect(srcFiles.length).toBeGreaterThanOrEqual(4);
    });

    it('the forbidden-import detector actually catches a known offender', () => {
      const source = "import OpenAI from 'openai';\nimport express from 'express';";
      const caught = extractImportSpecifiers(source).filter((spec) =>
        forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
      );
      expect(caught).toEqual(['openai', 'express']);
    });

    it('openai is imported by EXACTLY one src file: deepseek-client.ts', () => {
      const importers = srcFiles
        .filter((file) =>
          extractImportSpecifiers(readFileSync(file, 'utf8')).some((spec) => spec === 'openai'),
        )
        .map((file) => relative(pkgRoot, file));
      expect(importers).toEqual(['src/deepseek-client.ts']);
    });

    for (const file of srcFiles) {
      if (file !== driverOwner) {
        it(`${relative(pkgRoot, file)} imports nothing forbidden`, () => {
          const violations = extractImportSpecifiers(readFileSync(file, 'utf8')).filter((spec) =>
            forbiddenSpecifiers.some((rule) => rule.pattern.test(spec)),
          );
          expect(violations).toEqual([]);
        });
      }
    }

    it('deepseek-client.ts imports only openai + local relative modules (scoped exemption)', () => {
      const specs = extractImportSpecifiers(readFileSync(driverOwner, 'utf8'));
      for (const spec of specs) {
        const isOpenai = spec === 'openai';
        const isLocal = spec.startsWith('.') || spec.startsWith('/');
        expect(isOpenai || isLocal).toBe(true);
      }
    });

    it('the port (llm-client.ts) imports nothing at all (zero SDK/transport)', () => {
      const portSpecs = extractImportSpecifiers(
        readFileSync(join(srcDir, 'llm-client.ts'), 'utf8'),
      );
      expect(portSpecs).toEqual([]);
    });
  });

  describe('public surface — structural assertions (no extra prod code)', () => {
    it('exports DeepSeekClient, FakeLlmClient, computeCost, LlmError, and the disclosure', () => {
      expect(llmClientApi.DeepSeekClient).toBeTypeOf('function');
      expect(llmClientApi.FakeLlmClient).toBeTypeOf('function');
      expect(llmClientApi.computeCost).toBeTypeOf('function');
      expect(llmClientApi.LlmError).toBeTypeOf('function');
      expect(llmClientApi.LLM_FAKE_DISCLOSURE).toBeTypeOf('string');
      // Type exports are erased; assert the namespace carries only the runtime values.
      expect(Object.keys(llmClientApi).sort()).toEqual(
        [
          'DeepSeekClient',
          'FakeLlmClient',
          'LLM_FAKE_DISCLOSURE',
          'LlmError',
          'computeCost',
          'deepseekApiKey',
        ].sort(),
      );
    });
  });
});
