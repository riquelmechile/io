import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EffectRecord, SandboxAction } from '../../src/sandbox/sandbox-port.js';
import { FileDocumentSandbox } from '../../src/sandbox/file-document-sandbox.js';

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

/**
 * LIVE durability restart (SP restart-reconstructs — live verification, no
 * PostgreSQL: the effect store IS the filesystem): a real FileDocumentSandbox
 * over a real temp rootDir survives a SIMULATED process restart — a brand-new
 * instance over the same rootDir reconstructs the undo log and the id counter
 * from `<rootDir>/.io/undo-log.json`, and the reconstructed effects stay
 * re-playable (undo reverses the real file, the removal persists).
 */
describe('FileDocumentSandbox — live filesystem durability restart', () => {
  it('a simulated process restart reconstructs undo log + counter; effects re-playable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-sandbox-live-restart-'));
    try {
      const root = join(dir, 'root');

      // "Process 1": a live sandbox executes two effects.
      const first = new FileDocumentSandbox(root);
      const a = await first.execute(docA);
      const b = await first.execute(docB);
      expect(existsSync(a.absolutePath)).toBe(true);
      expect(existsSync(b.absolutePath)).toBe(true);

      // The undo log + counter are persisted as honest JSON under the root.
      const path = join(root, '.io', 'undo-log.json');
      expect(existsSync(path)).toBe(true);
      const persisted = JSON.parse(readFileSync(path, 'utf8')) as PersistedSandboxState;
      expect(persisted.counter).toBe(2);
      expect(persisted.undoLog).toHaveLength(2);

      // "Process 2" (simulated restart): a brand-new instance over the SAME
      // rootDir — no shared in-memory state. The undo log and counter are
      // reconstructed from the JSON file.
      const restarted = new FileDocumentSandbox(root);
      const snapshot = restarted.snapshotUndoLog();
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0]?.undo.handleId).toBe(a.undo.handleId);
      expect(snapshot[1]?.undo.handleId).toBe(b.undo.handleId);
      expect(await restarted.wasApplied(a.undo.handleId)).toBe(true);
      expect(await restarted.wasApplied(b.undo.handleId)).toBe(true);

      // The counter survived the restart: the next effect continues the sequence.
      const c = await restarted.execute({ ...docA, relativePath: 'docs/c.md' });
      expect(c.undo.handleId).toBe('undo-3');
      expect(restarted.snapshotUndoLog()).toHaveLength(3);

      // Reconstructed effects are re-playable: undo a RESTORED entry through
      // the fresh instance reverses the real file, and the removal persists.
      await restarted.undo(b.undo);
      expect(existsSync(b.absolutePath)).toBe(false);
      expect(await restarted.wasApplied(b.undo.handleId)).toBe(false);
      const afterUndo = JSON.parse(readFileSync(path, 'utf8')) as PersistedSandboxState;
      expect(afterUndo.counter).toBe(3);
      expect(afterUndo.undoLog.map((entry) => entry.action.relativePath)).toEqual([
        'docs/a.md',
        'docs/c.md',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
