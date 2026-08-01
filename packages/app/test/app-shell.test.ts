import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');

/**
 * @io/app workspace shell (Slice A1). The composition root is a first-class
 * workspace member: package.json + per-package tsconfig, wired into the root
 * tsconfig/tsconfig.build typecheck+build, covered by the pnpm-workspace
 * honesty comment, and resolvable by pnpm install. Structural test — RED until
 * the shell files land, GREEN once `pnpm install` + `pnpm check` pass.
 */
describe('@io/app workspace shell (Slice A1)', () => {
  const pkgPath = join(pkgRoot, 'package.json');
  const pkg = (existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {}) as Record<
    string,
    unknown
  >;

  it('ships packages/app/package.json as @io/app (private strict-ESM)', () => {
    expect(pkg.name).toBe('@io/app');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
  });

  it('declares the four first-party deps as workspace:* (business-domain, database, trust-kernel, llm-client)', () => {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    expect(deps).toEqual({
      '@io/business-domain': 'workspace:*',
      '@io/database': 'workspace:*',
      '@io/llm-client': 'workspace:*',
      '@io/trust-kernel': 'workspace:*',
    });
  });

  it('ships packages/app/tsconfig.json extending the root tsconfig', () => {
    const tsconfigPath = join(pkgRoot, 'tsconfig.json');
    expect(existsSync(tsconfigPath)).toBe(true);
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as { extends?: string };
    expect(tsconfig.extends).toContain('tsconfig.json');
  });

  it('the root tsconfig.json typechecks packages/app/**', () => {
    const root = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8')) as {
      include?: string[];
    };
    expect(root.include ?? []).toContain('packages/app/**/*.ts');
  });

  it('tsconfig.build.json builds packages/app/src/**', () => {
    const build = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.build.json'), 'utf8')) as {
      include?: string[];
    };
    expect(build.include ?? []).toContain('packages/app/src/**/*.ts');
  });

  it('the pnpm-workspace honesty comment no longer claims "no vertical logic"', () => {
    const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('packages/app');
    expect(workspace).not.toContain('no vertical logic');
  });
});
