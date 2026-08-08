import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JournalFakePersistence } from '@io/business-domain/src/ports/fakes.js';
import { DurableJournalFake } from '@io/business-domain/src/ports/fakes.js';
import type { JournalEntry } from '@io/business-domain/src/ports/idempotency.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { describe, expect, it } from 'vitest';
import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';
import type {
  EffectRecord,
  SandboxAction,
  SandboxPort,
  UndoHandle,
} from '../src/sandbox/sandbox-port.js';
import { runWorker } from '../src/worker/worker.js';
import { harness, seed, workerInput } from './worker-helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');

/**
 * B10 — App boundary, assembled wiring (SP composition-root at the app level):
 * the ASSEMBLED app (worker + fakes + sandbox + finalize, wired through
 * `runWorker`) composes end to end WITHOUT re-exporting business-domain or
 * trust-kernel internals, and `openai` stays confined to `deepseek-client.ts`.
 * The assembly smoke test runs the FULL cycle over the JSON-durable fakes
 * (journal + sandbox) + the terminal-close connection — proving the wiring
 * Slice B assembled actually composes — and asserts the verify step runs
 * between the effect and the terminal close. The structural scans (re-exports,
 * openai) mirror A9 but now sweep the worker modules too.
 */

/** DbConnection double that counts committed vs rolled-back transactions. */
class TxTrackingConnection implements DbConnection {
  commits = 0;
  rollbacks = 0;
  constructor(private readonly inner: DbConnection) {}

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    return this.inner.execute(sql, params);
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    return this.inner.query<T>(sql, params);
  }

  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    try {
      const result = await this.inner.transaction(fn);
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

function jsonFilePersistence(path: string): JournalFakePersistence {
  return {
    load() {
      return existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as readonly JournalEntry[])
        : [];
    },
    save(entries) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(entries));
    },
  };
}

/** Sandbox double that traces every port call into the shared phase trace. */
class TraceSandbox implements SandboxPort {
  readonly undos: UndoHandle[] = [];
  private readonly inner = new InMemorySandbox();

  constructor(private readonly trace?: string[]) {}

  async execute(action: SandboxAction): Promise<EffectRecord> {
    this.trace?.push(`sandbox:execute:${action.relativePath}`);
    return this.inner.execute(action);
  }

  async undo(handle: UndoHandle): Promise<void> {
    this.undos.push(handle);
    return this.inner.undo(handle);
  }

  async wasApplied(handleId: string): Promise<boolean> {
    this.trace?.push('sandbox:verify:wasApplied');
    return this.inner.wasApplied(handleId);
  }
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, entry.toString()))
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));
}

function extractReExports(source: string): string[] {
  const specs: string[] = [];
  const reExport = /export\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(reExport)) specs.push(match[1] ?? '');
  return specs;
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticImport = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticImport)) specs.push(match[1] ?? '');
  for (const match of source.matchAll(dynamicImport)) specs.push(match[1] ?? '');
  return specs;
}

describe('@io/app assembled wiring (SP composition-root, app level)', () => {
  it('the assembled app composes end to end: claim → authority → intent → reconcile → effect → verify → finalize over the durable fakes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-app-boundary-'));
    try {
      const journalPath = join(dir, 'journal.json');
      const h = harness();
      await seed(h);
      const journal = new DurableJournalFake(jsonFilePersistence(journalPath));
      const sandbox = new TraceSandbox(h.trace);
      const conn = new TxTrackingConnection(new InMemoryDbConnection());

      const result = await runWorker(
        workerInput(),
        {
          ...h,
          journal,
          sandbox,
          connection: conn,
          // The durable journal must reach the finalize twin's T1 too (the
          // repository factory binds the journal the close writes to).
          repositories: () => ({ work: h.work, receipts: h.receipts, journal, events: h.events }),
        },
        'flash',
      );

      expect(result.ok).toBe(true);
      if (!result.ok || 'replayed' in result) return;
      expect(result.work.state).toBe('completed');
      expect(h.receipts.saves).toHaveLength(1);
      expect(conn.commits).toBe(1);
      expect(conn.rollbacks).toBe(0);
      // The assembled wiring includes the verify step, between the effect and the close.
      const executeIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:execute'));
      const verifyIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:verify:wasApplied'));
      expect(executeIdx).toBeGreaterThanOrEqual(0);
      expect(verifyIdx).toBeGreaterThan(executeIdx);
      // The durable journal row reached the terminal close (completed), replayable.
      expect((await journal.lookup('acme', 'close-2026-q3'))?.status).toBe('completed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no packages/app src file re-exports business-domain or trust-kernel internals (worker modules included)', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(join(pkgRoot, 'src'))) {
      const hit = extractReExports(readFileSync(file, 'utf8')).find(
        (spec) => spec.startsWith('@io/business-domain') || spec.startsWith('@io/trust-kernel'),
      );
      if (hit !== undefined) offenders.push(`${relative(pkgRoot, file)}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the worker modules import domain/kernel types (composition) but never re-export them', () => {
    const workerFiles = listTsFiles(join(pkgRoot, 'src', 'worker'));
    expect(workerFiles.length).toBeGreaterThanOrEqual(7);
    const importsDomain = workerFiles.some((file) =>
      extractImportSpecifiers(readFileSync(file, 'utf8')).some((spec) =>
        spec.startsWith('@io/business-domain'),
      ),
    );
    expect(importsDomain).toBe(true); // non-vacuous: the worker IS the composition root
    for (const file of workerFiles) {
      const leaked = extractReExports(readFileSync(file, 'utf8')).filter(
        (spec) => spec.startsWith('@io/business-domain') || spec.startsWith('@io/trust-kernel'),
      );
      expect(leaked).toEqual([]);
    }
  });

  it('openai appears ONLY in llm-client/src/deepseek-client.ts across every package src tree', () => {
    const offenders: string[] = [];
    for (const pkg of ['business-domain', 'database', 'trust-kernel', 'llm-client', 'app']) {
      const pkgSrc = join(repoRoot, 'packages', pkg, 'src');
      for (const file of listTsFiles(pkgSrc)) {
        const rel = relative(repoRoot, file);
        if (rel === 'packages/llm-client/src/deepseek-client.ts') continue;
        const importsOpenai = extractImportSpecifiers(readFileSync(file, 'utf8')).some(
          (spec) => spec === 'openai',
        );
        if (importsOpenai) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
    const owner = readFileSync(
      join(repoRoot, 'packages', 'llm-client', 'src', 'deepseek-client.ts'),
      'utf8',
    );
    expect(extractImportSpecifiers(owner)).toContain('openai');
  });
});
