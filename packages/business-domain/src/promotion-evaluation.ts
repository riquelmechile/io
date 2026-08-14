import {
  hasLoneSurrogate,
  type LearningSubject,
  type SkillOutcomeEvidence,
} from './learning-candidate.js';
import { VALID_RISK_CLASSES } from './heartbeat.js';
import type { SkillScope } from './types.js';
import type { ParseResult } from './validation/command.js';

export type RiskClass = (typeof VALID_RISK_CLASSES)[number];
export interface PolicyRef {
  readonly policyId: string;
  readonly version: number;
}
export interface ExplicitRateRule {
  readonly threshold: number;
}
export interface PromotionPolicy {
  readonly policyId: string;
  readonly version: number;
  readonly companyId: string;
  readonly scope: SkillScope;
  readonly subject?: LearningSubject;
  readonly active: boolean;
  readonly effectiveFrom: number;
  readonly effectiveUntil: number;
  readonly observationWindowMs?: number;
  readonly minPositiveObservations: number;
  readonly minLinkedOutcomes: number;
  readonly requireUniqueOutcomes: boolean;
  readonly conflictBehavior: 'needs-review';
  readonly delegatedRiskClasses: readonly RiskClass[];
  readonly minConfidence?: number;
  readonly allowedSourceAuthorities?: readonly string[];
  readonly catastrophicVetoEnabled?: boolean;
  readonly successRate?: ExplicitRateRule;
  readonly harmfulCap?: ExplicitRateRule;
}
export type PolicyResolution =
  | { readonly kind: 'policy-not-found' }
  | { readonly kind: 'policy-invalid'; readonly reason: string }
  | { readonly kind: 'policy-ambiguous'; readonly policyRefs: readonly PolicyRef[] }
  | {
      readonly kind: 'resolved';
      readonly policy: PromotionPolicy;
      readonly windowStart: number;
      readonly windowEnd: number;
    };

const SUBJECT_KEYS = new Set(['skillId', 'skillVersion']);
const SCOPE_KEYS = new Set(['process', 'schemaVersion']);
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const invalid = (reason: string): PolicyResolution => ({ kind: 'policy-invalid', reason });
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const badExtra = (r: Record<string, unknown>, a: Set<string>, p: string): string | undefined => {
  const key = Object.keys(r).find((k) => !a.has(k));
  return key ? `${p} must not carry injected field "${key}"` : undefined;
};
const okString = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && !hasLoneSurrogate(v);
const okInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const okNatInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
const okFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const okPositiveFinite = (v: unknown): v is number => okFinite(v) && v > 0;
const okBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const okConfidence = (v: unknown): v is number => okFinite(v) && v >= 0 && v <= 1;
const okRateRule = (v: unknown): v is ExplicitRateRule => {
  if (!isRecord(v) || Object.keys(v).length !== 1 || !('threshold' in v)) return false;
  const t = v.threshold;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 1;
};

const parseSubject = (raw: unknown, path: string): ParseResult<LearningSubject> => {
  if (!isRecord(raw)) return fail(`${path} must be an object`);
  const bad = badExtra(raw, SUBJECT_KEYS, path);
  if (bad) return fail(bad);
  if (!okString(raw.skillId))
    return fail(`${path}.skillId must be a non-empty, well-formed string`);
  if (!okInt(raw.skillVersion)) return fail(`${path}.skillVersion must be a positive integer`);
  return { ok: true, value: { skillId: raw.skillId, skillVersion: raw.skillVersion } };
};
const parseScope = (raw: unknown, path: string): ParseResult<SkillScope> => {
  if (!isRecord(raw)) return fail(`${path} must be an object`);
  const bad = badExtra(raw, SCOPE_KEYS, path);
  if (bad) return fail(bad);
  if (!okString(raw.process))
    return fail(`${path}.process must be a non-empty, well-formed string`);
  if (!okInt(raw.schemaVersion)) return fail(`${path}.schemaVersion must be a positive integer`);
  return { ok: true, value: { process: raw.process, schemaVersion: raw.schemaVersion } };
};
const okRiskArray = (v: unknown): v is RiskClass[] => {
  if (!Array.isArray(v) || v.length === 0) return false;
  return (
    v.every(
      (e) => typeof e === 'string' && (VALID_RISK_CLASSES as readonly string[]).includes(e),
    ) && new Set(v).size === v.length
  );
};
const okAuthorityArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((e) => okString(e));

