import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

/**
 * Package boundary for @io/context (Req: Canonical Segment Ordering;
 * design D1/D4). The package is a PURE compiler: its ONLY runtime dependency
 * is `@io/business-domain` (types only — erased by tsc). No llm-client, no
 * openai, no app code, no SDK or transport may enter. The src-level import
 * scan lives with the compiler slice (task 4.2); this block pins the package
 * manifest.
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
});
