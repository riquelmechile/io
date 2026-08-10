import { describe, expect, it } from 'vitest';

import type { EffectRecord, SandboxAction, SandboxPort } from '../../src/sandbox/sandbox-port.js';
import { InMemorySandbox } from '../../src/sandbox/in-memory-sandbox.js';

const docA: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/a.md',
  content: 'alpha',
};
const docB: SandboxAction = { type: 'create-document', relativePath: 'docs/b.md', content: 'beta' };

/**
 * SandboxPort recovery seam (SP snapshot-returns-applied): the port exposes
 * `snapshotUndoLog()` — the applied-effect source of truth a recovery needs to
 * distinguish "the effect ran" from "the effect never ran" after a crash. The
 * snapshot MUST return the currently-applied entries and EXCLUDE undone ones.
 */
describe('SandboxPort — snapshotUndoLog (SP snapshot-returns-applied)', () => {
  it('exposes snapshotUndoLog returning the applied effect records', async () => {
    const sandbox: SandboxPort = new InMemorySandbox();
    const a = await sandbox.execute(docA);
    await sandbox.execute(docB);

    const snapshot: readonly EffectRecord[] = sandbox.snapshotUndoLog();

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]?.undo.handleId).toBe(a.undo.handleId);
    expect(snapshot[0]?.applied).toBe(true);
  });

  it('excludes undone entries — only currently-applied effects are returned', async () => {
    const sandbox: SandboxPort = new InMemorySandbox();
    const a = await sandbox.execute(docA);
    await sandbox.execute(docB);

    await sandbox.undo(a.undo);

    const snapshot = sandbox.snapshotUndoLog();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.action.relativePath).toBe('docs/b.md');
  });

  it('returns an empty snapshot for a fresh sandbox (no effects executed)', async () => {
    const sandbox: SandboxPort = new InMemorySandbox();
    expect(sandbox.snapshotUndoLog()).toEqual([]);
  });
});
