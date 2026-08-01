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
  /**
   * Optional delegation. Per-delegation detail (expectedOutcome/actions/scope)
   * is per-request DYNAMIC content — NOT a cohort discriminator (deriveCohort
   * reads only companyId/process/version) — so the STABLE prefix MUST NOT read
   * it (Req R2). Reserved for future dynamic-suffix role-contract content; the
   * prefix never touches it this slice.
   */
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

/** Segment 8 — business process (design D3: process token, never the role). */
function renderBusinessProcess({ process }: CompileContextInput): SegmentRender {
  return { present: true, text: `Business process: ${process}.` };
}

/**
 * Stable-prefix builder (Req R3 / design: buildStablePrefix). Concatenates the
 * text of PRESENT segments 1–9 in canonical order; dynamic segments 10–13 are
 * structurally excluded, so forbidden leading content (date/id/nonce/heartbeat/
 * snapshot/variable message/tool result) can NEVER lead — the first byte always
 * comes from the lowest-numbered present STABLE segment. The optional `segments`
 * table defaults to the canonical SEGMENTS and exists so the R3 edge cases
 * (segs 1–2 absent) can be exercised without mutating the constant table.
 */
export function buildStablePrefix(
  input: CompileContextInput,
  segments: readonly Segment[] = SEGMENTS,
): string {
  return segments
    .filter((segment) => segment.position >= 1 && segment.position <= 9)
    .map((segment) => segment.render(input))
    .filter((rendered) => rendered.present)
    .map((rendered) => rendered.text ?? '')
    .join('');
}

/**
 * Dynamic-suffix builder (design: buildDynamicSuffix). Concatenates the text of
 * PRESENT segments 10–13 in canonical order → messages[1] (role user). The
 * suffix MAY vary per request (work/evidence/tools); it NEVER enters the stable
 * prefix bytes (Req R2). The optional `segments` table defaults to SEGMENTS and
 * mirrors buildStablePrefix for testability.
 */
export function buildDynamicSuffix(
  input: CompileContextInput,
  segments: readonly Segment[] = SEGMENTS,
): string {
  return segments
    .filter((segment) => segment.position >= 10 && segment.position <= 13)
    .map((segment) => segment.render(input))
    .filter((rendered) => rendered.present)
    .map((rendered) => rendered.text ?? '')
    .join('');
}

/**
 * The 13 canonical segments in §7.2 order (Req R1). Rows are immutable data:
 * the same cohort MUST always see the same prefix bytes, so the table is a
 * frozen constant — a stable-segment change is a CONTEXT_SCHEMA_VERSION bump
 * (R6), never an edit in place. This slice sources seg 1 (protocol, always),
 * seg 8 (business-process, from the cohort discriminator `process`), and seg 11
 * (current work, dynamic); every other segment elides to ABSENT (R4).
 *
 * Segment 5 (role-contract) is ABSENT this slice: its rich content source is
 * per-delegation detail (expectedOutcome/actions/scope), which is per-request
 * DYNAMIC content, NOT cohort-stable. Rendering it in the stable prefix made the
 * prefix vary with delegation while the cohort stayed fixed — an R2 violation
 * (DeepSeek KV-cache poisoning). The legacy prompts (STABLE_SYSTEM_PREFIX +
 * buildUserTail) never contained a role contract, so ABSENT matches legacy and
 * restores R2: the prefix is a pure function of {companyId, process, version}.
 */
export const SEGMENTS: readonly Segment[] = Object.freeze([
  Object.freeze({
    id: 'protocol',
    position: 1,
    kind: 'stable',
    render: () => ({ present: true, text: STABLE_PROTOCOL_TEXT }),
  }),
  Object.freeze({
    id: 'constitution',
    position: 2,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'corporate-policies',
    position: 3,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'company-and-department',
    position: 4,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'role-contract',
    position: 5,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'certified-competencies',
    position: 6,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'active-skills',
    position: 7,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'business-process',
    position: 8,
    kind: 'stable',
    render: renderBusinessProcess,
  }),
  Object.freeze({
    id: 'product-project-baseline',
    position: 9,
    kind: 'stable',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'recovered-memory',
    position: 10,
    kind: 'dynamic',
    render: () => ({ present: false }),
  }),
  Object.freeze({ id: 'current-work', position: 11, kind: 'dynamic', render: renderCurrentWork }),
  Object.freeze({
    id: 'recent-evidence',
    position: 12,
    kind: 'dynamic',
    render: () => ({ present: false }),
  }),
  Object.freeze({
    id: 'tool-results',
    position: 13,
    kind: 'dynamic',
    render: () => ({ present: false }),
  }),
]);
