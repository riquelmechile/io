import type { Skill, Work } from '@io/business-domain/src/index.js';
import { describe, expect, it, vi } from 'vitest';

import type { CompileContextInput, Segment, SegmentRender } from '../src/index.js';
import { buildStablePrefix, compileContext, SEGMENTS } from '../src/index.js';

/** A fully-sourced Work fixture: drives segment 11 (current-work) rendering. */
const work: Work = {
  workId: 'work-1',
  companyId: 'acme',
  delegationId: 'delegation-1',
  proposer: 'founder',
  description: 'execute the quarterly close',
  state: 'accepted',
  version: 1,
  fencingToken: 0,
  evidenceRefs: [],
};

/** Compile input for the fixture: protocol (seg 1) always present, work (seg 11) present. */
const input = { companyId: 'acme', process: 'planning', work };

/**
 * Two ACTIVE Skills matching the fixture cohort (acme/planning/v2), with
 * deliberately DISTINCT marker values for every field so the render can be
 * asserted field-by-field: only skillId/name/version/body MAY appear; metadata
 * (createdAt/updatedAt/state/scope/companyId) must never leak into the bytes.
 */
const skillA: Skill = {
  skillId: 'a-skill',
  companyId: 'acme',
  name: 'Skill A',
  version: 1,
  body: 'BODY-A',
  scope: { process: 'planning', schemaVersion: 2 },
  state: 'active',
  createdAt: 111,
  updatedAt: 222,
};

const skillB: Skill = {
  skillId: 'b-skill',
  companyId: 'acme',
  name: 'Skill B',
  version: 2,
  body: 'BODY-B',
  scope: { process: 'planning', schemaVersion: 2 },
  state: 'active',
  createdAt: 333,
  updatedAt: 444,
};

/**
 * Canonical segment ordering (Req R1): compileContext MUST render the §7.2
 * segments in order 1–13, with 1–9 as the stable prefix and 10–13 as a
 * NON-INTERLEAVED dynamic suffix. This slice ships the 13-position table
 * itself (design D1); rendering of presence/absence lands with the elide
 * behavior (R4).
 */
