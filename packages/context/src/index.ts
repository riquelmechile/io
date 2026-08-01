/**
 * Public surface of @io/context — the pure canonical context compiler slice
 * (design D1/D4). Exports the §7.2 segment table (Req R1), the stable-prefix
 * builder, the cache-cohort derivation (Req R5), and the schema version that
 * governs byte stability (Req R6). Nothing here touches llm-client, openai, or
 * app code.
 */
import type { CompileContextInput } from './segments.js';
import { buildDynamicSuffix, buildStablePrefix } from './segments.js';

/**
 * Schema version of the compiled context (design D6). Adding or changing a
 * STABLE segment MUST bump this constant — changed prefix bytes MUST NOT be
 * emitted under an existing cohort (Req R6). The golden pin (test fixture
 * `prefix.v{CONTEXT_SCHEMA_VERSION}.golden.txt`) locks the prefix bytes for the
 * current version: a silent prefix change fails the pin until the golden is
 * deliberately regenerated AND this constant is bumped.
 */
export const CONTEXT_SCHEMA_VERSION = 1;

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
}

/**
 * Compile the canonical context (Req R7 / design: compileContext). PURE:
 * messages[0] = stable prefix (segments 1–9, role system), messages[1] =
 * dynamic suffix (segments 10–13, role user), user = derived cohort
 * io:{companyId}:{process}:v{CONTEXT_SCHEMA_VERSION}. No client is ever
 * invoked and no side effect occurs — same input always yields identical bytes.
 */
export function compileContext(input: CompileContextInput): CompiledContext {
  return {
    messages: [
      { role: 'system', content: buildStablePrefix(input) },
      { role: 'user', content: buildDynamicSuffix(input) },
    ],
    user: deriveCohort({
      companyId: input.companyId,
      process: input.process,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
    }),
  };
}

export type {
  CompileContextInput,
  Segment,
  SegmentId,
  SegmentKind,
  SegmentRender,
} from './segments.js';
export { SEGMENTS, buildStablePrefix, buildDynamicSuffix } from './segments.js';
