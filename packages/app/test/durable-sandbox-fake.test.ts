import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SandboxAction } from '../src/sandbox/sandbox-port.js';
import { DurableSandboxFake } from '../src/sandbox/durable-sandbox-fake.js';

const docA: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/a.md',
  content: 'alpha',
};
const docB: SandboxAction = { type: 'create-document', relativePath: 'docs/b.md', content: 'beta' };

/**
 * DurableSandboxFake (SP fake-mirrors-durability, acceptance note 3 model): a
 * JSON-durable in-memory sandbox. A fresh instance over the same durability
 * path simulates a process restart — the undo log AND the effect state must
 * survive, and mutations must persist.
 */
describe('DurableSandboxFake — restart-safe via JSON durabilityPath', () => {
  function tmpStatePath(): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'io-durable-sandbox-'));
    return { dir, path: join(dir, 'sandbox-state.json') };
  }

  it('the undo log survives a restart (wasApplied still true for prior effects)', async () => {
    const { dir, path } = tmpStatePath();
    try {
      const first = new DurableSandboxFake(path);
      const a = await first.execute(docA);
      await first.execute(docB);

      const second = new DurableSandboxFake(path); // simulated restart
      expect(await second.wasApplied(a.undo.handleId)).toBe(true);
      expect(await second.wasApplied(a.undo.handleId)).toBe(true);
      expect(await second.wasApplied('undo-never')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the effect state survives a restart (duplicate-path rejection still fires)', async () => {
    const { dir, path } = tmpStatePath();
    try {
      const first = new DurableSandboxFake(path);
      await first.execute(docA);

      const second = new DurableSandboxFake(path); // simulated restart
      await expect(second.execute(docA)).rejects.toThrow(/already exists|exists/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('undo after a restart reverses the effect and the removal persists across another restart', async () => {
    const { dir, path } = tmpStatePath();
    try {
      const first = new DurableSandboxFake(path);
      const a = await first.execute(docA);

      const second = new DurableSandboxFake(path); // restart
      await second.undo(a.undo);
      expect(await second.wasApplied(a.undo.handleId)).toBe(false);

      const third = new DurableSandboxFake(path); // restart again
      expect(await third.wasApplied(a.undo.handleId)).toBe(false);
      await expect(third.execute(docA)).resolves.toMatchObject({ applied: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the persisted state is honest JSON (survives a process restart, not just a re-instantiation)', async () => {
    const { dir, path } = tmpStatePath();
    try {
      const first = new DurableSandboxFake(path);
      const a = await first.execute(docA);

      expect(existsSync(path)).toBe(true);
      const persisted = JSON.parse(readFileSync(path, 'utf8')) as { undoLog?: unknown[] };
      // A fresh persistence READ (new file handle → JSON parse) reconstructs the state.
      expect(persisted.undoLog?.length).toBeGreaterThanOrEqual(1);
      expect(await new DurableSandboxFake(path).wasApplied(a.undo.handleId)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('new effects after a restart are recorded AND persisted', async () => {
    const { dir, path } = tmpStatePath();
    try {
      const first = new DurableSandboxFake(path);
      await first.execute(docA);

      const second = new DurableSandboxFake(path); // restart
      const b = await second.execute(docB);

      const third = new DurableSandboxFake(path); // restart again
      expect(await third.wasApplied(b.undo.handleId)).toBe(true);
      await expect(third.execute(docB)).rejects.toThrow(/already exists|exists/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