const POLICY_CHECKS: ReadonlyArray<readonly [string, boolean, (v: unknown) => boolean, string]> = [
  ['policyId', false, okString, 'must be a non-empty, well-formed string'],
  ['version', false, okInt, 'must be a positive integer'],
  ['companyId', false, okString, 'must be a non-empty, well-formed string'],
  ['active', false, okBoolean, 'must be a boolean'],
  ['effectiveFrom', false, okFinite, 'must be a finite number'],
  ['effectiveUntil', false, okFinite, 'must be a finite number'],
  ['observationWindowMs', true, okPositiveFinite, 'must be a positive finite number'],
  ['minPositiveObservations', false, okNatInt, 'must be a non-negative integer'],
  ['minLinkedOutcomes', false, okNatInt, 'must be a non-negative integer'],
  ['requireUniqueOutcomes', false, okBoolean, 'must be a boolean'],
  ['conflictBehavior', false, (v) => v === 'needs-review', 'must be exactly "needs-review"'],
  ['delegatedRiskClasses', false, okRiskArray, 'must be a non-empty unique risk array'],
  ['minConfidence', true, okConfidence, 'must be a finite number in [0, 1]'],
  ['allowedSourceAuthorities', true, okAuthorityArray, 'must be an array of well-formed strings'],
  ['catastrophicVetoEnabled', true, okBoolean, 'must be a boolean'],
  ['successRate', true, okRateRule, 'must be an explicit rate rule with a threshold in [0, 1]'],
  ['harmfulCap', true, okRateRule, 'must be an explicit rate rule with a threshold in [0, 1]'],
];
const POLICY_KEYS = new Set([...POLICY_CHECKS.map(([key]) => key), 'scope', 'subject']);

const parsePolicy = (raw: Record<string, unknown>, path: string): ParseResult<PromotionPolicy> => {
  const bad = badExtra(raw, POLICY_KEYS, path);
  if (bad) return fail(bad);
  const scope = parseScope(raw.scope, `${path}.scope`);
  if (!scope.ok) return scope;
  let subject: LearningSubject | undefined;
  if (raw.subject !== undefined) {
    const parsed = parseSubject(raw.subject, `${path}.subject`);
    if (!parsed.ok) return parsed;
    subject = parsed.value;
  }
  for (const [key, optional, validate, message] of POLICY_CHECKS) {
    const value = raw[key];
    if (value === undefined) {
      if (!optional) return fail(`${path}.${key} must be present (no numeric defaults)`);
      continue;
    }
    if (!validate(value)) return fail(`${path}.${key} ${message}`);
  }
  if ((raw.effectiveFrom as number) >= (raw.effectiveUntil as number))
    return fail(`${path} must satisfy effectiveFrom < effectiveUntil`);
  // Reconstruct explicitly — never spread untrusted raw; deep-copy nested values.
  const nested: Record<string, unknown> = {};
  for (const key of POLICY_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === 'scope') nested[key] = Object.freeze(scope.value);
    else if (key === 'subject') nested[key] = Object.freeze(subject);
    else if (key === 'delegatedRiskClasses')
      nested[key] = Object.freeze([...(value as RiskClass[])]);
    else if (key === 'allowedSourceAuthorities')
      nested[key] = Object.freeze([...(value as string[])]);
    else if (key === 'successRate' || key === 'harmfulCap')
      nested[key] = Object.freeze({ threshold: (value as ExplicitRateRule).threshold });
    else nested[key] = value;
  }
  return { ok: true, value: Object.freeze(nested as unknown as PromotionPolicy) };
};

