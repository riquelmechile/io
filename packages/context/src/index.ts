/**
 * Public surface of @io/context — the pure canonical context compiler slice
 * (design D1/D4). Exports the §7.2 segment table (Req R1), the stable-prefix
 * builder, the cache-cohort derivation (Req R5), and the schema version that
 * governs byte stability (Req R6). Nothing here touches llm-client, openai, or
 * app code.
 */
import type { ActivatedSkillRef } from '@io/business-domain/src/index.js';
import type { CompileContextInput, Segment } from './segments.js';
import {
  buildDynamicSuffix,
  buildStablePrefix,
  CONTEXT_SCHEMA_VERSION,
  renderSelectedSkills,
  SEGMENTS,
  selectActiveSkills,
  toActivatedSkillRefs,
} from './segments.js';

/**
 * Cache-cohort derivation (Req R5 / design §7.3). `user` is derived as
 * `io:{companyId}:{process}:v{schemaVersion}` — NEVER caller-supplied, and a
 * pure function of EXACTLY {companyId, process, schemaVersion}: no work, no
 * name/email/PII, no dynamic-tail (segments 10–13) input exists, so cohort
 * peers share policy, privacy, and exact prefix bytes.
 */
export function deriveCohort(a: {
  readonly companyId: string;
  readonly process: string;
  readonly schemaVersion: number;
}): string {
  return `io:${a.companyId}:${a.process}:v${a.schemaVersion}`;
}

/**
 * One compiled context message (design D2: structural, BD-only dep). The role
 * union is a SUBSET of the llm-client message role union, so
 * `readonly ContextMessage[]` is structurally assignable to `LlmMessage[]`
 * (LlmMessage's remaining fields are all optional) — consumable by
 * LlmClient.complete without importing llm-client (Req R7).
 */
export interface ContextMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/** Output contract of compileContext (Req R7): [system prefix, user suffix] + derived cohort. */
export interface CompiledContext {
  readonly messages: readonly ContextMessage[];
  /** Derived cache cohort — NEVER caller-supplied (Req R5). */
  readonly user: string;
  /**
   * Exact segment-7 cohort selection as ordered `{ skillId, version }` refs
   * (skill-outcome design: compiler single-pass). Exposed from the SAME
   * selection that renders the stable prefix — never re-selected — and empty
   * when no Skill is eligible.
   */
  readonly activatedSkills: readonly ActivatedSkillRef[];
}

/**
 * Compile the canonical context (Req R7 / design: compileContext). PURE:
 * messages[0] = stable prefix (segments 1–9, role system), messages[1] =
 * dynamic suffix (segments 10–13, role user), user = derived cohort
 * io:{companyId}:{process}:v{CONTEXT_SCHEMA_VERSION}. No client is ever
 * accepted or invoked and no side effect occurs — same input always yields
 * identical bytes.
 *
 * Single-pass selection (skill-outcome design): the segment-7 cohort is
 * computed ONCE via `selectActiveSkills`; the SAME selected array is closed
 * over by the seg-7 render (prefix bytes unchanged) and mapped by
 * `toActivatedSkillRefs` into the output `activatedSkills` refs.
 */
export function compileContext(input: CompileContextInput): CompiledContext {
  // ONE selection — shared by prefix rendering and the output refs.
  const selected = selectActiveSkills(input);
  // Render the prefix with the pre-selected array (no re-selection): override
  // the seg-7 render slot with a closure over the SAME array.
  const segments: readonly Segment[] = SEGMENTS.map((segment) =>
    segment.id === 'active-skills'
      ? { ...segment, render: () => renderSelectedSkills(selected) }
      : segment,
  );
  return {
    messages: [
      { role: 'system', content: buildStablePrefix(input, segments) },
      { role: 'user', content: buildDynamicSuffix(input, segments) },
    ],
    user: deriveCohort({
      companyId: input.companyId,
      process: input.process,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
    }),
    activatedSkills: toActivatedSkillRefs(selected),
  };
}

export type {
  CompileContextInput,
  Segment,
  SegmentId,
  SegmentKind,
  SegmentRender,
} from './segments.js';
export {
  CONTEXT_SCHEMA_VERSION,
  SEGMENTS,
  buildStablePrefix,
  buildDynamicSuffix,
} from './segments.js';
export type { ActivatedSkillRef } from '@io/business-domain/src/index.js';
