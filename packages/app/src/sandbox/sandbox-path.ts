import { resolve, sep } from 'node:path';

/**
 * Resolve a sandbox action's `relativePath` inside a JAILED `rootDir`: rejects
 * absolute paths and any path that would escape the root via `..`, so an action
 * can only ever touch files under the sandbox root. Shared by every sandbox
 * implementation so the fakes mirror the adapter's jail exactly.
 */
export function resolveSandboxPath(rootDir: string, relativePath: string): string {
  if (relativePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new Error(`absolute path rejected in sandbox action: ${relativePath}`);
  }
  const root = resolve(rootDir);
  const resolved = resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes the sandbox root: ${relativePath}`);
  }
  return resolved;
}
