import { describe, expect, it } from 'vitest';

import { loadConfig, type DaemonConfig } from '../../src/daemon/config.js';

/** A complete valid environment (R1 scenario 1: valid configuration permits boot). */
function validEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://io:io@localhost:5432/io',
    DEEPSEEK_API_KEY: 'sk-test-secret',
    IO_SANDBOX_ROOT: '/data/io-sandbox',
    IO_INTERVAL_MS: '60000',
    IO_PROPOSER: 'proposer@io',
    IO_APPROVER: 'approver@io',
    IO_EXECUTOR: 'executor@io',
    IO_VERIFIER: 'verifier@io',
  };
}

describe('loadConfig — fail-fast boot configuration (R1)', () => {
  it('parses a valid environment into a complete DaemonConfig (R1 scenario 1)', () => {
    const config: DaemonConfig = loadConfig(validEnv());

    expect(config).toEqual({
      databaseUrl: 'postgresql://io:io@localhost:5432/io',
      deepseekApiKey: 'sk-test-secret',
      sandboxRoot: '/data/io-sandbox',
      intervalMs: 60000,
      principals: {
        proposer: 'proposer@io',
        approver: 'approver@io',
        executor: 'executor@io',
        verifier: 'verifier@io',
      },
    });
  });

  describe.each(['DATABASE_URL', 'DEEPSEEK_API_KEY', 'IO_SANDBOX_ROOT'])(
    '%s is required and must be a non-empty string',
    (envKey) => {
      it('rejects a MISSING value and names the setting', () => {
        const env = validEnv();
        delete env[envKey];

        expect(() => loadConfig(env)).toThrow(envKey);
      });

      it('rejects an EMPTY value and names the setting', () => {
        expect(() => loadConfig({ ...validEnv(), [envKey]: '' })).toThrow(envKey);
      });
    },
  );

  describe('IO_INTERVAL_MS must be a finite number greater than 0', () => {
    it.each(['0', '-500', 'fast', 'Infinity', 'NaN'])('rejects %s and names the setting', (raw) => {
      expect(() => loadConfig({ ...validEnv(), IO_INTERVAL_MS: raw })).toThrow('IO_INTERVAL_MS');
    });

    it('rejects a MISSING value and names the setting', () => {
      const env = validEnv();
      delete env.IO_INTERVAL_MS;

      expect(() => loadConfig(env)).toThrow('IO_INTERVAL_MS');
    });
  });

  describe.each(['IO_PROPOSER', 'IO_APPROVER', 'IO_EXECUTOR', 'IO_VERIFIER'])(
    '%s is required and must be non-empty',
    (envKey) => {
      it('rejects an EMPTY principal and names the setting', () => {
        expect(() => loadConfig({ ...validEnv(), [envKey]: '' })).toThrow(envKey);
      });

      it('rejects a MISSING principal and names the setting', () => {
        const env = validEnv();
        delete env[envKey];

        expect(() => loadConfig(env)).toThrow(envKey);
      });
    },
  );

  it('rejects ALL four empty principals and names the offending one (R1 scenario 2)', () => {
    const env = {
      ...validEnv(),
      IO_PROPOSER: '',
      IO_APPROVER: '',
      IO_EXECUTOR: '',
      IO_VERIFIER: '',
    };

    expect(() => loadConfig(env)).toThrow(/IO_(PROPOSER|APPROVER|EXECUTOR|VERIFIER)/);
  });

  it('throws SYNCHRONOUSLY so boot can never reach schedule creation (R1: the schedule MUST NOT start)', () => {
    // R1 scenario 2: invalid configuration rejects boot AND the schedule MUST
    // NOT start. At the config layer the guarantee is the synchronous throw:
    // control never returns to the caller, so no schedule can ever be created.
    // (The schedule-wiring half of the proof lands in slice 1b, task 2.1.)
    expect(() => loadConfig({ ...validEnv(), DEEPSEEK_API_KEY: '' })).toThrow('DEEPSEEK_API_KEY');
  });
});
