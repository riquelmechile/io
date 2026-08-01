import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Skill } from '@io/business-domain/src/index.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';
import { parseSkillRow } from '../src/row-guards.js';
import { PgSkillRepository } from '../src/skill-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_007 = join(pkgRoot, 'sql', '007_skills.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for the INSERT-only versioned
 * `skill` table (design §007; R6 insert-only persistence, R2 append-only
 * no-overwrite registry, R7 tenant scoping). Applies the shipped 007 DDL, saves
 * versioned Skills via `PgSkillRepository.save`, and reads them back through
 * `get` (latest) and `listByCompany` (all versions), asserting every field
 * survives the `parseSkillRow` guard byte-identically — the explicit guard is
 * also exercised on RAW query bytes. Versioned no-overwrite: a duplicate
 * `(companyId, skillId, version)` triple is rejected by
 * `uq_skill_company_skill_version` with the ORIGINAL row preserved. Cross-tenant
 * isolation: a read for company A must never return company B Skills, and an
 * empty companyId is rejected before any SQL runs. Read order follows
 * `ORDER BY skill_id, version` (stable, matches the in-memory fake). State is
 * isolated via TRUNCATE in beforeEach. The whole suite is SKIPPED when no live
 * PG is reachable, and MUST be run sequentially (`--no-file-parallelism`): the
 * shared io_dev database is TRUNCATE-isolated.
 */

