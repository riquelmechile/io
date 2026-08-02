/**
 * Fail-fast boot configuration (spec: Fail-Fast Boot Configuration, R1): every
 * required setting is validated BEFORE any scheduling can start, and a problem
 * names the offending setting so an operator can fix it in one pass. `loadConfig`
 * deliberately does NOT fall back to `pgConnectionString()` (design decision): a
 * missing `DATABASE_URL` is a boot error, never a silent default.
 */

export type DaemonConfig = {
  databaseUrl: string;
  deepseekApiKey: string;
  sandboxRoot: string;
  intervalMs: number;
  principals: {
    proposer: string;
    approver: string;
    executor: string;
    verifier: string;
  };
};

/** Throws an Error naming the offending setting (R1). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  return {
    databaseUrl: requireNonEmpty(env, 'DATABASE_URL'),
    deepseekApiKey: requireNonEmpty(env, 'DEEPSEEK_API_KEY'),
    sandboxRoot: requireNonEmpty(env, 'IO_SANDBOX_ROOT'),
    intervalMs: parsePositiveInterval(env, 'IO_INTERVAL_MS'),
    principals: {
      proposer: requireNonEmpty(env, 'IO_PROPOSER'),
      approver: requireNonEmpty(env, 'IO_APPROVER'),
      executor: requireNonEmpty(env, 'IO_EXECUTOR'),
      verifier: requireNonEmpty(env, 'IO_VERIFIER'),
    },
  };
}

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return value;
}

function parsePositiveInterval(env: NodeJS.ProcessEnv, key: string): number {
  const raw = env[key];
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a finite number greater than 0`);
  }
  return parsed;
}
