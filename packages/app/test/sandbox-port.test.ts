import { describe, expect, it } from 'vitest';

import type { EffectRecord, SandboxAction, SandboxPort } from '../src/sandbox/sandbox-port.js';
import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';
import { UndoLog } from '../src/sandbox/undo-log.js';

const docA: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/a.md',
  content: 'alpha',
};
const docB: SandboxAction = { type: 'create-document', relativePath: 'docs/b.md', content: 'beta' };

/**
 * SandboxPort contract (SP reversible-port + universal-reversibility): the
 * driven port of the composition root. execute returns an effect record + undo
 * handle; undo reverses the effect; the undo log holds EXACTLY one entry per
 * executed effect and is the source of truth for whether the effect was applied.
 */
describe('SandboxPort contract (SP reversible-port)', () => {
  it('execute returns an effect record and an undo handle for a create-document action', async () => {
    const sandbox: SandboxPort = new InMemorySandbox();

    const record: EffectRecord = await sandbox.execute(docA);

    expect(record.action).toEqual(docA);
    expect(record.applied).toBe(true);
    expect(record.absolutePath).toContain('docs/a.md');
    expect(record.undo.handleId).toBeTruthy();
    expect(record.undo.action).toEqual(docA);
    expect(record.undo.applied).toBe(true);
  });

  it('undo reverses the effect: wasApplied flips to false and the path is creatable again', async () => {
    const sandbox = new InMemorySandbox();
    const first = await sandbox.execute(docA);
    expect(await sandbox.wasApplied(first.undo.handleId)).toBe(true);

    await sandbox.undo(first.undo);

    expect(await sandbox.wasApplied(first.undo.handleId)).toBe(false);
    // The prior value was fully reversed — a fresh create of the same document succeeds.
    const second = await sandbox.execute(docA);
    expect(second.undo.handleId).not.toBe(first.undo.handleId);
    expect(await sandbox.wasApplied(second.undo.handleId)).toBe(true);
  });

  it('undo of an unknown handle rejects (no fabricated reversal)', async () => {
    const sandbox = new InMemorySandbox();
    await expect(
      sandbox.undo({ handleId: 'undo-ghost', action: docA, applied: true }),
    ).rejects.toThrow(/undo entry|handle/i);
  });
});

describe('Undo log = source of truth for applied state (SP universal-reversibility)', () => {
  it('one undo-log entry per executed effect; the log reflects applied state truthfully', async () => {
    const sandbox = new InMemorySandbox();

    const a = await sandbox.execute(docA);
    const b = await sandbox.execute(docB);

    expect(await sandbox.wasApplied(a.undo.handleId)).toBe(true);
    expect(await sandbox.wasApplied(b.undo.handleId)).toBe(true);

    await sandbox.undo(a.undo);

    expect(await sandbox.wasApplied(a.undo.handleId)).toBe(false);
    expect(await sandbox.wasApplied(b.undo.handleId)).toBe(true);
  });

  it('wasApplied for a handle that was never recorded is false', async () => {
    const sandbox = new InMemorySandbox();
    expect(await sandbox.wasApplied('undo-never')).toBe(false);
  });
});

describe('UndoLog module (one entry per effect)', () => {
  function record(effectId: string, handleId: string, absolutePath: string): EffectRecord {
    return {
      effectId,
      action: docA,
      absolutePath,
      applied: true,
      undo: { handleId, action: docA, applied: true },
    };
  }

  it('records exactly one entry per effect and rejects a duplicate handle', () => {
    const log = new UndoLog();
    log.record(record('e1', 'undo-1', '/mem/docs/a.md'));
    expect(log.applied('undo-1')).toBe(true);
    expect(log.get('undo-1')?.effectId).toBe('e1');
    expect(() => log.record(record('e1', 'undo-1', '/mem/docs/a.md'))).toThrow(/already/i);
  });

  it('remove drops the entry (effect reversed — no longer applied) and re-remove rejects', () => {
    const log = new UndoLog();
    log.record(record('e1', 'undo-1', '/mem/docs/a.md'));
    log.remove('undo-1');
    expect(log.applied('undo-1')).toBe(false);
    expect(() => log.remove('undo-1')).toThrow(/no undo entry/i);
  });

  it('snapshot/restore round-trips entries (durable-fake persistence hook)', () => {
    const log = new UndoLog();
    log.record(record('e1', 'undo-1', '/mem/docs/a.md'));
    log.record(record('e2', 'undo-2', '/mem/docs/b.md'));

    const restored = new UndoLog();
    restored.restore(log.snapshot());

    expect(restored.applied('undo-1')).toBe(true);
    expect(restored.applied('undo-2')).toBe(true);
    expect(restored.get('undo-1')?.effectId).toBe('e1');
  });
});
