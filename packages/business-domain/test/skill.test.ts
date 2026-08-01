import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CompileContextInput, CompiledContext, SegmentId } from '../../context/src/index.js';
import { compileContext, SEGMENTS } from '../../context/src/index.js';
import type { SkillRepository as IndexedRepository, Skill as IndexedSkill } from '../src/index.js';
import {
  activeSkillsFor as IndexedActiveSkillsFor,
  InMemorySkillRepository as IndexedFake,
  isSkillState as IndexedIsSkillState,
} from '../src/index.js';
import { InMemorySkillRepository } from '../src/ports/fakes.js';
import type { SkillRepository } from '../src/ports/repositories.js';
import { activeSkillsFor, isSkillState } from '../src/skill-activation.js';
import type { Skill, SkillScope, SkillState, Work } from '../src/types.js';

function sampleSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    skillId: 'invoice-extraction',
    companyId: 'acme',
    name: 'Invoice extraction',
    version: 1,
    body: 'Extract vendor and amount fields from invoice documents.',
    scope: { process: 'planning', schemaVersion: 1 },
    state: 'active',
    createdAt: 1750000000000,
    updatedAt: 1750000000000,
    ...overrides,
  };
}

describe('Skill (R1)', () => {
  it('carries exactly the 9 design fields with the design types', () => {
    const skill = sampleSkill();
    expect(Object.keys(skill)).toEqual([
      'skillId',
      'companyId',
      'name',
      'version',
      'body',
      'scope',
      'state',
      'createdAt',
      'updatedAt',
    ]);
    expect(skill.skillId).toBe('invoice-extraction');
    expect(skill.companyId).toBe('acme');
    expect(skill.name).toBe('Invoice extraction');
    expect(skill.version).toBe(1);
    expect(skill.body).toBe('Extract vendor and amount fields from invoice documents.');
    expect(skill.scope).toEqual({ process: 'planning', schemaVersion: 1 });
    expect(skill.state).toBe('active');
    expect(typeof skill.createdAt).toBe('number');
    expect(typeof skill.updatedAt).toBe('number');
    expectTypeOf(skill).toEqualTypeOf<Skill>();
    expectTypeOf(skill.scope).toEqualTypeOf<SkillScope>();
  });

  it('is deterministic: two Skills from identical values are equal', () => {
    const first = sampleSkill();
    const second = sampleSkill();
    expect(first).toEqual(second);
    expect(second).toEqual(first);
  });

  it('differs when values differ (triangulation)', () => {
    const base = sampleSkill();
    const other = sampleSkill({ version: 2, body: 'A revised instruction body.' });
    expect(other).not.toEqual(base);
    expect(other.version).toBe(2);
    expect(other.body).toBe('A revised instruction body.');
  });

  it('SkillState is exactly draft | active | retired', () => {
    expectTypeOf<SkillState>().toEqualTypeOf<'draft' | 'active' | 'retired'>();
  });
});

describe('isSkillState (R4)', () => {
  it('accepts draft, active, and retired', () => {
    expect(isSkillState('draft')).toBe(true);
    expect(isSkillState('active')).toBe(true);
    expect(isSkillState('retired')).toBe(true);
  });

  it('rejects every other string (triangulation)', () => {
    for (const invalid of [
      '',
      'published',
      'ACTIVE',
      'drafting',
      'disabled',
      'archived',
      'active ',
    ]) {
      expect(isSkillState(invalid)).toBe(false);
    }
  });

  it('narrows a plain string to SkillState for the accepted values', () => {
    const values: string[] = ['draft', 'active', 'retired', 'garbage'];
    const accepted: SkillState[] = values.filter((value) => isSkillState(value));
    expect(accepted).toEqual(['draft', 'active', 'retired']);
  });
});

describe('SkillRepository port (R2)', () => {
  it('surface is EXACTLY save | get | listByCompany — no update/delete/overwrite', () => {
    // Type-level exact-surface check: the port must not expose any other key.
    expectTypeOf<keyof SkillRepository>().toEqualTypeOf<'save' | 'get' | 'listByCompany'>();
  });

  it('a conforming implementation only needs save/get/listByCompany', async () => {
    const repo: SkillRepository = {
      async save(skill) {
        return skill;
      },
      async get(companyId, skillId) {
        return companyId === 'acme' && skillId === 'invoice-extraction' ? sampleSkill() : undefined;
      },
      async listByCompany(companyId) {
        return companyId === 'acme' ? [sampleSkill()] : [];
      },
    };
    const saved = await repo.save(sampleSkill());
    expect(saved.skillId).toBe('invoice-extraction');
    expect(await repo.get('acme', 'invoice-extraction')).toEqual(sampleSkill());
    expect(await repo.get('other', 'invoice-extraction')).toBeUndefined();
    expect(await repo.listByCompany('acme')).toHaveLength(1);
    expect(await repo.listByCompany('other')).toHaveLength(0);
  });
});