async function pgReachable(): Promise<boolean> {
  const probe = new PgDbConnection(pgConnectionString());
  try {
    await probe.execute('SELECT 1', []);
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const reachable = await pgReachable();

describe.skipIf(!reachable)('integration: real PG skill round-trip (R6, R2, R7)', () => {
  let conn!: PgDbConnection;
  let skillRepo!: PgSkillRepository;

  beforeAll(async () => {
    conn = new PgDbConnection(pgConnectionString());
    await conn.execute(readFileSync(SCHEMA_007, 'utf8'), []);
    skillRepo = new PgSkillRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute('TRUNCATE skill RESTART IDENTITY', []);
  });

  afterAll(async () => {
    await conn?.close();
  });

  function sampleSkill(skillId: string, version: number, companyId = 'acme'): Skill {
    return {
      skillId,
      companyId,
      name: 'Quarterly close procedure',
      version,
      body: `Execute the Q4 financial close end-to-end (v${version}).`,
      scope: { process: 'financial-close', schemaVersion: 1 },
      state: 'active',
      createdAt: 1750000000000,
      updatedAt: 1750000000000,
    };
  }

  describe('save → get round-trip (R2 latest-version)', () => {
    it('save v1+v2 → get returns v2 and BOTH versions round-trip byte-identically via parseSkillRow', async () => {
      const v1 = sampleSkill('skill-1', 1);
      const v2 = sampleSkill('skill-1', 2);
      await skillRepo.save(v1);
      await skillRepo.save(v2);

      // get() returns the LATEST version (ORDER BY version DESC LIMIT 1).
      const got = await skillRepo.get('acme', 'skill-1');
      expect(got).toEqual(v2);

      // History is retained: BOTH versions survive, byte-identical.
      const listed = await skillRepo.listByCompany('acme');
      expect(listed).toEqual([v1, v2]);

      // Explicit guard check on RAW query bytes: parseSkillRow round-trips
      // every field of both immutable versions (R6 scenario).
      const rawRows = await conn.query<Record<string, unknown>>(
        'SELECT skill_id AS "skillId", company_id AS "companyId", name, version, body, ' +
          'scope, state, created_at AS "createdAt", updated_at AS "updatedAt" ' +
          'FROM skill WHERE company_id = $1 ORDER BY skill_id, version',
        ['acme'],
      );
      const guarded = rawRows.map((row) => {
        const parsed = parseSkillRow(row);
        if (!parsed.ok) throw new Error(`corrupt skill row: ${parsed.reason}`);
        return parsed.value;
      });
      expect(guarded).toEqual([v1, v2]);
      expect(guarded[1]?.version).toBe(2);
      expect(guarded[1]?.scope).toEqual({ process: 'financial-close', schemaVersion: 1 });
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      await skillRepo.save(sampleSkill('skill-1', 1));
      expect(await skillRepo.get('acme', 'nonexistent')).toBeUndefined();
    });
  });

  describe('list ORDER BY skill_id, version (R2 stable order)', () => {
    it('lists all versions per skill ordered by (skill_id, version)', async () => {
      // Interleaved saves — the read order must NOT be insertion order.
      await skillRepo.save(sampleSkill('skill-b', 1));
      await skillRepo.save(sampleSkill('skill-a', 1));
      await skillRepo.save(sampleSkill('skill-b', 2));
      await skillRepo.save(sampleSkill('skill-a', 2));

      const listed = await skillRepo.listByCompany('acme');
      expect(listed.map((skill) => `${skill.skillId}:v${skill.version}`)).toEqual([
        'skill-a:v1',
        'skill-a:v2',
        'skill-b:v1',
        'skill-b:v2',
      ]);
    });
  });

  describe('cross-tenant isolation (R7)', () => {
    it('a read for company A never returns company B Skills', async () => {
      await skillRepo.save(sampleSkill('shared', 1, 'company-a'));
      await skillRepo.save(sampleSkill('shared', 1, 'company-b'));
      await skillRepo.save(sampleSkill('only-a', 1, 'company-a'));

      const forA = await skillRepo.listByCompany('company-a');
      expect(forA.map((skill) => skill.skillId)).toEqual(['only-a', 'shared']);
      for (const skill of forA) expect(skill.companyId).toBe('company-a');

      const forB = await skillRepo.listByCompany('company-b');
      expect(forB.map((skill) => skill.skillId)).toEqual(['shared']);
      expect(forB[0]?.companyId).toBe('company-b');

      // get() under company A must not resolve company B's version.
      expect(await skillRepo.get('company-a', 'shared')).toEqual(
        sampleSkill('shared', 1, 'company-a'),
      );
    });

    it('a company with no Skills resolves to an empty list', async () => {
      await skillRepo.save(sampleSkill('skill-1', 1, 'company-a'));
      expect(await skillRepo.listByCompany('company-b')).toEqual([]);
    });
  });

  describe('empty companyId guard (R7) — rejected before any SQL runs', () => {
    it('save rejects an empty companyId and writes NOTHING', async () => {
      await expect(skillRepo.save(sampleSkill('skill-1', 1, ''))).rejects.toThrow(
        /non-empty companyId/i,
      );
      expect(await skillRepo.listByCompany('acme')).toEqual([]);
    });

    it('get and listByCompany reject an empty companyId', async () => {
      await expect(skillRepo.get('', 'skill-1')).rejects.toThrow(/non-empty companyId/i);
      await expect(skillRepo.listByCompany('')).rejects.toThrow(/non-empty companyId/i);
    });
  });

  describe('duplicate (companyId, skillId, version) — no-overwrite (R2, 007 UNIQUE)', () => {
    it('rejects a second save of the SAME triple and preserves the ORIGINAL version', async () => {
      const original = sampleSkill('skill-1', 1);
      await skillRepo.save(original);

      // Same (companyId, skillId, version) triple, different body: the 007
      // UNIQUE index must reject — no upsert, no overwrite.
      const duplicate: Skill = {
        ...original,
        body: 'tampered replacement body',
        state: 'draft',
      };
      await expect(skillRepo.save(duplicate)).rejects.toThrow(/duplicate key|unique/i);

      // The ORIGINAL row is preserved, unchanged, and still the only one.
      const stored = await skillRepo.listByCompany('acme');
      expect(stored).toEqual([original]);
      expect(stored[0]?.body).toBe(original.body);
      expect(stored[0]?.state).toBe('active');
    });

    it('allows the SAME skillId at a NEW version, and the SAME triple across companies (triangulation)', async () => {
      // Same skillId, next version → a NEW row (append, not overwrite).
      await skillRepo.save(sampleSkill('skill-1', 1));
      await expect(skillRepo.save(sampleSkill('skill-1', 2))).resolves.toEqual(
        sampleSkill('skill-1', 2),
      );
      // Same (skillId, version) under a DIFFERENT company → allowed (tenant scope).
      await expect(skillRepo.save(sampleSkill('skill-1', 1, 'company-b'))).resolves.toEqual(
        sampleSkill('skill-1', 1, 'company-b'),
      );
      expect(await skillRepo.listByCompany('acme')).toHaveLength(2);
      expect(await skillRepo.listByCompany('company-b')).toHaveLength(1);
    });
  });
});
