import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EffectRecord, SandboxAction } from '../src/sandbox/sandbox-port.js';
import { FileDocumentSandbox } from '../src/sandbox/file-document-sandbox.js';
import { UndoLog } from '../src/sandbox/undo-log.js';

const docA: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/a.md',
  content: 'alpha',
};

/**
 * FileDocumentSandbox (SP adapter-executes/undoes + no-leak(post-effect)): the
 * shipped reversible adapter. create-document is an EXCLUSIVE create (wx flag)
 * under a jailed rootDir; its concrete inverse is `unlink`; the undo log is the
 * applied-state source of truth; a post-effect failure reverses the created
 * file so NO leak remains. Tests run against real fs in a tmp dir.
 */
describe('FileDocumentSandbox — real filesystem effect (SP adapter)', () => {
  function tmpRoot(): { dir: string; root: string } {
    const dir = mkdtempSync(join(tmpdir(), 'io-sandbox-fs-'));
    return { dir, root: join(dir, 'root') };
  }

  it('create-document applies the real effect: the file exists with the exact content', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      const record = await sandbox.execute(docA);

      const file = join(root, 'docs', 'a.md');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('alpha');
      expect(record.absolutePath).toBe(file);
      expect(record.applied).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create-document is EXCLUSIVE (wx): a second create of the same path rejects', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      await sandbox.execute(docA);
      await expect(sandbox.execute(docA)).rejects.toThrow(/already exists|exists/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('undo = unlink: the effect is reversed to its prior (absent) state', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      const record = await sandbox.execute(docA);
      expect(existsSync(join(root, 'docs', 'a.md'))).toBe(true);

      await sandbox.undo(record.undo);

      expect(existsSync(join(root, 'docs', 'a.md'))).toBe(false);
      expect(await sandbox.wasApplied(record.undo.handleId)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wasApplied is truthful: true after execute, false after undo, false for unknown handles', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      const a = await sandbox.execute(docA);
      const b = await sandbox.execute({ ...docA, relativePath: 'docs/b.md' });

      expect(await sandbox.wasApplied(a.undo.handleId)).toBe(true);
      await sandbox.undo(a.undo);
      expect(await sandbox.wasApplied(a.undo.handleId)).toBe(false);
      expect(await sandbox.wasApplied(b.undo.handleId)).toBe(true);
      expect(await sandbox.wasApplied('undo-never')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a post-effect failure reverses the created file — NO leak (SP no-leak)', async () => {
    const { dir, root } = tmpRoot();
    try {
      const file = join(root, 'docs', 'a.md');
      let fileExistedWhenTheLogFailed = false;
      class FailingUndoLog extends UndoLog {
        override record(_entry: EffectRecord): void {
          // The effect file MUST already exist when the undo-log records it —
          // proves the failure happened AFTER the effect was applied.
          fileExistedWhenTheLogFailed = existsSync(file);
          throw new Error('undo log write failed');
        }
      }
      const sandbox = new FileDocumentSandbox(root, new FailingUndoLog());

      await expect(sandbox.execute(docA)).rejects.toThrow(/undo log write failed/);

      expect(fileExistedWhenTheLogFailed).toBe(true);
      expect(existsSync(file)).toBe(false); // no leak
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the jail rejects absolute paths and .. escapes; nested relative paths work', async () => {
    const { dir, root } = tmpRoot();
    try {
      const sandbox = new FileDocumentSandbox(root);
      await expect(sandbox.execute({ ...docA, relativePath: '/etc/passwd' })).rejects.toThrow(
        /absolute/i,
      );
      await expect(sandbox.execute({ ...docA, relativePath: '../escape.md' })).rejects.toThrow(
        /escapes|absolute/i,
      );

      const nested = await sandbox.execute({ ...docA, relativePath: 'a/b/c.md' });
      expect(existsSync(join(root, 'a', 'b', 'c.md'))).toBe(true);
      await sandbox.undo(nested.undo);
      expect(existsSync(join(root, 'a', 'b', 'c.md'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
