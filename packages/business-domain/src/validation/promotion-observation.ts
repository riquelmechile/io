import { hasLoneSurrogate, type LearningSubject } from '../learning-candidate.js';
import type { ParseResult } from './command.js';
import { cloneAndFreezeSafeData, readClosedDataRecord, readDenseDataArray } from './safe-data.js';
/** Bound promotion-observation foundation (Slice 1E-b1) + public explicit-evidence envelope (task 1.6): descriptor-safe bindings/observations, foreign detected BEFORE content via own-data probes, values cloned+frozen (recursively readonly). */
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const okString = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && !hasLoneSurrogate(v);
const okFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export interface PromotionEvidenceBinding {
  readonly companyId: string;
  readonly subject: LearningSubject;
}
/** Recursively readonly view of a validated category value (matches frozen clones). */
export type ReadonlyDeep<T> =
  T extends ReadonlyArray<infer U>
    ? ReadonlyArray<ReadonlyDeep<U>>
    : T extends object
      ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
      : T;
export interface BoundPromotionObservation<T> {
  readonly evidenceId: string;
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly sourceRef: string;
  readonly observedAt: number;
  readonly value: ReadonlyDeep<T>;
}
export type ObservationValueParser<T> = (raw: unknown, path: string) => ParseResult<T>;
const BINDING_KEYS = new Set(['companyId', 'subject']);
const SUBJECT_KEYS = new Set(['skillId', 'skillVersion']);
const OBS_KEYS = new Set('evidenceId,companyId,subject,sourceRef,observedAt,value'.split(','));
const parseSubject = (raw: unknown, path: string): ParseResult<LearningSubject> => {
  const rec = readClosedDataRecord(raw, path, SUBJECT_KEYS);
  if (!rec.ok) return rec;
  if (!okString(rec.value.skillId))
    return fail(`${path}.skillId must be a non-empty, well-formed string`);
  const v = rec.value.skillVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
    return fail(`${path}.skillVersion must be a positive integer`);
  return { ok: true, value: Object.freeze({ skillId: rec.value.skillId, skillVersion: v }) };
};
export function parsePromotionEvidenceBinding(
  raw: unknown,
  path: string,
): ParseResult<PromotionEvidenceBinding> {
  const rec = readClosedDataRecord(raw, path, BINDING_KEYS);
  if (!rec.ok) return rec;
  if (!okString(rec.value.companyId))
    return fail(`${path}.companyId must be a non-empty, well-formed string`);
  const subject = parseSubject(rec.value.subject, `${path}.subject`);
  if (!subject.ok) return subject;
  const value = Object.freeze({ companyId: rec.value.companyId, subject: subject.value });
  return { ok: true, value };
}
const foreignReason = (
  rec: Record<string, unknown>,
  binding: PromotionEvidenceBinding,
  path: string,
): string | undefined => {
  if (okString(rec.companyId) && rec.companyId !== binding.companyId)
    return 'companyId must equal the binding companyId';
  const subject = parseSubject(rec.subject, `${path}.subject`);
  if (
    subject.ok &&
    (subject.value.skillId !== binding.subject.skillId ||
      subject.value.skillVersion !== binding.subject.skillVersion)
  )
    return 'subject must equal the binding subject';
  return undefined;
};
export function parseBoundPromotionObservation<T>(
  raw: unknown,
  binding: PromotionEvidenceBinding,
  parseValue: ObservationValueParser<T>,
  path: string,
): ParseResult<BoundPromotionObservation<T>> {
  const rec = readClosedDataRecord(raw, path, OBS_KEYS);
  if (!rec.ok) return rec;
  const foreign = foreignReason(rec.value, binding, path);
  if (foreign) return fail(`${path}.${foreign}`);
  for (const key of ['evidenceId', 'companyId', 'sourceRef']) {
    const bad = okString(rec.value[key])
      ? undefined
      : `${path}.${key} must be a non-empty, well-formed string`;
    if (bad) return fail(bad);
  }
  if (!okFinite(rec.value.observedAt)) return fail(`${path}.observedAt must be a finite number`);
  const subject = parseSubject(rec.value.subject, `${path}.subject`);
  if (!subject.ok) return subject;
  let parsed: ParseResult<T>;
  try {
    parsed = parseValue(rec.value.value, `${path}.value`);
  } catch {
    return fail(`${path}.value could not be parsed`);
  }
  if (!parsed.ok) return parsed;
  const frozen = cloneAndFreezeSafeData(parsed.value, `${path}.value`);
  if (!frozen.ok) return frozen;
  const value = Object.freeze({
    evidenceId: rec.value.evidenceId as string,
    companyId: binding.companyId,
    subject: subject.value,
    sourceRef: rec.value.sourceRef as string,
    observedAt: rec.value.observedAt as number,
    value: frozen.value as ReadonlyDeep<T>,
  });
  return { ok: true, value };
}
export function parseBoundPromotionObservationList<T>(
  raw: unknown,
  binding: PromotionEvidenceBinding,
  parseValue: ObservationValueParser<T>,
  path: string,
): ParseResult<readonly BoundPromotionObservation<T>[]> {
  const dense = readDenseDataArray(raw, path);
  if (!dense.ok) return dense;
  const out: BoundPromotionObservation<T>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < dense.value.length; i += 1) {
    const itemPath = `${path}[${i}]`;
    const probe = readClosedDataRecord(dense.value[i], itemPath, OBS_KEYS);
    if (!probe.ok) return probe;
    if (foreignReason(probe.value, binding, itemPath)) continue;
    const parsed = parseBoundPromotionObservation(dense.value[i], binding, parseValue, itemPath);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.evidenceId))
      return fail(`${itemPath}.evidenceId must be unique across observations`);
    seen.add(parsed.value.evidenceId);
    out.push(parsed.value);
  }
  out.sort(
    (a, b) =>
      a.observedAt - b.observedAt ||
      (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0),
  );
  return { ok: true, value: Object.freeze(out) };
}
const BOOL_MSG = 'must be a boolean';
const DESC_MSG = 'must be a well-formed string';
const twoField = (
  raw: unknown,
  path: string,
  a: string,
  b: string,
  aMsg: string,
  bMsg: string,
): ParseResult<Readonly<Record<string, boolean | string>>> => {
  const rec = readClosedDataRecord(raw, path, new Set([a, b]));
  if (!rec.ok) return rec;
  for (const [key, msg] of [
    [a, aMsg],
    [b, bMsg],
  ] as const) {
    const v = rec.value[key];
    if (msg === BOOL_MSG ? typeof v !== 'boolean' : typeof v !== 'string' || hasLoneSurrogate(v))
      return fail(`${path}.${key} ${msg}`);
  }
  const av = rec.value[a] as boolean | string,
    bv = rec.value[b] as boolean | string;
  return { ok: true, value: Object.freeze({ [a]: av, [b]: bv }) };
};
export type RateValue = Readonly<{ positive: boolean; harmful: boolean }>;
export type ConflictValue = Readonly<{ unresolved: boolean; description: string }>;
export type VetoValue = Readonly<{ triggered: boolean; description: string }>;
const okConfidence = (v: unknown): v is number => okFinite(v) && v >= 0 && v <= 1;
export const parseConfidenceValue: ObservationValueParser<number> = (raw, path) =>
  okConfidence(raw) ? { ok: true, value: raw } : fail(`${path} must be a finite number in [0, 1]`);
