import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcDir = join(pkgRoot, 'src');
const repoRoot = join(pkgRoot, '..', '..');

/**
 * Composition-root boundary guards (SP composition-root, Slice A9): the app
 * owns the sandbox driven port and MUST NOT re-export business-domain or
 * trust-kernel internals, and the `openai` SDK MUST stay confined to
 * `deepseek-client.ts`. Structural test — scans the workspace src trees.
 */
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

/** Re-export statements (`export ... from`) — the only forbidden shape. */
function extractReExports(source: string): string[] {
  const specs: string[] = [];
  const reExport = /export\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(reExport)) specs.push(match[1] ?? '');
  return specs;
}

describe('@io/app composition-root boundary (SP composition-root)', () => {
  const srcFiles = listTsFiles(srcDir);

  it('discovers the sandbox modules in packages/app/src (scan is non-trivial)', () => {
    expect(srcFiles.length).toBeGreaterThanOrEqual(5);
    for (const file of srcFiles) {
      const rel = relative(pkgRoot, file);
      if (rel.startsWith('src/sandbox/')) {
        expect(rel).toMatch(/^src\/sandbox\/.+\.ts$/);
      }
    }
  });

  it('no packages/app src file re-exports business-domain or trust-kernel internals', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      const specifiers = extractReExports(readFileSync(file, 'utf8'));
      const hit = specifiers.find(
        (spec) => spec.startsWith('@io/business-domain') || spec.startsWith('@io/trust-kernel'),
      );
      if (hit !== undefined) offenders.push(`${relative(pkgRoot, file)}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the sandbox modules do not re-export business-domain or trust-kernel internals (scenario)', () => {
    const sandboxFiles = srcFiles.filter((file) => relative(srcDir, file).startsWith('sandbox/'));
    expect(sandboxFiles.length).toBeGreaterThanOrEqual(5);
    for (const file of sandboxFiles) {
      const specifiers = extractReExports(readFileSync(file, 'utf8'));
      const leaked = specifiers.filter(
        (spec) => spec.startsWith('@io/business-domain') || spec.startsWith('@io/trust-kernel'),
      );
      expect(leaked).toEqual([]);
    }
  });

  it('openai appears ONLY in llm-client/src/deepseek-client.ts across every package src tree', () => {
    const offenders: string[] = [];
    for (const pkg of ['business-domain', 'database', 'trust-kernel', 'llm-client', 'app']) {
      const pkgSrc = join(repoRoot, 'packages', pkg, 'src');
      for (const file of listTsFiles(pkgSrc)) {
        const rel = relative(repoRoot, file);
        if (rel === 'packages/llm-client/src/deepseek-client.ts') continue; // the sole owner
        const importsOpenai = extractImportSpecifiers(readFileSync(file, 'utf8')).some(
          (spec) => spec === 'openai',
        );
        if (importsOpenai) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
    // The owner itself DOES import it (guard is non-vacuous).
    const owner = readFileSync(
      join(repoRoot, 'packages', 'llm-client', 'src', 'deepseek-client.ts'),
      'utf8',
    );
    expect(extractImportSpecifiers(owner)).toContain('openai');
  });
});
