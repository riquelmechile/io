import { describe, expect, it } from 'vitest';

import type { SandboxAction } from '../src/sandbox/sandbox-port.js';
import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';

const docA: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/a.md',
  content: 'alpha',
};

/**
 * InMemorySandbox parity (SP fake-executes/undoes + fake mirrors the adapter):
 * the in-memory fake must behave like the shipped FileDocumentSandbox — the
 * same exclusive-create rejection and the same jailed root.
 */
describe('InMemorySandbox (SP fake-executes/undoes)', () => {
  it('execute/undo round-trips: wasApplied true → false and the path is creatable again', async () => {
    const sandbox = new InMemorySandbox();
    const record = await sandbox.execute(docA);
    expect(record.applied).toBe(true);

    await sandbox.undo(record.undo);

    expect(await sandbox.wasApplied(record.undo.handleId)).toBe(false);
    await expect(sandbox.execute(docA)).resolves.toMatchObject({ applied: true });
  });

  it('mirrors the adapter exclusive create: a second create of the same path is rejected', async () => {
    const sandbox = new InMemorySandbox();
    await sandbox.execute(docA);
    await expect(sandbox.execute(docA)).rejects.toThrow(/already exists|exists/i);
  });

  it('mirrors the adapter jail: absolute paths and .. escapes are rejected', async () => {
    const sandbox = new InMemorySandbox();
    await expect(sandbox.execute({ ...docA, relativePath: '/etc/passwd' })).rejects.toThrow(
      /absolute/i,
    );
    await expect(sandbox.execute({ ...docA, relativePath: '../escape.md' })).rejects.toThrow(
      /escapes|absolute/i,
    );
  });

  it('nested relative paths resolve inside the virtual root', async () => {
    const sandbox = new InMemorySandbox();
    const record = await sandbox.execute({
      ...docA,
      relativePath: 'sub/dir/a.md',
    });
    expect(record.absolutePath).toContain('sub/dir/a.md');
    expect(record.absolutePath).toContain('/io/mem');
  });

  it('two distinct paths are independent (triangulation)', async () => {
    const sandbox = new InMemorySandbox();
    const a = await sandbox.execute(docA);
    const b = await sandbox.execute({ ...docA, relativePath: 'docs/b.md' });

    await sandbox.undo(a.undo);
    expect(await sandbox.wasApplied(b.undo.handleId)).toBe(true);
    await expect(sandbox.execute(docA)).resolves.toMatchObject({ applied: true });
    await expect(sandbox.execute({ ...docA, relativePath: 'docs/b.md' })).rejects.toThrow(
      /already exists/i,
    );
  });
});
