import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Daemon boot smoke against LIVE PostgreSQL (task 3.5 / R2 + R5) — the slice's
 * runtime harness: spawns the REAL entrypoint through the zero-dep ts-launcher
 * exactly as the `start` script does. Boot must survive several tick windows
 * (R2 readiness probe passes), then SIGTERM must drain and exit 0 (R5). Skips
 * itself when PostgreSQL is unreachable; designed for sequential runs
 * (`pnpm vitest run --no-file-parallelism` per tasks.md).
 */
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_DATABASE_URL = 'postgresql://io:io_dev@localhost:5432/io_dev';
const BOOT_GRACE_MS = 1100; // several 250 ms tick windows — boot must survive them
const SHUTDOWN_TIMEOUT_MS = 15_000;

function databaseReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return Promise.resolve(false);
    }
    host = parsed.hostname;
    port = parsed.port === '' ? 5432 : Number(parsed.port);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const done = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolvePromise(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

describe('daemon boot smoke — live PostgreSQL (R2/R5)', () => {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

  it('entrypoint boots against live PG, drains on SIGTERM, exits 0', {
    timeout: 30_000,
  }, async (ctx) => {
    if (!(await databaseReachable(databaseUrl))) {
      return ctx.skip(); // live-PG gate: skip when PostgreSQL is unreachable
    }

    const child = spawn(
      process.execPath,
      [
        '--experimental-transform-types',
        '--import',
        './src/daemon/ts-launcher/register.mjs',
        './src/daemon/main.ts',
      ],
      {
        cwd: APP_DIR,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          DEEPSEEK_API_KEY: 'sk-smoke-test',
          IO_SANDBOX_ROOT: join(tmpdir(), 'io-daemon-smoke-sandbox'),
          IO_INTERVAL_MS: '250',
          IO_PROPOSER: 'smoke-proposer',
          IO_APPROVER: 'smoke-approver',
          IO_EXECUTOR: 'smoke-executor',
          IO_VERIFIER: 'smoke-verifier',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolvePromise) => {
        child.once('exit', (code, signal) => resolvePromise({ code, signal }));
      },
    );

    try {
      // R2: a spontaneously exiting daemon during boot grace is a boot failure
      // (PG was reachable, so this is a real failure, not a skip).
      const stayedAlive = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolvePromise) => {
          setTimeout(() => resolvePromise(true), BOOT_GRACE_MS);
        }),
      ]);
      if (!stayedAlive) {
        throw new Error(
          `daemon exited during boot grace — probe failed (stderr: ${stderr || '(empty)'})`,
        );
      }

      // R4 first signal → R5 graceful shutdown: drain → close → exit 0.
      child.kill('SIGTERM');
      const result = await Promise.race([
        exited,
        new Promise<{ code: null; signal: NodeJS.Signals }>((resolvePromise) => {
          setTimeout(() => {
            child.kill('SIGKILL');
            resolvePromise({ code: null, signal: 'SIGKILL' });
          }, SHUTDOWN_TIMEOUT_MS);
        }),
      ]);

      expect(result).toEqual({ code: 0, signal: null });
      expect(stderr).not.toContain('[daemon] boot failed');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });
});
