import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { EffectRecord, SandboxAction, SandboxPort, UndoHandle } from './sandbox-port.js';
import { resolveSandboxPath } from './sandbox-path.js';
import { UndoLog } from './undo-log.js';

/**
 * Shipped reversible adapter (SP adapter-executes/undoes + no-leak): executes
 * `create-document` as a REAL exclusive filesystem create (`wx` flag — fails
 * when the document already exists) under a JAILED `rootDir` (absolute paths
 * and `..` escapes are rejected), and reverses it with its concrete inverse
 * `unlink`. The undo log is the source of truth for applied state, and a
 * post-effect failure reverses the created file so NO leak survives. One
 * undo-log entry per executed effect.
 */
export class FileDocumentSandbox implements SandboxPort {
  private readonly rootDir: string;
  private readonly undoLog: UndoLog;
  private counter = 0;

  constructor(rootDir: string, undoLog: UndoLog = new UndoLog()) {
    this.rootDir = resolve(rootDir);
    this.undoLog = undoLog;
  }

  async execute(action: SandboxAction): Promise<EffectRecord> {
    const absolutePath = resolveSandboxPath(this.rootDir, action.relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    try {
      // Exclusive create (wx): the real effect, applied as one atomic-ish step.
      writeFileSync(absolutePath, action.content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      throw new Error(
        `create-document failed: ${action.relativePath} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const record = this.makeRecord(action, absolutePath);
    try {
      this.undoLog.record(record);
    } catch (error) {
      // Post-effect failure (e.g. undo-log write): reverse the created file —
      // NO leak may survive a failed execute.
      unlinkSync(absolutePath);
      throw error;
    }
    return record;
  }

  async undo(handle: UndoHandle): Promise<void> {
    const entry = this.undoLog.get(handle.handleId);
    if (entry === undefined) {
      throw new Error(`no undo entry for handle: ${handle.handleId}`);
    }
    // The concrete inverse of create-document is unlink.
    unlinkSync(entry.absolutePath);
    this.undoLog.remove(handle.handleId);
  }

  async wasApplied(handleId: string): Promise<boolean> {
    return this.undoLog.applied(handleId);
  }

  private makeRecord(action: SandboxAction, absolutePath: string): EffectRecord {
    this.counter += 1;
    const effectId = `effect-${this.counter}`;
    const handleId = `undo-${this.counter}`;
    return {
      effectId,
      action,
      absolutePath,
      applied: true,
      undo: { handleId, action, applied: true },
    };
  }
}
