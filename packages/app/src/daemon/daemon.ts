import type { DbConnection } from '@io/database/src/connection.js';
import { PgDbConnection } from '@io/database/src/pg-connection.js';
import { DeepSeekClient, type LlmClient } from '@io/llm-client/src/index.js';

import { buildSupervisorDispatch } from '../composition/supervisor-dispatch.js';
import { startSupervisor } from '../supervisor/supervisor.js';
import type { DaemonConfig } from './config.js';
import { createProductionSchedule } from './schedule.js';
import type { DrainableSchedule } from './schedule.js';

/**
 * Daemon lifecycle orchestrator (spec R2 Database Readiness + Migration
 * Prerequisite, R4 Process Signal Handling, R5 Ordered Graceful Shutdown;
 * design "Interfaces / Contracts"). A thin hexagonal adapter composing the
 * EXISTING `buildSupervisorDispatch` → `startSupervisor` roots with a
 * production no-overlap + drain {@link DrainableSchedule} — protected cores
 * stay byte-identical (R6).
 *
 * Boot: after config validation (slice 1a), a `SELECT 1` readiness probe (R2)
 * runs BEFORE any scheduling; probe failure exits 1 without ever constructing
 * the dispatch or schedule. Migrations are NEVER applied — migrations 001–009
 * remain an operator prerequisite. Signals: the first SIGTERM/SIGINT starts
 * graceful shutdown EXACTLY once; a second termination signal forces immediate
 * exit(1) without awaiting cleanup (R4). Graceful shutdown order: stop
 * scheduling → drain in-flight work → close the database pool → close the LLM
 * client → exit 0 (R5) — resources close even with no tick in flight.
 *
 * Every side effect is injectable via {@link DaemonHooks} so the whole
 * lifecycle is deterministic under test with NO real timers, NO live
 * PostgreSQL, and NO `process.on`/`process.exit` (R7).
 */

/**
 * The `SELECT 1` readiness probe (R2). Fails by rejecting — a rejected probe
 * aborts boot before any scheduling.
 */
async function defaultProbe(connection: {
  execute(sql: string, params: readonly unknown[]): Promise<unknown>;
}): Promise<void> {
  await connection.execute('SELECT 1', []);
}

/** Injectable lifecycle seams (design "Interfaces / Contracts"). */
export type DaemonHooks = {
  /** Signal registration; default: `process.on`. */
  readonly registerSignal?: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void;
  /** Process exit; default: `process.exit`. */
  readonly exit?: (code: number) => void;
  /** Readiness probe; default: `SELECT 1`. */
  readonly probe?: (connection: {
    execute(sql: string, params: readonly unknown[]): Promise<unknown>;
  }) => Promise<void>;
  /** Pool-bound connection factory; default: real `PgDbConnection`. */
  readonly createConnection?: (url: string) => DbConnection & { close(): Promise<void> };
  /** LLM client factory; default: real `DeepSeekClient`. */
  readonly createLlm?: (apiKey: string) => LlmClient & { close(): Promise<void> };
  /** Schedule factory; default: production no-overlap + drain schedule. */
  readonly createSchedule?: () => DrainableSchedule;
  /** Composition root; default: real `buildSupervisorDispatch`. */
  readonly buildDispatch?: typeof buildSupervisorDispatch;
  /** Supervisor activator; default: real `startSupervisor`. */
  readonly startSupervisor?: typeof startSupervisor;
};

/**
 * Run the daemon until a termination signal triggers shutdown. Resolves once
 * graceful shutdown completes (after `exit(0)` is invoked) or immediately on
 * boot failure (after `exit(1)`).
 */
export async function runDaemon(config: DaemonConfig, hooks: DaemonHooks = {}): Promise<void> {
  const registerSignal = hooks.registerSignal ?? ((signal, handler) => process.on(signal, handler));
  const exit = hooks.exit ?? ((code) => process.exit(code));
  const createConnection = hooks.createConnection ?? ((url) => new PgDbConnection(url));
  const createLlm = hooks.createLlm ?? ((apiKey) => new DeepSeekClient({ apiKey }));
  const createSchedule = hooks.createSchedule ?? (() => createProductionSchedule());
  const buildDispatch = hooks.buildDispatch ?? buildSupervisorDispatch;
  const start = hooks.startSupervisor ?? startSupervisor;
  const probe = hooks.probe ?? defaultProbe;

  // R2: readiness probe BEFORE scheduling. Boot failure exits 1 before any
  // schedule/dispatch exists; NO migration is ever attempted.
  const connection = createConnection(config.databaseUrl);
  try {
    await probe(connection);
  } catch (error) {
    console.error('[daemon] boot failed: database readiness probe failed:', error);
    exit(1);
    return;
  }

  const llm = createLlm(config.deepseekApiKey);
  const schedule = createSchedule();
  const { deps, onActivate, onRecovery } = buildDispatch({
    connection,
    llm,
    sandboxRoot: config.sandboxRoot,
    principals: config.principals,
  });
  const supervisor = start(deps, {
    intervalMs: config.intervalMs,
    onActivate,
    // The recovery seam (supervisor-recovery design D4): the composition root
    // closes over work/journal/sandbox and resumes operator-designated
    // orphaned `in_progress` Work AFTER activation, BEFORE the cursor
    // checkpoint, on both decision branches. Threading it here is what makes
    // recovery actually run in production — the daemon boot fails fast on a
    // probe failure BEFORE any of this is constructed (R2).
    onRecovery,
    schedule: schedule.schedule,
  });

  let shuttingDown = false;
  let finishShutdown: () => void = () => {};
  const shutdownComplete = new Promise<void>((resolve) => {
    finishShutdown = resolve;
  });

  // R5 order: stop scheduling → drain work → close db → close llm → exit 0.
  const gracefulShutdown = async (): Promise<void> => {
    supervisor.stop();
    try {
      await schedule.drain();
      await connection.close();
      await llm.close();
      exit(0);
    } catch (error) {
      // A rejecting shutdown step must never strand the process: an unhandled
      // rejection here would leave `shutdownComplete` unresolved, hanging
      // `runDaemon` forever with no error surfaced. Log and exit non-zero.
      console.error('[daemon] graceful shutdown failed:', error);
      exit(1);
    } finally {
      finishShutdown();
    }
  };

  const handleSignal = (): void => {
    if (shuttingDown) {
      // R4 scenario 2: a second termination signal forces immediate
      // termination WITHOUT awaiting drain or closure.
      exit(1);
      return;
    }
    shuttingDown = true;
    // R4 scenario 1: the first signal starts graceful shutdown exactly once.
    void gracefulShutdown();
  };

  registerSignal('SIGTERM', handleSignal);
  registerSignal('SIGINT', handleSignal);

  await shutdownComplete;
}
