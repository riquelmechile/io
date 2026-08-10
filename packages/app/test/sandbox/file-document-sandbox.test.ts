import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EffectRecord, SandboxAction } from '../../src/sandbox/sandbox-port.js';
import { FileDocumentSandbox } from '../../src/sandbox/file-document-sandbox.js';
import { UndoLog } from '../../src/sandbox/undo-log.js';

const docA: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/a.md',
  content: 'alpha',
};
const docB: SandboxAction = { type: 'create-document', relativePath: 'docs/b.md', content: 'beta' };

interface PersistedSandboxState {
  readonly counter: number;
  readonly undoLog: readonly EffectRecord[];
}

function tmpRoot(): { dir: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'io-sandbox-fs-durable-'));
  return { dir, root: join(dir, 'root') };
}

/**
 * FileDocumentSandbox durability (SP execute-persists + restart-reconstructs +
 * undo-persists): the shipped adapter persists its undo log + id counter to
 * `<rootDir>/.io/undo-log.json` so the applied-effect SoT SURVIVES a process
 * restart. execute persists the entry BEFORE returning; undo persists the
 * removal; a fresh instance over the same rootDir reconstructs prior entries.
 */
describe('FileDocumentSandbox — durable undo log (SP execute-persists, restart-reconstructs)', () => {
  it('execute persists the undo-log entry to <rootDir>/.io/undo-log.json BEFORE returning', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      const record = await sandbox.execute(docA);

      const path = join(root, '.io', 'undo-log.json');
      expect(existsSync(path)).toBe(true);
      const persisted = JSON.parse(readFileSync(path, 'utf8')) as PersistedSandboxState;
      expect(persisted.counter).toBe(1);
      expect(persisted.undoLog).toHaveLength(1);
      expect(persisted.undoLog[0]?.undo.handleId).toBe(record.undo.handleId);
      expect(persisted.undoLog[0]?.action.relativePath).toBe('docs/a.md');
      expect(persisted.undoLog[0]?.applied).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a fresh instance over the same rootDir reconstructs the prior entries (restart)', async () => {
    const { dir, root } = tmpRoot();
    try {
      const first = new FileDocumentSandbox(root);
      const record = await first.execute(docA);

      const restarted = new FileDocumentSandbox(root);
      const snapshot = restarted.snapshotUndoLog();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]?.undo.handleId).toBe(record.undo.handleId);
      expect(snapshot[0]?.action.relativePath).toBe('docs/a.md');
      expect(snapshot[0]?.absolutePath).toBe(record.absolutePath);
      expect(await restarted.wasApplied(record.undo.handleId)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('undo persists the removal: the JSON file and the snapshot exclude the undone entry', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      const a = await sandbox.execute(docA);
      await sandbox.execute(docB);

      await sandbox.undo(a.undo);

      const persisted = JSON.parse(
        readFileSync(join(root, '.io', 'undo-log.json'), 'utf8'),
      ) as PersistedSandboxState;
      expect(persisted.undoLog).toHaveLength(1);
      expect(persisted.undoLog[0]?.action.relativePath).toBe('docs/b.md');
      expect(sandbox.snapshotUndoLog()).toHaveLength(1);
      expect(sandbox.snapshotUndoLog()[0]?.action.relativePath).toBe('docs/b.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('snapshotUndoLog returns currently-applied entries only (excludes undone)', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      const a = await sandbox.execute(docA);
      await sandbox.execute(docB);

      expect(sandbox.snapshotUndoLog()).toHaveLength(2);
      await sandbox.undo(a.undo);

      const snapshot = sandbox.snapshotUndoLog();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]?.action.relativePath).toBe('docs/b.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the counter survives a restart and a second execute increments it', async () => {
    const { dir, root } = tmpRoot();
    try {
      const first = new FileDocumentSandbox(root);
      const a = await first.execute(docA);
      expect(a.undo.handleId).toBe('undo-1');

      const restarted = new FileDocumentSandbox(root);
      const b = await restarted.execute(docB);
      expect(b.undo.handleId).toBe('undo-2');

      const persisted = JSON.parse(
        readFileSync(join(root, '.io', 'undo-log.json'), 'utf8'),
      ) as PersistedSandboxState;
      expect(persisted.counter).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a durability-persist failure still reverses the created file — NO leak survives', async () => {
    const { dir, root } = tmpRoot();
    try {
      // A durabilityPath whose parent cannot be created: persist() throws after
      // the effect file was written and the in-memory entry recorded. The
      // no-leak invariant MUST still hold: the file is reversed and the entry
      // dropped from the in-memory log.
      mkdirSync(root, { recursive: true });
      const blocked = join(root, 'blocked');
      writeFileSync(blocked, 'x', 'utf8'); // a FILE where a directory must go
      const sandbox = new FileDocumentSandbox(root, new UndoLog(), join(blocked, 'undo-log.json'));

      await expect(sandbox.execute(docA)).rejects.toThrow(/ENOTDIR|not a directory|mkdir/i);

      expect(existsSync(join(root, 'docs', 'a.md'))).toBe(false);
      expect(sandbox.snapshotUndoLog()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
