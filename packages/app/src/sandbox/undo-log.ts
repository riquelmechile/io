import type { EffectRecord } from './sandbox-port.js';

/**
 * Undo log — the source of truth for whether an effect was applied. Exactly one
 * entry per executed effect (`record` rejects a duplicate handle); `remove`
 * drops the entry when the effect is reversed, so `applied(handleId)` is
 * truthful at any point in the cycle. `snapshot`/`restore` let a durable
 * sandbox survive a simulated restart.
 */
export class UndoLog {
  private readonly entries = new Map<string, EffectRecord>();

  /** Record the effect's undo entry. Rejects a duplicate handleId — exactly
   * one entry per executed effect. */
  record(entry: EffectRecord): void {
    if (this.entries.has(entry.undo.handleId)) {
      throw new Error(`undo entry already recorded: ${entry.undo.handleId}`);
    }
    this.entries.set(entry.undo.handleId, entry);
  }

  /** The recorded entry for `handleId`, or undefined. */
  get(handleId: string): EffectRecord | undefined {
    return this.entries.get(handleId);
  }

  /** Undo log = SoT: the effect is applied iff its entry is still recorded. */
  applied(handleId: string): boolean {
    return this.entries.has(handleId);
  }

  /** Drop the entry after the effect was reversed. Rejects an unknown handle. */
  remove(handleId: string): void {
    if (!this.entries.delete(handleId)) {
      throw new Error(`no undo entry for handle: ${handleId}`);
    }
  }

  /** Every recorded entry (durable-fake persistence hook). */
  snapshot(): readonly EffectRecord[] {
    return [...this.entries.values()];
  }

  /** Replace the recorded entries from a snapshot (durable-fake restart). */
  restore(entries: readonly EffectRecord[]): void {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.undo.handleId, entry);
    }
  }
}