describe('segment table — canonical §7.2 ordering (R1)', () => {
  it('declares exactly 13 segments with unique ids', () => {
    expect(SEGMENTS).toHaveLength(13);
    expect(new Set(SEGMENTS.map((s) => s.id)).size).toBe(13);
  });

  it('lists the §7.2 segment ids in canonical order', () => {
    expect(SEGMENTS.map((s) => s.id)).toEqual([
      'protocol',
      'constitution',
      'corporate-policies',
      'company-and-department',
      'role-contract',
      'certified-competencies',
      'active-skills',
      'business-process',
      'product-project-baseline',
      'recovered-memory',
      'current-work',
      'recent-evidence',
      'tool-results',
    ]);
  });

  it('positions run contiguously 1 through 13 in table order', () => {
    expect(SEGMENTS.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('stable segments occupy 1–9; dynamic 10–13; no suffix segment interleaves 1–9', () => {
    const stable = SEGMENTS.filter((s) => s.kind === 'stable').map((s) => s.position);
    const dynamic = SEGMENTS.filter((s) => s.kind === 'dynamic').map((s) => s.position);
    expect(stable).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(dynamic).toEqual([10, 11, 12, 13]);
    expect(Math.max(...stable)).toBeLessThan(Math.min(...dynamic));
  });
});

/**
 * Absent-segment rendering (Req R4 / design D4 elide): an unsourced segment
 * renders ABSENT with ZERO bytes at its FIXED position — it must never shift,
 * reorder, or absorb another segment. This slice sources only seg 1
 * (protocol, always) and seg 11 (current work); everything else is unsourced.
 */
describe('absent-segment rendering — fixed-position elide (R4)', () => {
  function renderAt(position: number) {
    const segment = SEGMENTS.find((candidate) => candidate.position === position);
    if (segment === undefined) throw new Error(`no segment at position ${position}`);
    return segment.render(input);
  }

  it('unsourced stable segments render ABSENT with zero bytes', () => {
    // Compiler slice sources seg 1 (protocol) and 8 (business-process). Segs
    // 2,3,4,6,7,9 are unsourced in every configuration; seg 5 (role-contract)
    // is ABSENT this slice — its content source is per-delegation detail, which
    // is NOT cohort-stable, so rendering it in the prefix would violate R2.
    for (const position of [2, 3, 4, 5, 6, 7, 9, 10]) {
      const rendered = renderAt(position);
      expect(rendered.present).toBe(false);
      expect(rendered.text).toBeUndefined();
    }
  });

  it('unsourced dynamic suffix segments 12–13 render ABSENT with zero bytes', () => {
    for (const position of [12, 13]) {
      const rendered = renderAt(position);
      expect(rendered.present).toBe(false);
      expect(rendered.text).toBeUndefined();
    }
  });

  it('segments 1 (protocol) and 11 (current work) render present with non-empty text', () => {
    const protocol = renderAt(1);
    const currentWork = renderAt(11);
    expect(protocol.present).toBe(true);
    expect(protocol.text).toBeTypeOf('string');
    expect((protocol.text ?? '').length).toBeGreaterThan(0);
    expect(currentWork.present).toBe(true);
    expect(currentWork.text).toBeTypeOf('string');
    expect((currentWork.text ?? '').length).toBeGreaterThan(0);
  });

  it('absent segments hold their fixed position — seg 11 does not shift', () => {
    expect(SEGMENTS.find((candidate) => candidate.id === 'current-work')?.position).toBe(11);
    const presentOrder = SEGMENTS.filter((candidate) => candidate.render(input).present).map(
      (candidate) => candidate.position,
    );
    // Compiler slice: seg 1 (protocol), 8 (business-process from process), 11 (work).
    expect(presentOrder).toEqual([1, 8, 11]);
  });

  it('concatenating present renders yields exactly seg 1 + seg 8 + seg 11 bytes (nothing injected)', () => {
    const protocolText = renderAt(1).text ?? '';
    const processText = renderAt(8).text ?? '';
    const currentWorkText = renderAt(11).text ?? '';
    const concatenated = SEGMENTS.filter((candidate) => candidate.render(input).present)
      .map((candidate) => candidate.render(input).text ?? '')
      .join('');
    expect(concatenated).toBe(`${protocolText}${processText}${currentWorkText}`);
  });
});

/**
 * Stable-prefix construction (Req R3 / design: buildStablePrefix). The prefix
 * MUST be built ONLY from stable segments 1–9, and its first byte MUST come
 * from the LOWEST-numbered present stable segment. Forbidden leading content
 * (current date, random id, nonce, heartbeat, recent snapshot, variable
 * message, tool result) lives in DYNAMIC segments 10–13 and can therefore
 * never lead. buildStablePrefix takes an optional segments table so the R3
 * edge cases (segs 1–2 absent) can be exercised without mutating the
 * canonical SEGMENTS table.
 */
describe('buildStablePrefix — forbidden-leading guard (R3)', () => {
  /** A protocol fixture rich enough to render every present stable segment. */
  const richInput: CompileContextInput = { companyId: 'acme', process: 'planning', work };

  /** Synthetic dynamic segments carrying every forbidden leading category. */
  const forbiddenSuffix: Segment[] = [
    {
      id: 'recovered-memory',
      position: 10,
      kind: 'dynamic',
      render: () => ({ present: true, text: '2026-08-01 recent snapshot' }),
    },
    {
      id: 'current-work',
      position: 11,
      kind: 'dynamic',
      render: () => ({ present: true, text: 'random-id-1234 nonce-abc heartbeat 12:00:00' }),
    },
    {
      id: 'recent-evidence',
      position: 12,
      kind: 'dynamic',
      render: () => ({ present: true, text: 'variable message #42' }),
    },
    {
      id: 'tool-results',
      position: 13,
      kind: 'dynamic',
      render: () => ({ present: true, text: 'tool result: create-document' }),
    },
  ];

  it('forbidden categories cannot lead — prefix starts with the protocol, not date/id/nonce', () => {
    const prefix = buildStablePrefix(richInput);
    expect(prefix.startsWith('You are the IO worker cycle planner.')).toBe(true);
  });

  it('dynamic forbidden values never appear ahead of the first stable segment', () => {
    // A full synthetic table: stable segs 1 and 3 present; dynamic 10–13 carry
    // every forbidden category. The prefix must still lead with the lowest
    // present STABLE segment and contain none of the forbidden content.
    const synthetic: Segment[] = [
      {
        id: 'protocol',
        position: 1,
        kind: 'stable',
        render: () => ({ present: true, text: 'PROTOCOL' }),
      },
      { id: 'constitution', position: 2, kind: 'stable', render: () => ({ present: false }) },
      {
        id: 'corporate-policies',
        position: 3,
        kind: 'stable',
        render: () => ({ present: true, text: 'POLICIES' }),
      },
      ...forbiddenSuffix,
    ];
    const prefix = buildStablePrefix(richInput, synthetic);
    expect(prefix).toBe('PROTOCOLPOLICIES');
  });

  it('lowest present stable segment leads when segs 1–2 are ABSENT', () => {
    const synthetic: Segment[] = [
      { id: 'protocol', position: 1, kind: 'stable', render: () => ({ present: false }) },
      { id: 'constitution', position: 2, kind: 'stable', render: () => ({ present: false }) },
      {
        id: 'corporate-policies',
        position: 3,
        kind: 'stable',
        render: () => ({ present: true, text: 'POLICIES' }),
      },
      {
        id: 'company-and-department',
        position: 4,
        kind: 'stable',
        render: () => ({ present: true, text: 'COMPANY' }),
      },
      ...forbiddenSuffix,
    ];
    const prefix = buildStablePrefix(richInput, synthetic);
    expect(prefix.startsWith('POLICIES')).toBe(true);
    expect(prefix[0]).toBe('P');
  });

  it('empty prefix when every stable segment is ABSENT (nothing to lead with)', () => {
    const synthetic: Segment[] = [
      { id: 'protocol', position: 1, kind: 'stable', render: () => ({ present: false }) },
      { id: 'constitution', position: 2, kind: 'stable', render: () => ({ present: false }) },
      ...forbiddenSuffix,
    ];
    expect(buildStablePrefix(richInput, synthetic)).toBe('');
  });
});

/**
 * Segment 7 — active skills (Req R1 S1/S2/S3, skill R7 S1/S3). The segment
 * MUST render cohort-selected active skills ordered by `skillId` ascending with
 * ONLY the fixed fields {skillId, name, version, body}; an empty selection MUST
 * render ABSENT with zero bytes (backward compatible — no-skills callers keep
 * the exact old prefix bytes).
 */
describe('segment 7 — active skills render (R1, skill R7)', () => {
  function renderSeg7(compiled: CompileContextInput): SegmentRender {
    const segment = SEGMENTS.find((candidate) => candidate.position === 7);
    if (segment === undefined) throw new Error('no segment at position 7');
    return segment.render(compiled);
  }

  it('R1/S1: matching active skills render with fixed fields only, skillId ASC', () => {
    // Inserted as [skillB, skillA] but must render as [skillA, skillB] (ASC).
    const rendered = renderSeg7({ ...input, skills: [skillB, skillA] });
    expect(rendered.present).toBe(true);
    expect(rendered.text).toBe(
      'Active skills:\n- id=a-skill name=Skill A v=1\nBODY-A\n- id=b-skill name=Skill B v=2\nBODY-B',
    );
  });

  it('R1/S1: metadata never leaks — only the fixed fields appear in the bytes', () => {
    const text = renderSeg7({ ...input, skills: [skillA] }).text ?? '';
    expect(text).toBe('Active skills:\n- id=a-skill name=Skill A v=1\nBODY-A');
    expect(text).not.toContain('111'); // createdAt
    expect(text).not.toContain('222'); // updatedAt
    expect(text).not.toContain('schemaVersion'); // scope is a cohort input, not a rendered field
    expect(text).not.toContain('acme'); // companyId is a cohort input, not a rendered field
  });

  it('R1/S2: insertion order cannot change the bytes — reversed skills render identically', () => {
    const forward = buildStablePrefix({ ...input, skills: [skillA, skillB] });
    const reversed = buildStablePrefix({ ...input, skills: [skillB, skillA] });
    expect(reversed).toBe(forward);
  });

  it('R1/S3 + R7/S3: empty or undefined skills render ABSENT — zero bytes contributed', () => {
    const empty = renderSeg7({ ...input, skills: [] });
    const missing = renderSeg7({ ...input, skills: undefined });
    expect(empty.present).toBe(false);
    expect(empty.text).toBeUndefined();
    expect(missing.present).toBe(false);
    // Zero bytes: the prefix with empty skills is byte-identical to the
    // no-skills prefix (backward compatible).
    expect(buildStablePrefix({ ...input, skills: [] })).toBe(buildStablePrefix(input));
  });
});

/**
 * Compiled output selection (context-compiler delta: Compiled Output Contract).
 * `compileContext` SHALL return `activatedSkills` exposing the EXACT segment-7
 * cohort selection as ordered `{ skillId, version }` values — including an
 * empty list when none is selected — surfaced from the SAME single-pass
 * selection that renders segment 7. Compilation SHALL be pure and SHALL NOT
 * invoke any client.
 */
describe('compileContext — activatedSkills output contract (context-compiler delta)', () => {
  function renderSeg7(compiled: CompileContextInput): SegmentRender {
    const segment = SEGMENTS.find((candidate) => candidate.position === 7);
    if (segment === undefined) throw new Error('no segment at position 7');
    return segment.render(compiled);
  }

  it('activatedSkills equals the segment-7 cohort selection in order', () => {
    // Inserted as [skillB, skillA] but must surface as [skillA, skillB] (ASC).
    const compiled = compileContext({ ...input, skills: [skillB, skillA] });
    expect(compiled.activatedSkills).toEqual([
      { skillId: 'a-skill', version: 1 },
      { skillId: 'b-skill', version: 2 },
    ]);
  });

  it('activatedSkills matches the segment-7 render order — same selection, same array', () => {
    const compiled = compileContext({ ...input, skills: [skillB, skillA] });
    const rendered = renderSeg7({ ...input, skills: [skillB, skillA] });
    expect(rendered.present).toBe(true);
    // The rendered bytes expose skillId+version in order; the refs must match.
    const renderedLines = (rendered.text ?? '').split('\n');
    const renderedRefs = renderedLines
      .filter((line) => line.startsWith('- id='))
      .map((line) => {
        const id = line.match(/^- id=(\S+)/)?.[1] ?? '';
        const version = Number(line.match(/ v=(\d+)/)?.[1] ?? '');
        return { skillId: id, version };
      });
    expect(compiled.activatedSkills).toEqual(renderedRefs);
  });

  it('empty selection surfaces an explicit empty list (no skills → [])', () => {
    const empty = compileContext({ ...input, skills: [] });
    const missing = compileContext(input); // no skills key at all
    expect(empty.activatedSkills).toEqual([]);
    expect(missing.activatedSkills).toEqual([]);
    // Empty list and segment 7 ABSENT coexist: prefix bytes unchanged.
    expect(buildStablePrefix({ ...input, skills: [] })).toBe(buildStablePrefix(input));
  });

  it('compileContext makes ZERO LlmClient calls — pure data transformation', () => {
    const client = { complete: vi.fn() };
    const compiled = compileContext({ ...input, skills: [skillA, skillB] });
    // Output is LlmClient-complete-consumable: messages + user are present.
    expect(compiled.messages).toHaveLength(2);
    expect(compiled.messages[0]?.role).toBe('system');
    expect(compiled.messages[1]?.role).toBe('user');
    expect(typeof compiled.user).toBe('string');
    expect(compiled.activatedSkills).toEqual([
      { skillId: 'a-skill', version: 1 },
      { skillId: 'b-skill', version: 2 },
    ]);
    // The client spy is never invoked — compilation returns data only.
    expect(client.complete).not.toHaveBeenCalled();
  });
});