/** Precedence: malformed input fails closed; foreign string companyId skipped BEFORE local identity/Unicode/content validation; non-string companyId is unidentifiable => invalid; first malformed same-tenant candidate => invalid; then 0 => not-found, >1 => ambiguous (refs sorted), 1 => resolved. */
export function resolvePromotionPolicy(
  policies: readonly unknown[],
  input: { companyId: string; subject: LearningSubject; scope: SkillScope; at: number },
): PolicyResolution {
  if (!Array.isArray(policies)) return invalid('policies must be an array');
  if (!isRecord(input)) return invalid('input must be an object');
  if (!okString(input.companyId))
    return invalid('input.companyId must be a non-empty, well-formed string');
  const subject = parseSubject(input.subject, 'input.subject');
  if (!subject.ok) return invalid(subject.reason);
  const scope = parseScope(input.scope, 'input.scope');
  if (!scope.ok) return invalid(scope.reason);
  if (!okFinite(input.at)) return invalid('input.at must be a finite number');

  const candidates: PromotionPolicy[] = [];
  for (let i = 0; i < policies.length; i += 1) {
    const raw = policies[i];
    if (!isRecord(raw)) return invalid(`policy[${i}] must be an object`);
    if (typeof raw.companyId === 'string' && raw.companyId !== input.companyId) continue;
    const parsed = parsePolicy(raw, `policy[${i}]`);
    if (!parsed.ok) return invalid(parsed.reason);
    candidates.push(parsed.value);
  }

  const applicable = candidates.filter(
    (policy) =>
      policy.active &&
      policy.scope.process === scope.value.process &&
      policy.scope.schemaVersion === scope.value.schemaVersion &&
      (policy.subject === undefined ||
        (policy.subject.skillId === subject.value.skillId &&
          policy.subject.skillVersion === subject.value.skillVersion)) &&
      policy.effectiveFrom <= input.at &&
      input.at < policy.effectiveUntil,
  );

  if (applicable.length === 0) return { kind: 'policy-not-found' };
  if (applicable.length > 1) {
    const policyRefs = [...applicable]
      .map((policy) => ({ policyId: policy.policyId, version: policy.version }))
      .sort((a, b) =>
        a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : a.version - b.version,
      );
    return { kind: 'policy-ambiguous', policyRefs };
  }
  const policy = applicable[0];
  if (!policy) return { kind: 'policy-not-found' };
  const windowStart =
    policy.observationWindowMs === undefined
      ? policy.effectiveFrom
      : Math.max(policy.effectiveFrom, input.at - policy.observationWindowMs);
  return { kind: 'resolved', policy, windowStart, windowEnd: input.at };
}

/**
 * Success-only aggregation result: canonical immutable projection of windowed
 * `work.skill-outcome` facts for one tenant+subject — UNIQUE accepted events
 * (deduped by eventId, sorted by `(occurredAt, eventId)`), no harmful
 * inference (missing is unknown, never harmful). Shape follows the existing
 * `SkillOutcomeEvidence` contract (evidenceId=eventId, workId=aggregateId).
 */
export interface PromotionEvidence {
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly positiveObservations: readonly SkillOutcomeEvidence[];
}

const AGG_INPUT_KEYS = new Set(['companyId', 'subject', 'windowStart', 'windowEnd']);
const PAYLOAD_KEYS = new Set(['version', 'activatedSkills']);
const ACTIVATED_REF_KEYS = new Set(['skillId', 'version']);
const EVENT_KEYS = new Set(
  'eventId,companyId,aggregateKind,aggregateId,eventType,occurredAt,payload,source'.split(','),
);

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

/** Structural serialization: distinguishes absent keys, present undefined, and array holes. */
const structural = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${Array.from(value, (v, i) => (i in value ? structural(v) : '<hole>')).join(',')}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${structural(value[k])}`).join(',')}}`;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
};
const factOf = (raw: Record<string, unknown>): string =>
  `${structural([raw.eventType, raw.aggregateKind, raw.aggregateId, raw.source, raw.occurredAt])}${structural(raw.payload)}`;

/**
 * Deterministic success-only aggregation of `work.skill-outcome` composite
 * facts (task 1.5): same-tenant `work.skill-outcome`/`work`/`worker` events,
 * v1 payload, full structural validity, exact subject match, counted once.
 * Foreign STRING tenant skipped BEFORE local validation; same-tenant envelope
 * must be a plain object with EXACTLY the eight BusinessEvent fields and
 * well-formed routing strings (malformed fails closed, well-formed wrong
 * routing is a decoy). Window `[windowStart, windowEnd)` (empty allowed).
 * Identity = FULL structural fact (routing, aggregateId, source, occurredAt,
 * payload; absent key ≠ undefined ≠ hole): exact replay collapses, divergent
 * reused eventId fails deterministically, order-independent. Output sorted by
 * `(occurredAt, eventId)`, deep-copied/frozen; inputs never mutated/frozen.
 * No hidden defaults.
 */
