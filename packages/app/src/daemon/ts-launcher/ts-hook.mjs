// Zero-dependency Node 24 module-resolution hook for the daemon TypeScript
// entrypoint (design "main.ts + launcher", task 3.2): Node's type stripping
// loads only explicit `.ts` files, and the daemon source imports with `.js`
// suffixes (NodeNext) while the workspace packages expose no `exports` map.
// This hook rewrites, in the resolve phase only:
//   - relative `./x.js` specifiers to the sibling `./x.ts` source, and
//   - bare `@io/<pkg>/<subpath>` specifiers to `packages/<pkg>/<subpath>`
//     source (`.js` → sibling `.ts`).
// Everything else (builtins, real node_modules packages) defers to Node via
// `nextResolve`. Pure `node:*` builtins — no runtime dependencies. This file
// is PLAIN JavaScript (`.mjs`): type stripping applies to the `.ts` files it
// resolves, not to itself. `mapTsImport` is the R7-tested seam; `resolve` is
// the `registerHooks` hook wired up by `register.mjs`.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Five levels up from packages/app/src/daemon/ts-launcher/ is the repo root.
const PACKAGES_DIR = fileURLToPath(new URL('../../../../../packages', import.meta.url));

/** `.js`-suffixed target → sibling `.ts` file URL, or `undefined` to defer. */
function tsSibling(target) {
  if (!target.endsWith('.js')) {
    return undefined;
  }
  const ts = `${target.slice(0, -3)}.ts`;
  return existsSync(ts) ? pathToFileURL(ts).href : undefined;
}

/**
 * Pure mapping seam (R7): map a source specifier to the TypeScript file that
 * should load; `undefined` defers to Node's default resolution.
 */
export function mapTsImport(specifier, parentURL) {
  if (specifier.startsWith('@io/')) {
    const rest = specifier.slice('@io/'.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      return undefined; // bare package: no exports map in this repo — defer
    }
    return tsSibling(join(PACKAGES_DIR, rest.slice(0, slash), rest.slice(slash + 1)));
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && parentURL !== undefined) {
    return tsSibling(join(dirname(fileURLToPath(parentURL)), specifier));
  }
  return undefined;
}

/** `node:module` `registerHooks` resolve hook — maps or defers. */
export function resolve(specifier, context, nextResolve) {
  const mapped = mapTsImport(specifier, context && context.parentURL);
  if (mapped !== undefined) {
    return { url: mapped, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
