/**
 * Public surface of @io/context — the pure canonical context compiler slice
 * (design D1/D4). Exports the §7.2 segment table (Req R1) and its types. The
 * prefix/suffix builders, cohort derivation, and compileContext land with the
 * compiler slice; nothing here touches llm-client, openai, or app code.
 */
export type {
  CompileContextInput,
  Segment,
  SegmentId,
  SegmentKind,
  SegmentRender,
} from './segments.js';
export { SEGMENTS } from './segments.js';
