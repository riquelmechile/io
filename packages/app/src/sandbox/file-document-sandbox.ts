import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { EffectRecord, SandboxAction, SandboxPort, UndoHandle } from './sandbox-port.js';
import { resolveSandboxPath } from './sandbox-path.js';
import { UndoLog } from './undo-log.js';

/** The persisted undo-log state: the applied-effect SoT + the id generator,
 * JSON-encoded at `<rootDir>/.io/undo-log.json` so a restarted process can
 * reconstruct both. Mirrors `DurableSandboxFake`'s durability model. */
interface PersistedSandboxState {
  readonly counter: number;
  readonly undoLog: readonly EffectRecord[];
}

/**
 * Shipped reversible adapter (SP adapter-executes/undoes + no-leak +
 * execute-persists + restart-reconstructs): executes `create-document` as a
 * REAL exclusive filesystem create (`wx` flag — fails when the document already
 * exists) under a JAILED `rootDir` (absolute paths and `..` escapes are
 * rejected), and reverses it with its concrete inverse `unlink`. The undo log
 * is the source of truth for applied state, and a post-effect failure reverses
 * the created file so NO leak survives. One undo-log entry per executed effect.
 *
 * DURABILITY (supervisor-recovery, decision D1): the undo log + id counter are
 * persisted to `durabilityPath` (default `<rootDir>/.io/undo-log.json`) after
 * every mutation, and restored on construct — the applied-effect SoT survives a
 * process restart so recovery can truthfully distinguish applied from unapplied
 * effects. Process-restart durability only (OS page cache); physical-media
 * fsync is explicitly out of scope (spec sandbox-port).
 */
export class FileDocumentSandbox implements SandboxPort {
  private readonly rootDir: string;
  private readonly durabilityPath: string;
  private readonly undoLog: UndoLog;
  private counter = 0;

  constructor(rootDir: string, undoLog: UndoLog = new UndoLog(), durabilityPath?: string) {
    this.rootDir = resolve(rootDir);
    this.undoLog = undoLog;
    this.durabilityPath = durabilityPath ?? join(this.rootDir, '.io', 'undo-log.json');
    this.restore();
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
      // Persist the evidence BEFORE success is reported (spec scenario
      // "Execute persists recovery evidence"): the durable log must never lag
      // the reported outcome.
      this.persist();
    } catch (error) {
      // Post-effect failure (undo-log write OR durability persist): reverse the
      // created file and drop the recorded entry — NO leak may survive a failed
      // execute, and the persisted evidence must not claim an effect that was
      // reversed.
      if (this.undoLog.applied(record.undo.handleId)) {
        this.undoLog.remove(record.undo.handleId);
      }
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
    // Persist the removal so a restart does not resurrect a reversed effect.
    this.persist();
  }

  async wasApplied(handleId: string): Promise<boolean> {
    return this.undoLog.applied(handleId);
  }

  /** Every currently-applied effect record (effect SoT — recovery evidence).
   * Excludes undone entries; reconstructed from the durable log on construct. */
  snapshotUndoLog(): readonly EffectRecord[] {
    return this.undoLog.snapshot();
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

  /** Persist `{counter, undoLog}` to the durability path (mirrors
   * `DurableSandboxFake.persist`). Creates the `.io` directory as needed. */
  private persist(): void {
    const state: PersistedSandboxState = {
      counter: this.counter,
      undoLog: this.undoLog.snapshot(),
    };
    mkdirSync(dirname(this.durabilityPath), { recursive: true });
    writeFileSync(this.durabilityPath, JSON.stringify(state, null, 2), 'utf8');
  }

  /** Reconstruct the undo log + counter from the durable file on construct. */
  private restore(): void {
    if (!existsSync(this.durabilityPath)) return;
    const state = JSON.parse(readFileSync(this.durabilityPath, 'utf8')) as PersistedSandboxState;
    this.counter = state.counter;
    this.undoLog.restore(state.undoLog);
  }
}
