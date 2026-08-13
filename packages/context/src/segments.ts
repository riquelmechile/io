import type { ActivatedSkillRef, Delegation, Skill, Work } from '@io/business-domain/src/index.js';
import { activeSkillsFor } from '@io/business-domain/src/index.js';

/**
 * Schema version of the compiled context (design D6 / Req R6). Adding or
 * changing a STABLE segment MUST bump this constant — changed prefix bytes MUST
 * NOT be emitted under an existing cohort. Defined here (not in index.ts) so the
 * segment-7 render can read it without a segments↔index import cycle; index.ts
 * re-exports it as part of the public surface. The golden pin (test fixture
 * `prefix.v{CONTEXT_SCHEMA_VERSION}.golden.txt`) locks the prefix bytes for the
 * current version: a silent prefix change fails the pin until the golden is
 * deliberately regenerated AND this constant is bumped.
 */
export const CONTEXT_SCHEMA_VERSION = 2;

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
  /**
   * Optional tenant skill store (skill R7). The compiler selects the
   * cohort-active Skills itself via `activeSkillsFor` — the input carries the
   * RAW store, never a pre-filtered selection. Optional keeps every no-skills
   * caller backward-compatible: empty/`undefined` renders segment 7 ABSENT
   * with zero bytes.
   */
  readonly skills?: readonly Skill[];
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
 * Segment 1 — DeepSeek protocol (design: migrated from the legacy hard-coded
 * stable system prefix). The byte-identical legacy prefix keeps the cache cohort
 * and the worker cycle prompts stable (same cohort ⇒ identical prefix bytes,
 * Req R2).
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
 * Segment 7 — active skills (Req R1 / skill R7). Cohort rule (CRITICAL): the
 * selection passes ONLY `{companyId, process, schemaVersion:
 * CONTEXT_SCHEMA_VERSION}` into `activeSkillsFor` — the exact deriveCohort
 * tuple. Work, delegation, clocks, generated IDs, and dynamic-tail content can
 * structurally never enter, so segment 7 bytes are a pure function of the
 * cohort and the raw tenant skill store (Req R2 / inverse-poison proof).
 *
 * Serialization (design): fixed multi-line template, fields ONLY
 * {skillId, name, version, body}, order = `activeSkillsFor` output (skillId
 * ASC, one Skill per identity, max version). No timestamps/ids/Map order —
 * the exact bytes are locked by the v2 golden pin. An empty selection renders
 * ABSENT with zero bytes (backward compatible).
 */

/**
 * The SINGLE segment-7 selection call site (skill-outcome design: compiler
 * single-pass). Computes the cohort selection ONCE from the raw tenant skill
 * store; `compileContext` feeds the SAME selected array into both
 * {@link renderSelectedSkills} (prefix bytes) and {@link toActivatedSkillRefs}
 * (output refs) — the selection is never re-derived.
 */
export function selectActiveSkills({
  companyId,
  process,
  skills,
}: CompileContextInput): readonly Skill[] {
  return activeSkillsFor(
    { companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION },
    skills ?? [],
  );
}

/**
 * Render a CALLER-SUPPLIED selected array (skill-outcome design: segment-7
 * render receives the already-selected array — no re-selection). Empty renders
 * ABSENT with zero bytes (backward compatible).
 */
export function renderSelectedSkills(selected: readonly Skill[]): SegmentRender {
  if (selected.length === 0) return { present: false };
  const text =
    'Active skills:\n' +
    selected
      .map((skill) => `- id=${skill.skillId} name=${skill.name} v=${skill.version}\n${skill.body}`)
      .join('\n');
  return { present: true, text };
}

/**
 * Map the already-selected segment-7 `Skill[]` to ordered refs (skill-outcome
 * design: the SAME array, no re-select — order preserved as rendered). The
 * refs carry only the identity pair the usage-outcome fact attributes:
 * `{ skillId, version }` (skill delta: Captured version is attributed).
 */
export function toActivatedSkillRefs(selected: readonly Skill[]): readonly ActivatedSkillRef[] {
  return selected.map((skill) => ({ skillId: skill.skillId, version: skill.version }));
}

/** Canonical seg-7 render for the SEGMENTS table (single selection internally). */
function renderActiveSkills(input: CompileContextInput): SegmentRender {
  return renderSelectedSkills(selectActiveSkills(input));
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
 * seg 7 (active skills, from the raw tenant skill store via the cohort rule),
 * seg 8 (business-process, from the cohort discriminator `process`), and seg 11
 * (current work, dynamic); every other segment elides to ABSENT (R4).
 *
 * Segment 5 (role-contract) is ABSENT this slice: its rich content source is
 * per-delegation detail (expectedOutcome/actions/scope), which is per-request
 * DYNAMIC content, NOT cohort-stable. Rendering it in the stable prefix made the
 * prefix vary with delegation while the cohort stayed fixed — an R2 violation
 * (DeepSeek KV-cache poisoning). The legacy prompts (the old hard-coded prefix
 * + buildUserTail) never contained a role contract, so ABSENT matches legacy and
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
    render: renderActiveSkills,
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
