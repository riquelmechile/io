import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_004 = join(pkgRoot, 'sql', '004_harden_constraints.sql');

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
