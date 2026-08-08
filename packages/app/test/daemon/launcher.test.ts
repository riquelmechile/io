import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

/**
 * ts-launcher resolve seam (task 3.1 / R7): `mapTsImport` is exercised purely,
 * WITHOUT registering hooks (registration lives in register.mjs — importing it
 * here would hijack vitest's own resolver). The `.mjs` module loads via a
 * dynamic import with a URL expression so tsc never resolves it as a typed
 * module.
 */
const HOOK_URL = new URL('../../src/daemon/ts-launcher/ts-hook.mjs', import.meta.url);
const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url));

type TsHookModule = {
  mapTsImport: (specifier: string, parentURL?: string) => string | undefined;
  resolve: (
    specifier: string,
    context: { parentURL?: string },
    nextResolve: (specifier: string, context: unknown) => { url: string },
  ) => { url: string };
};

async function loadHook(): Promise<TsHookModule> {
  return (await import(HOOK_URL.href)) as TsHookModule;
}

describe('ts-launcher resolve seam (R7)', () => {
  // Real parent from this tree: the mapped siblings must exist on disk.
  const daemonParent = new URL('../../src/daemon/daemon.ts', import.meta.url).href;

  it.each([
    ['./config.js', '../../src/daemon/config.ts'],
    ['../supervisor/types.js', '../../src/supervisor/types.ts'],
  ] as const)('maps relative %s to its sibling .ts source', async (specifier, expectedRelative) => {
    const hook = await loadHook();
    const url = hook.mapTsImport(specifier, daemonParent);
    const expected = new URL(expectedRelative, import.meta.url).href;
    expect(url).toBe(expected);
    expect(existsSync(fileURLToPath(url as string))).toBe(true);
  });

  it.each([
    [
      '@io/database/src/pg-connection.js',
      join(PACKAGES_DIR, 'database', 'src', 'pg-connection.ts'),
    ],
    ['@io/llm-client/src/index.js', join(PACKAGES_DIR, 'llm-client', 'src', 'index.ts')],
  ] as const)('maps %s to the packages/<pkg> .ts source', async (specifier, expectedPath) => {
    const hook = await loadHook();
    const url = hook.mapTsImport(specifier, daemonParent);
    expect(url).toBe(pathToFileURL(expectedPath).href);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('defers everything else to Node resolution', async () => {
    const hook = await loadHook();
    expect(hook.mapTsImport('pg', daemonParent)).toBeUndefined();
    expect(hook.mapTsImport('node:path', daemonParent)).toBeUndefined();
    expect(hook.mapTsImport('@io/database', daemonParent)).toBeUndefined(); // no exports map
    expect(hook.mapTsImport('./no-such-file.js', daemonParent)).toBeUndefined();
  });

  it('resolve maps handled specifiers and never calls nextResolve', async () => {
    const hook = await loadHook();
    const nextResolve = vi.fn(() => ({ url: 'file:///unused.js' }));
    const result = hook.resolve('./config.js', { parentURL: daemonParent }, nextResolve);
    expect(result.url).toBe(new URL('../../src/daemon/config.ts', import.meta.url).href);
    expect(nextResolve).not.toHaveBeenCalled();
  });

  it('resolve defers unhandled specifiers to nextResolve unchanged', async () => {
    const hook = await loadHook();
    const nextResolve = vi.fn((specifier: string) => ({ url: `file:///resolved/${specifier}` }));
    const result = hook.resolve('node:path', { parentURL: daemonParent }, nextResolve);
    expect(result.url).toBe('file:///resolved/node:path');
    expect(nextResolve).toHaveBeenCalledWith('node:path', { parentURL: daemonParent });
  });
});
