import type { Work } from '@io/business-domain/src/index.js';
import { describe, expect, it } from 'vitest';

import type { CompileContextInput, Segment } from '../src/index.js';
import { buildStablePrefix, SEGMENTS } from '../src/index.js';

/** A fully-sourced Work fixture: drives segment 11 (current-work) rendering. */
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

/** Compile input for the fixture: protocol (seg 1) always present, work (seg 11) present. */
const input = { companyId: 'acme', process: 'planning', work };

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
