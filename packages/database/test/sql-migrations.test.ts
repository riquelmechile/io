import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_004 = join(pkgRoot, 'sql', '004_harden_constraints.sql');
const SCHEMA_005 = join(pkgRoot, 'sql', '005_journal_retryable_status.sql');
const SCHEMA_006 = join(pkgRoot, 'sql', '006_business_events.sql');
const SCHEMA_007 = join(pkgRoot, 'sql', '007_skills.sql');
const SCHEMA_008 = join(pkgRoot, 'sql', '008_heartbeat_cursor.sql');

/**
 * 004_harden_constraints.sql (Slice B, design §Data Model): the constraints
 * migration that travels WITH Slice B — `business_receipt.terminal_event_id`
 * (D5), the five UNIQUE indexes (single-issuance / single-work-id enforcement),
 * and the `idempotency_journal` table (created here; the idempotency LOGIC /
 * adapter is Slice C). Every statement is idempotent (IF NOT EXISTS), matching
 * 001–003, because the migrations are applied through PgDbConnection.execute()
 * with no migration runner. The column additions use IF NOT EXISTS, so 004 is
 * safe after 003.
 */

function readSql(): string {
  return existsSync(SCHEMA_004) ? readFileSync(SCHEMA_004, 'utf8') : '';
}