describe('InMemorySkillRepository (R3, R2, R7)', () => {
  it('real fake surface is EXACTLY save | get | listByCompany — no mutation operations', () => {
    const repo = new InMemorySkillRepository();
    const proto = Object.getPrototypeOf(repo) as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .sort();
    expect(methods).toEqual(['get', 'listByCompany', 'save']);
  });

  it('v1 + v2 → get returns v2 AND both versions stay listed (append, no overwrite)', async () => {
    const repo = new InMemorySkillRepository();
    await repo.save(sampleSkill({ version: 1, body: 'v1 body' }));
    await repo.save(sampleSkill({ version: 2, body: 'v2 body' }));

    const latest = await repo.get('acme', 'invoice-extraction');
    expect(latest?.version).toBe(2);
    expect(latest?.body).toBe('v2 body');

    const listed = await repo.listByCompany('acme');
    expect(listed.map((entry) => entry.version)).toEqual([1, 2]);
    expect(listed[0]?.body).toBe('v1 body');
    expect(listed[1]?.body).toBe('v2 body');
  });

  it('duplicate (companyId, skillId, version) is rejected and the ORIGINAL is kept', async () => {
    const repo = new InMemorySkillRepository();
    const original = sampleSkill({ version: 1, body: 'original body' });
    await repo.save(original);

    const duplicate = sampleSkill({ version: 1, body: 'tampered body' });
    await expect(repo.save(duplicate)).rejects.toThrow(/already/i);

    const listed = await repo.listByCompany('acme');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(original);
    expect(listed[0]?.body).toBe('original body');
  });

  it('allows a DIFFERENT version of the same skill (new version = new entry)', async () => {
    const repo = new InMemorySkillRepository();
    await expect(repo.save(sampleSkill({ version: 1 }))).resolves.toEqual(
      sampleSkill({ version: 1 }),
    );
    await expect(repo.save(sampleSkill({ version: 2 }))).resolves.toEqual(
      sampleSkill({ version: 2 }),
    );
    expect(await repo.listByCompany('acme')).toHaveLength(2);
  });

  it('interleaved A/B: list/get for A never return company B Skills (tenant isolation)', async () => {
    const repo = new InMemorySkillRepository();
    await repo.save(sampleSkill({ skillId: 'skill-a1', companyId: 'company-a', version: 1 }));
    await repo.save(sampleSkill({ skillId: 'skill-b1', companyId: 'company-b', version: 1 }));
    await repo.save(sampleSkill({ skillId: 'skill-a2', companyId: 'company-a', version: 1 }));

    const forA = await repo.listByCompany('company-a');
    expect(forA.map((entry) => entry.skillId)).toEqual(['skill-a1', 'skill-a2']);
    for (const entry of forA) {
      expect(entry.companyId).toBe('company-a');
    }
    expect(await repo.get('company-a', 'skill-b1')).toBeUndefined();
    expect(await repo.get('company-b', 'skill-a1')).toBeUndefined();
  });

  it('a company with no skills resolves to undefined / empty list', async () => {
    const repo = new InMemorySkillRepository();
    await repo.save(sampleSkill({ companyId: 'company-a' }));
    expect(await repo.get('company-b', 'invoice-extraction')).toBeUndefined();
    expect(await repo.listByCompany('company-b')).toEqual([]);
  });
});

describe('InMemorySkillRepository — empty companyId (R7)', () => {
  it('rejects save with an empty companyId', async () => {
    const repo = new InMemorySkillRepository();
    await expect(repo.save(sampleSkill({ companyId: '' }))).rejects.toThrow(/companyId/i);
    expect(await repo.listByCompany('acme')).toEqual([]);
  });

  it('rejects get with an empty companyId', async () => {
    const repo = new InMemorySkillRepository();
    await repo.save(sampleSkill());
    await expect(repo.get('', 'invoice-extraction')).rejects.toThrow(/companyId/i);
  });

  it('rejects listByCompany with an empty companyId', async () => {
    const repo = new InMemorySkillRepository();
    await repo.save(sampleSkill());
    await expect(repo.listByCompany('')).rejects.toThrow(/companyId/i);
  });
});