export const parseSourceAuthorityValue: ObservationValueParser<string> = (raw, path) =>
  okString(raw) ? { ok: true, value: raw } : fail(`${path} must be a well-formed non-empty string`);
export const parseRateValue: ObservationValueParser<RateValue> = (raw, path) =>
  twoField(raw, path, 'positive', 'harmful', BOOL_MSG, BOOL_MSG) as ParseResult<RateValue>;
export const parseConflictValue: ObservationValueParser<ConflictValue> = (raw, path) =>
  twoField(
    raw,
    path,
    'unresolved',
    'description',
    BOOL_MSG,
    DESC_MSG,
  ) as ParseResult<ConflictValue>;
export const parseVetoValue: ObservationValueParser<VetoValue> = (raw, path) =>
  twoField(raw, path, 'triggered', 'description', BOOL_MSG, DESC_MSG) as ParseResult<VetoValue>;

/** Public observation alias: a validated observation whose value is recursively readonly (matches frozen clones). */
export type ExplicitObservation<T> = BoundPromotionObservation<T>;
/** Public explicit-evidence envelope: required conflict/veto lists plus optional confidence/authority/rate categories. */
export interface ExplicitPromotionEvidence {
  readonly confidence?: ExplicitObservation<number>;
  readonly sourceAuthority?: ExplicitObservation<string>;
  readonly rateObservations?: readonly ExplicitObservation<RateValue>[];
  readonly conflicts: readonly ExplicitObservation<ConflictValue>[];
  readonly catastrophicVetoes: readonly ExplicitObservation<VetoValue>[];
}
const ENVELOPE_KEYS = new Set(
  'confidence,sourceAuthority,rateObservations,conflicts,catastrophicVetoes'.split(','),
);
const REQUIRED_ENVELOPE_KEYS = new Set(['conflicts', 'catastrophicVetoes']);
const parseEnvelopeSingle = <T>(
  raw: unknown,
  binding: PromotionEvidenceBinding,
  parseValue: ObservationValueParser<T>,
  path: string,
  ids: Set<string>,
): ParseResult<ExplicitObservation<T> | undefined> => {
  const probe = readClosedDataRecord(raw, path, OBS_KEYS);
  if (!probe.ok) return probe;
  if (foreignReason(probe.value, binding, path)) return { ok: true, value: undefined };
  const parsed = parseBoundPromotionObservation(raw, binding, parseValue, path);
  if (!parsed.ok) return parsed;
  if (ids.has(parsed.value.evidenceId))
    return fail(`${path}.evidenceId must be unique across envelope categories`);
  ids.add(parsed.value.evidenceId);
  return { ok: true, value: parsed.value };
};
const parseEnvelopeList = <T>(
  raw: unknown,
  binding: PromotionEvidenceBinding,
  parseValue: ObservationValueParser<T>,
  path: string,
  ids: Set<string>,
): ParseResult<readonly ExplicitObservation<T>[]> => {
  const parsed = parseBoundPromotionObservationList(raw, binding, parseValue, path);
  if (!parsed.ok) return parsed;
  for (const obs of parsed.value) {
    if (ids.has(obs.evidenceId))
      return fail(`${path}.evidenceId must be unique across envelope categories`);
    ids.add(obs.evidenceId);
  }
  return parsed;
};
/**
 * Public explicit-promotion evidence envelope (task 1.6): descriptor-safe closed
 * record; required conflicts/catastrophicVetoes; optional confidence/
 * sourceAuthority/rateObservations absent when the key is absent, malformed when
 * present `undefined`; ONE shared evidenceId set across categories; foreign
 * single omitted, foreign list items skipped; canonical list order; deeply
 * frozen fresh output, caller input untouched; category errors propagate.
 */