describe('sql/004_harden_constraints.sql (Slice B constraints migration)', () => {
  it('ships sql/004_harden_constraints.sql', () => {
    expect(existsSync(SCHEMA_004)).toBe(true);
  });

  it('adds terminal_event_id to business_receipt with IF NOT EXISTS (D5)', () => {
    expect(readSql()).toMatch(
      /ALTER\s+TABLE\s+business_receipt\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+terminal_event_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+''/i,
    );
  });

  it('adds the five UNIQUE indexes with IF NOT EXISTS', () => {
    const sql = readSql();
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_company_company_id\s+ON\s+company\s*\(\s*company_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_delegation_delegation_id\s+ON\s+delegation\s*\(\s*delegation_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_work_work_id\s+ON\s+work\s*\(\s*work_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_receipt_receipt_id\s+ON\s+business_receipt\s*\(\s*receipt_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_receipt_work_terminal\s+ON\s+business_receipt\s*\(\s*work_id\s*,\s*terminal_event_id\s*\)/i,
    );
  });

  it('creates idempotency_journal with the design columns and both UNIQUEs (IF NOT EXISTS)', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+idempotency_journal/i);
    for (const column of [
      'id SERIAL PRIMARY KEY',
      'company_id TEXT NOT NULL',
      'idempotency_key TEXT NOT NULL',
      'request_hash TEXT NOT NULL',
      'attempt_id TEXT NOT NULL',
      'status TEXT NOT NULL',
      'result_json JSONB',
      'created_at BIGINT NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(/UNIQUE\s*\(\s*company_id\s*,\s*idempotency_key\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*attempt_id\s*\)/i);
  });

  it('uses IF NOT EXISTS on every statement (idempotent, re-apply safe)', () => {
    // Strip `--` comment lines so only executable SQL statements are counted.
    const sql = readSql()
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThanOrEqual(7);
    for (const statement of statements) {
      expect(statement).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });
});

describe('sql/005_journal_retryable_status.sql (retryable marker CHECK)', () => {
  function read005(): string {
    return existsSync(SCHEMA_005) ? readFileSync(SCHEMA_005, 'utf8') : '';
  }

  it('ships sql/005_journal_retryable_status.sql', () => {
    expect(existsSync(SCHEMA_005)).toBe(true);
  });

  it('idempotently DROPs any existing status CHECK before re-adding (DROP CONSTRAINT IF EXISTS)', () => {
    expect(read005()).toMatch(
      /ALTER\s+TABLE\s+idempotency_journal\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+idempotency_journal_status_check/i,
    );
  });

  it('ADDs the three-value status CHECK (in_flight | completed | aborted_retryable)', () => {
    expect(read005()).toMatch(
      /ALTER\s+TABLE\s+idempotency_journal\s+ADD\s+CONSTRAINT\s+idempotency_journal_status_check\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'in_flight'\s*,\s*'completed'\s*,\s*'aborted_retryable'\s*\)\s*\)/i,
    );
  });

  it('rollback DROPS the CHECK and does NOT restore a two-value CHECK (acceptance note 2)', () => {
    const sql = read005();
    // The rollback contract is documented: drop the constraint.
    expect(sql).toMatch(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+idempotency_journal_status_check/i);
    // A two-value CHECK would brick existing aborted_retryable rows on rollback.
    expect(sql).not.toMatch(/status\s+IN\s*\(\s*'in_flight'\s*,\s*'completed'\s*\)/i);
  });

  it('targets the idempotency_journal table (004) that carries status TEXT NOT NULL', () => {
    const sql = read005();
    expect(sql).toMatch(/idempotency_journal/i);
    expect(SCHEMA_004 && readFileSync(SCHEMA_004, 'utf8')).toMatch(/status\s+TEXT\s+NOT\s+NULL/i);
  });
});

describe('sql/006_business_events.sql (business_event table — R4, design §006)', () => {
  function read006(): string {
    return existsSync(SCHEMA_006) ? readFileSync(SCHEMA_006, 'utf8') : '';
  }

  it('ships sql/006_business_events.sql', () => {
    expect(existsSync(SCHEMA_006)).toBe(true);
  });

  it('creates business_event with the ten design columns, all NOT NULL (IF NOT EXISTS)', () => {
    const sql = read006();
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+business_event/i);
    for (const column of [
      'id SERIAL PRIMARY KEY',
      'event_id TEXT NOT NULL',
      'company_id TEXT NOT NULL',
      'aggregate_kind TEXT NOT NULL',
      'aggregate_id TEXT NOT NULL',
      'event_type TEXT NOT NULL',
      'occurred_at BIGINT NOT NULL',
      'payload JSONB NOT NULL',
      'source TEXT NOT NULL',
      'created_at BIGINT NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('adds the UNIQUE event_id index and the two tenant/aggregate read indexes (IF NOT EXISTS)', () => {
    const sql = read006();
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_business_event_event_id\s+ON\s+business_event\s*\(\s*event_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_business_event_company_id\s+ON\s+business_event\s*\(\s*company_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_business_event_aggregate\s+ON\s+business_event\s*\(\s*aggregate_kind\s*,\s*aggregate_id\s*\)/i,
    );
  });

  it('uses IF NOT EXISTS on every statement (idempotent, re-apply safe)', () => {
    const sql = read006()
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThanOrEqual(4);
    for (const statement of statements) {
      expect(statement).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });
});

describe('sql/007_skills.sql (skill table — R6, design §007)', () => {
  function read007(): string {
    return existsSync(SCHEMA_007) ? readFileSync(SCHEMA_007, 'utf8') : '';
  }

  it('ships sql/007_skills.sql', () => {
    expect(existsSync(SCHEMA_007)).toBe(true);
  });

  it('creates skill with the ten design columns, all NOT NULL (IF NOT EXISTS)', () => {
    const sql = read007();
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+skill/i);
    for (const column of [
      'id SERIAL PRIMARY KEY',
      'skill_id TEXT NOT NULL',
      'company_id TEXT NOT NULL',
      'name TEXT NOT NULL',
      'version INTEGER NOT NULL',
      'body TEXT NOT NULL',
      'scope JSONB NOT NULL',
      'state TEXT NOT NULL',
      'created_at BIGINT NOT NULL',
      'updated_at BIGINT NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('adds the UNIQUE(company_id, skill_id, version) index and the tenant index (IF NOT EXISTS)', () => {
    const sql = read007();
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_skill_company_skill_version\s+ON\s+skill\s*\(\s*company_id\s*,\s*skill_id\s*,\s*version\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_skill_company_id\s+ON\s+skill\s*\(\s*company_id\s*\)/i,
    );
  });

  it('uses IF NOT EXISTS on every statement (idempotent, re-apply safe)', () => {
    const sql = read007()
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThanOrEqual(3);
    for (const statement of statements) {
      expect(statement).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });
});

describe('sql/008_heartbeat_cursor.sql (heartbeat_cursor table — supervisor-timer)', () => {
  function read008(): string {
    return existsSync(SCHEMA_008) ? readFileSync(SCHEMA_008, 'utf8') : '';
  }

  it('ships sql/008_heartbeat_cursor.sql', () => {
    expect(existsSync(SCHEMA_008)).toBe(true);
  });

  it('creates heartbeat_cursor with a PRIMARY KEY on company_id (IF NOT EXISTS)', () => {
    const sql = read008();
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+heartbeat_cursor/i);
    // One checkpoint per company (tenant scoping, ADR-0002) — PK on company_id.
    for (const column of [
      'company_id TEXT PRIMARY KEY',
      'last_event_id TEXT NOT NULL',
      'updated_at BIGINT NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('uses IF NOT EXISTS on every statement (idempotent, re-apply safe)', () => {
    const sql = read008()
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThanOrEqual(1);
    for (const statement of statements) {
      expect(statement).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });
});