describe('activeSkillsFor — pure cohort-safe activation (R5, R4)', () => {
  const cohort = { companyId: 'acme', process: 'planning', schemaVersion: 1 };

  function activeSet(...skills: Skill[]): string[] {
    return activeSkillsFor(cohort, skills).map((skill) => `${skill.skillId}@v${skill.version}`);
  }

  it('same cohort ⇒ identical identities+versions on repeat (deterministic)', () => {
    const skills = [
      sampleSkill({ skillId: 'billing', version: 1 }),
      sampleSkill({ skillId: 'reporting', version: 2 }),
    ];
    const first = activeSkillsFor(cohort, skills);
    const second = activeSkillsFor(cohort, skills);
    expect(first).toEqual(second);
    expect(first.map((skill) => `${skill.skillId}@v${skill.version}`)).toEqual([
      'billing@v1',
      'reporting@v2',
    ]);
  });

  it('signature admits ONLY (cohort, skills) — work/clock/ids/dynamic-tail cannot enter', () => {
    // The cache-poisoning inverse guarantee (R5) is structural: the parameter
    // list is EXACTLY the cohort record plus the Skill list. No work, no clocks,
    // no generated ids, no dynamic-tail content can be passed — so selection can
    // never depend on them.
    expectTypeOf<Parameters<typeof activeSkillsFor>>().toEqualTypeOf<
      [
        {
          readonly companyId: string;
          readonly process: string;
          readonly schemaVersion: number;
        },
        readonly Skill[],
      ]
    >();
    // Runtime: a cohort with only the three declared fields type-checks and runs.
    const selection = activeSkillsFor(cohort, [sampleSkill()]);
    expect(selection.map((skill) => skill.skillId)).toEqual(['invoice-extraction']);
  });

  it('identical cohort+skills under DIFFERENT surrounding activity select identically (cache-poisoning inverse)', async () => {
    const skills = [
      sampleSkill({ skillId: 'billing', version: 1 }),
      sampleSkill({ skillId: 'reporting', version: 2 }),
    ];
    const baseline = activeSkillsFor(cohort, skills);

    // Simulate "different work / dynamic tail": unrelated repository activity
    // between the two evaluations. The pure function must NOT observe it — the
    // same cohort+skills yield the same identities and versions.
    const repo = new InMemorySkillRepository();
    await repo.save(sampleSkill({ skillId: 'unrelated-skill', companyId: 'other', version: 1 }));
    await repo.save(sampleSkill({ skillId: 'unrelated-skill', companyId: 'acme', version: 5 }));
    await repo.listByCompany('acme');

    const afterActivity = activeSkillsFor(cohort, skills);
    expect(afterActivity).toEqual(baseline);
    expect(afterActivity.map((skill) => `${skill.skillId}@v${skill.version}`)).toEqual(
      baseline.map((skill) => `${skill.skillId}@v${skill.version}`),
    );
  });

  it('selects ONLY active Skills — draft and retired are excluded even when company+scope match', () => {
    expect(
      activeSet(
        sampleSkill({ skillId: 'a', version: 1 }),
        sampleSkill({ skillId: 'b', version: 1, state: 'draft' }),
        sampleSkill({ skillId: 'c', version: 1, state: 'retired' }),
        sampleSkill({ skillId: 'd', version: 1, state: 'draft' }),
      ),
    ).toEqual(['a@v1']);
  });

  it('scope must match BOTH cohort process and schemaVersion (triangulation)', () => {
    const baseScope: SkillScope = { process: 'planning', schemaVersion: 1 };
    const wrongProcess: SkillScope = { process: 'close', schemaVersion: 1 };
    const wrongSchema: SkillScope = { process: 'planning', schemaVersion: 2 };

    expect(
      activeSet(
        sampleSkill({ skillId: 'match', version: 1, scope: baseScope }),
        sampleSkill({ skillId: 'no-process', version: 1, scope: wrongProcess }),
        sampleSkill({ skillId: 'no-schema', version: 1, scope: wrongSchema }),
      ),
    ).toEqual(['match@v1']);
  });

  it("companyId must match the cohort — another company's Skill is never selected (R7)", () => {
    expect(
      activeSet(
        sampleSkill({ skillId: 'ours', version: 1 }),
        sampleSkill({ skillId: 'theirs', version: 1, companyId: 'other' }),
      ),
    ).toEqual(['ours@v1']);
  });

  it('collapses to the max version per skillId — one Skill per identity (design)', () => {
    const skills = [
      sampleSkill({ skillId: 'billing', version: 1, body: 'v1' }),
      sampleSkill({ skillId: 'billing', version: 2, body: 'v2' }),
      sampleSkill({ skillId: 'reporting', version: 1, body: 'r1' }),
    ];
    const selected = activeSkillsFor(cohort, skills);
    expect(selected.map((skill) => `${skill.skillId}@v${skill.version}`)).toEqual([
      'billing@v2',
      'reporting@v1',
    ]);
  });

  it('sorts skillId ASC — stable cohort output regardless of input order (design)', () => {
    const skills = [
      sampleSkill({ skillId: 'zeta', version: 1 }),
      sampleSkill({ skillId: 'alpha', version: 1 }),
      sampleSkill({ skillId: 'mid', version: 1 }),
    ];
    const selected = activeSkillsFor(cohort, skills);
    expect(selected.map((skill) => skill.skillId)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('a cohort with no eligible Skill resolves to an empty list', () => {
    const noMatch = { companyId: 'acme', process: 'planning', schemaVersion: 99 };
    const selection = activeSkillsFor(noMatch, [sampleSkill()]);
    expect(selection).toEqual([]);
  });
});

describe('public surface + isolation (R1, R8)', () => {
  it('index.ts exports the type, port, fake, isSkillState, and activeSkillsFor — all functional', async () => {
    // Type-level: the index re-exports the same contracts as the source modules.
    expectTypeOf<IndexedSkill>().toEqualTypeOf<Skill>();
    expectTypeOf<IndexedRepository>().toEqualTypeOf<SkillRepository>();

    // Runtime: the indexed fake + guards work end-to-end.
    const repo: IndexedRepository = new IndexedFake();
    const skill = sampleSkill();
    await repo.save(skill);
    expect(await repo.get('acme', 'invoice-extraction')).toEqual(skill);

    expect(IndexedIsSkillState('active')).toBe(true);
    expect(IndexedIsSkillState('bogus')).toBe(false);

    const selected = IndexedActiveSkillsFor(
      { companyId: 'acme', process: 'planning', schemaVersion: 1 },
      [sampleSkill()],
    );
    expect(selected.map((entry) => entry.skillId)).toEqual(['invoice-extraction']);
  });

  it('src has ZERO @io/* imports (no cross-package coupling)', () => {
    const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
    const tsFiles = readdirSync(srcDir, { recursive: true }).filter(
      (entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'),
    );
    expect(tsFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of tsFiles) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      if (/import\s+[^;]*@io\//.test(source) || /import\s*\(\s*['"]@io\//.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('package.json declares NO runtime or dev dependencies (zero runtime deps)', () => {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      expect(pkg[field] ?? {}).toEqual({});
    }
  });

  it('packages/context is untouched — compileContext stays deterministic and segment 7 (active-skills) stays ABSENT', () => {
    // R8: Skills MUST NOT feed compileContext; segment 7 must remain ABSENT.
    // PR1 must not alter the compiler's output for an identical input.
    const work: Work = {
      workId: 'work-1',
      companyId: 'acme',
      delegationId: 'delegation-1',
      proposer: 'founder',
      description: 'execute the quarterly close',
      state: 'accepted',
      version: 1,
      evidenceRefs: [],
    };
    const input: CompileContextInput = { companyId: 'acme', process: 'planning', work };

    // Determinism: identical input ⇒ identical compiled bytes (unchanged).
    const first: CompiledContext = compileContext(input);
    const second: CompiledContext = compileContext(input);
    expect(second).toEqual(first);
    expect(second.messages[0]?.content).toBe(first.messages[0]?.content);

    // Segment 7 stays ABSENT — no active-skills text can enter the prefix.
    const segment7 = SEGMENTS.find((segment) => segment.position === 7);
    expect(segment7?.id).toBe('active-skills' satisfies SegmentId);
    expect(segment7?.render(input).present).toBe(false);
    expect(first.messages[0]?.content).not.toContain('skill');
  });
});
