import type { EffectRecord, SandboxAction, SandboxPort, UndoHandle } from './sandbox-port.js';
import { resolveSandboxPath } from './sandbox-path.js';
import { UndoLog } from './undo-log.js';

/**
 * Reversible in-memory sandbox fake (SP fake-executes/undoes): a virtual
 * filesystem (absolutePath → content) behind the same {@link SandboxPort}
 * contract, with the undo log as the applied-state source of truth. Mirrors the
 * shipped {@link FileDocumentSandbox}: create-document on an existing path is
 * rejected (exclusive create) and paths are jailed under the root. NO real
 * I/O — used by unit tests and as the delegate of {@link DurableSandboxFake}.
 */
export class InMemorySandbox implements SandboxPort {
  private readonly effects = new Map<string, string>();
  private readonly undoLog = new UndoLog();
  private counter = 0;
  private readonly rootDir: string;

  constructor(rootDir = '/io/mem') {
    this.rootDir = rootDir;
  }

  async execute(action: SandboxAction): Promise<EffectRecord> {
    const absolutePath = resolveSandboxPath(this.rootDir, action.relativePath);
    if (this.effects.has(absolutePath)) {
      // Mirrors the adapter's exclusive create (wx): a second create of the
      // same document is rejected.
      throw new Error(`create-document failed: document already exists: ${action.relativePath}`);
    }
    const record = this.makeRecord(action, absolutePath);
    this.effects.set(absolutePath, action.content);
    this.undoLog.record(record);
    return record;
  }

  async undo(handle: UndoHandle): Promise<void> {
    const entry = this.undoLog.get(handle.handleId);
    if (entry === undefined) {
      throw new Error(`no undo entry for handle: ${handle.handleId}`);
    }
    this.effects.delete(entry.absolutePath);
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

  /** Snapshot the virtual filesystem (durable-fake persistence hook). */
  snapshotEffects(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.effects);
  }

  /** Replace the virtual filesystem (durable-fake restart). */
  restoreEffects(files: Readonly<Record<string, string>>): void {
    this.effects.clear();
    for (const [path, content] of Object.entries(files)) {
      this.effects.set(path, content);
    }
  }

  /** Snapshot the id generator (durable-fake persistence hook). */
  snapshotCounter(): number {
    return this.counter;
  }

  /** Restore the id generator (durable-fake restart). */
  restoreCounter(counter: number): void {
    this.counter = counter;
  }

  /** Snapshot the undo log (durable-fake persistence hook). */
  snapshotUndoLog(): readonly EffectRecord[] {
    return this.undoLog.snapshot();
  }

  /** Restore the undo log (durable-fake restart). */
  restoreUndoLog(entries: readonly EffectRecord[]): void {
    this.undoLog.restore(entries);
  }
}