export function parseExplicitPromotionEvidence(
  raw: unknown,
  binding: PromotionEvidenceBinding,
): ParseResult<ExplicitPromotionEvidence> {
  const rec = readClosedDataRecord(raw, 'envelope', ENVELOPE_KEYS);
  if (!rec.ok) return rec;
  const ids = new Set<string>();
  const out: Record<string, unknown> = {};
  for (const key of REQUIRED_ENVELOPE_KEYS) {
    if (!(key in rec.value)) return fail(`envelope.${key} must be present`);
    const parser = (
      key === 'conflicts' ? parseConflictValue : parseVetoValue
    ) as ObservationValueParser<ConflictValue | VetoValue>;
    const list = parseEnvelopeList(rec.value[key], binding, parser, `envelope.${key}`, ids);
    if (!list.ok) return list;
    out[key] = list.value;
  }
  if ('confidence' in rec.value) {
    const single = parseEnvelopeSingle(
      rec.value.confidence,
      binding,
      parseConfidenceValue,
      'envelope.confidence',
      ids,
    );
    if (!single.ok) return single;
    if (single.value !== undefined) out.confidence = single.value;
  }
  if ('sourceAuthority' in rec.value) {
    const single = parseEnvelopeSingle(
      rec.value.sourceAuthority,
      binding,
      parseSourceAuthorityValue,
      'envelope.sourceAuthority',
      ids,
    );
    if (!single.ok) return single;
    if (single.value !== undefined) out.sourceAuthority = single.value;
  }
  if ('rateObservations' in rec.value) {
    const list = parseEnvelopeList(
      rec.value.rateObservations,
      binding,
      parseRateValue,
      'envelope.rateObservations',
      ids,
    );
    if (!list.ok) return list;
    out.rateObservations = list.value;
  }
  return { ok: true, value: Object.freeze(out) as unknown as ExplicitPromotionEvidence };
}