export function aggregateSkillOutcomes(
  events: readonly unknown[],
  input: { companyId: string; subject: LearningSubject; windowStart: number; windowEnd: number },
): ParseResult<PromotionEvidence> {
  if (!Array.isArray(events)) return fail('events must be an array');
  if (!isRecord(input)) return fail('input must be an object');
  const badInput = badExtra(input, AGG_INPUT_KEYS, 'input');
  if (badInput) return fail(badInput);
  if (!okString(input.companyId))
    return fail('input.companyId must be a non-empty, well-formed string');
  const subject = parseSubject(input.subject, 'input.subject');
  if (!subject.ok) return subject;
  if (!okFinite(input.windowStart)) return fail('input.windowStart must be a finite number');
  if (!okFinite(input.windowEnd)) return fail('input.windowEnd must be a finite number');
  if (input.windowStart > input.windowEnd)
    return fail('input.windowStart must not exceed input.windowEnd');

  const observations: SkillOutcomeEvidence[] = [];
  const identities = new Map<string, string>();
  for (let i = 0; i < events.length; i += 1) {
    const raw = events[i];
    if (!isRecord(raw)) return fail(`events[${i}] must be an object`);
    // Identifiable foreign string tenant: skipped BEFORE local validation.
    if (typeof raw.companyId === 'string' && raw.companyId !== input.companyId) continue;
    if (raw.companyId !== input.companyId)
      return fail(`events[${i}].companyId must equal input.companyId`);
    // Same-tenant envelope: plain object with EXACTLY the eight BusinessEvent fields.
    if (![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
      return fail(`events[${i}] must be a plain object`);
    const badEnvelope = badExtra(raw, EVENT_KEYS, `events[${i}]`);
    if (badEnvelope) return fail(badEnvelope);
    // Routing fields: well-formed strings or fail closed — well-formed wrong values are decoys.
    if (!okString(raw.eventType) || !okString(raw.aggregateKind) || !okString(raw.source))
      return fail(`events[${i}].eventType, aggregateKind, and source must be well-formed strings`);
    if (!okString(raw.eventId) || !okString(raw.aggregateId))
      return fail(`events[${i}].eventId and aggregateId must be well-formed strings`);
    if (!okFinite(raw.occurredAt)) return fail(`events[${i}].occurredAt must be a finite number`);
    if (!isRecord(raw.payload)) return fail(`events[${i}].payload must be an object`);
    // Full canonical fact: routing, aggregateId, source, occurredAt, payload.
    const fact = factOf(raw);
    const priorFact = identities.get(raw.eventId);
    if (priorFact !== undefined) {
      if (priorFact !== fact)
        return fail(`duplicate eventId "${raw.eventId}" with conflicting canonical facts`);
      continue; // exact structural replay — collapse
    }
    identities.set(raw.eventId, fact);
    // Well-formed wrong routing values are decoys.
    if (raw.eventType !== 'work.skill-outcome') continue;
    if (raw.aggregateKind !== 'work') continue;
    if (raw.source !== 'worker') continue;
    const badPayload = badExtra(raw.payload, PAYLOAD_KEYS, `events[${i}].payload`);
    if (badPayload) return fail(badPayload);
    if (raw.payload.version !== 1) return fail(`events[${i}].payload.version must be exactly 1`);
    const activated = raw.payload.activatedSkills;
    if (!Array.isArray(activated))
      return fail(`events[${i}].payload.activatedSkills must be an array`);
    let matchesSubject = false;
    for (let r = 0; r < activated.length; r += 1) {
      const ref = activated[r];
      const refPath = `events[${i}].payload.activatedSkills[${r}]`;
      if (!isRecord(ref)) return fail(`${refPath} must be an object`);
      const bad = badExtra(ref, ACTIVATED_REF_KEYS, refPath);
      if (bad) return fail(bad);
      if (!okString(ref.skillId))
        return fail(`${refPath}.skillId must be a non-empty, well-formed string`);
      if (!okInt(ref.version)) return fail(`${refPath}.version must be a positive integer`);
      if (ref.skillId === subject.value.skillId && ref.version === subject.value.skillVersion)
        matchesSubject = true;
    }
    if (!matchesSubject) continue; // same-tenant decoy: no exact subject ref
    if (raw.occurredAt < input.windowStart || raw.occurredAt >= input.windowEnd) continue;
    observations.push({
      evidenceId: raw.eventId,
      eventId: raw.eventId,
      companyId: input.companyId,
      subject: { skillId: subject.value.skillId, skillVersion: subject.value.skillVersion },
      occurredAt: raw.occurredAt,
      workId: raw.aggregateId,
    });
  }

  const positiveObservations = observations.sort(
    (a, b) =>
      a.occurredAt - b.occurredAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  );
  return {
    ok: true,
    value: deepFreeze({
      companyId: input.companyId,
      subject: { skillId: subject.value.skillId, skillVersion: subject.value.skillVersion },
      positiveObservations,
    }),
  };
}
