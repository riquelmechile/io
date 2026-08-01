import type { Delegation, Work } from '@io/business-domain/src/index.js';

/**
 * Canonical §7.2 segment table (design D1/D4; Req R1). The 13 segments are
 * declared ONCE here, in canonical order: positions 1–9 form the byte-stable
 * prefix, positions 10–13 the NON-INTERLEAVED dynamic suffix. Each row
 * declares its fixed position and renders itself from the compiler input;
 * an unsourced segment elides to ABSENT with zero bytes (Req R4) WITHOUT
 * shifting any other segment.
 */

/** Canonical §7.2 segment identifiers (Req R1, in order). */
export type SegmentId =
  | 'protocol'
  | 'constitution'
  | 'corporate-policies'
  | 'company-and-department'
  | 'role-contract'
  | 'certified-competencies'
  | 'active-skills'
  | 'business-process'
  | 'product-project-baseline'
  | 'recovered-memory'
  | 'current-work'
  | 'recent-evidence'
  | 'tool-results';

/** Stable segments 1–9 form the byte-stable prefix; dynamic 10–13 the suffix. */
export type SegmentKind = 'stable' | 'dynamic';

/**
 * Sources for segment rendering (design: CompileContextInput). Segments are
 * pure functions of these inputs — the same cohort always yields the same
 * prefix bytes (Req R2).
 */
export interface CompileContextInput {
  readonly companyId: string;
  /** Business process (design D3) — the cohort discriminator, never the role. */
  readonly process: string;
  /** Optional delegation (seg 5 role-contract source; absent when undefined). */
  readonly delegation?: Delegation;
  /** Current work — the ONLY dynamic input this slice consumes (seg 11). */
  readonly work: Work;
}

/** Result of rendering one segment (design D4 elide): present with text, or ABSENT. */
export interface SegmentRender {
  readonly present: boolean;
  /** Present segments render their text; ABSENT segments carry NO text (zero bytes). */
  readonly text?: string;
}

/** One slot in the canonical §7.2 ordering. */
export interface Segment {
  readonly id: SegmentId;
  /** Fixed position 1..13 in the canonical ordering (D4: absent segments still hold it). */
  readonly position: number;
  readonly kind: SegmentKind;
  /** Render this segment from its sources; unsourced segments elide to ABSENT (R4). */
  render(input: CompileContextInput): SegmentRender;
}

/**
 * Segment 1 — DeepSeek protocol (design: migrated STABLE_SYSTEM_PREFIX). The
 * byte-identical legacy stable prefix keeps the cache cohort and the worker
 * cycle prompts stable (same cohort ⇒ identical prefix bytes, Req R2).
 */
const STABLE_PROTOCOL_TEXT =
  'You are the IO worker cycle planner. Plan exactly ONE low-risk, reversible ' +
  'effect per request: a create-document action under the sandbox root. ' +
  'Respond with a single JSON object of shape ' +
  '{"steps":[{"action":"create-document","args":{"relativePath":"<path>","content":"<text>"}}],"intent":"<one-line intent>"}. ' +
  'Never invent authority, grants, principals, or identities.';

/** Segment 11 — current work (design: migrated buildUserTail). The ONLY dynamic
 * prefix-adjacent content; work NEVER leaks into the stable prefix (Req R2). */
function renderCurrentWork({ work }: CompileContextInput): SegmentRender {
  return {
    present: true,
    text: `Execute work ${work.workId} for company ${work.companyId}: ${work.description}. Produce a single reversible create-document plan.`,
  };
}

/**
 * The 13 canonical segments in §7.2 order (Req R1). Rows are immutable data:
 * the same cohort MUST always see the same prefix bytes, so the table is a
 * constant — a stable-segment change is a CONTEXT_SCHEMA_VERSION bump (R6),
 * never an edit in place. This slice sources only seg 1 (always) and seg 11
 * (work); every other segment elides to ABSENT (R4).
 */
export const SEGMENTS: readonly Segment[] = [
  {
    id: 'protocol',
    position: 1,
    kind: 'stable',
    render: () => ({ present: true, text: STABLE_PROTOCOL_TEXT }),
  },
  { id: 'constitution', position: 2, kind: 'stable', render: () => ({ present: false }) },
  { id: 'corporate-policies', position: 3, kind: 'stable', render: () => ({ present: false }) },
  { id: 'company-and-department', position: 4, kind: 'stable', render: () => ({ present: false }) },
  { id: 'role-contract', position: 5, kind: 'stable', render: () => ({ present: false }) },
  { id: 'certified-competencies', position: 6, kind: 'stable', render: () => ({ present: false }) },
  { id: 'active-skills', position: 7, kind: 'stable', render: () => ({ present: false }) },
  { id: 'business-process', position: 8, kind: 'stable', render: () => ({ present: false }) },
  {
    id: 'product-project-baseline',
    position: 9,
    kind: 'stable',
    render: () => ({ present: false }),
  },
  { id: 'recovered-memory', position: 10, kind: 'dynamic', render: () => ({ present: false }) },
  { id: 'current-work', position: 11, kind: 'dynamic', render: renderCurrentWork },
  { id: 'recent-evidence', position: 12, kind: 'dynamic', render: () => ({ present: false }) },
  { id: 'tool-results', position: 13, kind: 'dynamic', render: () => ({ present: false }) },
];
