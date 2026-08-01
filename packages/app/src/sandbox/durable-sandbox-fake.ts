import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { EffectRecord, SandboxAction, SandboxPort, UndoHandle } from './sandbox-port.js';
import { InMemorySandbox } from './in-memory-sandbox.js';

interface DurableSandboxState {
  readonly effects: Readonly<Record<string, string>>;
  readonly counter: number;
  readonly undoLog: readonly EffectRecord[];
}

/**
 * JSON-durable in-memory sandbox (SP fake-mirrors-durability, acceptance note 3
 * model): wraps {@link InMemorySandbox} and persists the FULL state (virtual
 * filesystem + undo log + id generator) to `durabilityPath` after every
 * mutation. A fresh instance over the same path simulates a process restart —
 * the undo log and effect state survive, exactly like the durable journal fake
 * and the live-PostgreSQL journal proven in Slice C. NOT a real filesystem.
 */
export class DurableSandboxFake implements SandboxPort {
  private readonly delegate: InMemorySandbox;
  private readonly durabilityPath: string;

  constructor(durabilityPath: string) {
    this.durabilityPath = durabilityPath;
    this.delegate = new InMemorySandbox();
    this.restore();
  }

  async execute(action: SandboxAction): Promise<EffectRecord> {
    const record = await this.delegate.execute(action);
    this.persist();
    return record;
  }

  async undo(handle: UndoHandle): Promise<void> {
    await this.delegate.undo(handle);
    this.persist();
  }

  async wasApplied(handleId: string): Promise<boolean> {
    return this.delegate.wasApplied(handleId);
  }

  private persist(): void {
    const state: DurableSandboxState = {
      effects: this.delegate.snapshotEffects(),
      counter: this.delegate.snapshotCounter(),
      undoLog: this.delegate.snapshotUndoLog(),
    };
    mkdirSync(dirname(this.durabilityPath), { recursive: true });
    writeFileSync(this.durabilityPath, JSON.stringify(state, null, 2), 'utf8');
  }

  private restore(): void {
    if (!existsSync(this.durabilityPath)) return;
    const state = JSON.parse(readFileSync(this.durabilityPath, 'utf8')) as DurableSandboxState;
    this.delegate.restoreEffects(state.effects);
    this.delegate.restoreCounter(state.counter);
    this.delegate.restoreUndoLog(state.undoLog);
  }
}
