import {
  aggregateSkillOutcomes,
  createLearningCandidate,
  evaluatePromotion,
  parseAuthorityEvidence,
  parseExplicitPromotionEvidence,
  promotionScopeFor,
  resolvePromotionPolicy,
  type LearningSubject,
  type PolicyResolution,
  type PromotionResult,
} from '@io/business-domain/src/index.js';
import type {
  BusinessEventRepository,
  PromotionAuthorityRepository,
  PromotionAuthorityResolution,
  SkillRepository,
} from '@io/business-domain/src/ports/repositories.js';

/**
 * Read-only app seam (task 2.1): activated tenant Skill → ONE applicable
 * policy → ONE event-stream read → aggregate → parse explicit+authority →
 * repository authority for the trusted actor/principal → pure evaluate.
 * Zero writes; empty tenant rejects BEFORE reads; policy failures stop
 * BEFORE the event read; malformed input is typed `unavailable`; authority
 * unavailability is typed `needs-review`, never promote. DEVIATION (Engram
 * `sdd/learning-promotion/app-seam`): design lists `deps:{events,skills}`;
 * the seam adds `authority` + `trusted` repositories resolve authority.
 */

/** Aggregate-readable failures (policy kinds reused verbatim). */
export type LearningEvaluationFailureReason =
  | 'invalid-input'
  | 'skill-not-found'
  | 'skill-not-active'
  | 'policy-not-found'
  | 'policy-invalid'
  | 'policy-ambiguous'
  | 'fact-malformed'
  | 'explicit-evidence-malformed'
  | 'no-matching-outcomes';

export type LearningEvaluationResult =
  | { readonly kind: 'evaluated'; readonly value: PromotionResult }
  | {
      readonly kind: 'unavailable';
      readonly reason: LearningEvaluationFailureReason;
      readonly detail?: string;
    };

export interface LearningEvaluationDeps {
  readonly events: BusinessEventRepository;
  readonly skills: SkillRepository;
  readonly authority: PromotionAuthorityRepository;
  /** Trusted authenticated context: expected principal + acting verifier. */
  readonly trusted: { readonly principalId: string; readonly actorId: string };
}

export interface LearningEvaluationInput {
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly policies: readonly unknown[];
  readonly explicitEvidence: unknown;
  readonly authorityEvidence: unknown;
  readonly at: number;
}

function unavailable(
  reason: LearningEvaluationFailureReason,
  detail?: string,
): LearningEvaluationResult {
  return detail === undefined
    ? { kind: 'unavailable', reason }
    : { kind: 'unavailable', reason, detail };
}

const okSkillId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const okVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

export async function evaluateLearningPromotionForCompany(
  deps: LearningEvaluationDeps,
  input: LearningEvaluationInput,
): Promise<LearningEvaluationResult> {
  if (!input.companyId) throw new Error('a non-empty companyId is required');
  if (!okSkillId(input.subject?.skillId) || !okVersion(input.subject?.skillVersion))
    return unavailable('invalid-input', 'subject must carry skillId and a positive skillVersion');
  if (typeof input.at !== 'number' || !Number.isFinite(input.at))
    return unavailable('invalid-input', 'at must be a finite number');
  const subject = { skillId: input.subject.skillId, skillVersion: input.subject.skillVersion };

  const skills = await deps.skills.listByCompany(input.companyId);
  const skill = skills.find(
    (entry) =>
      entry.companyId === input.companyId &&
      entry.skillId === subject.skillId &&
      entry.version === subject.skillVersion,
  );
  if (skill === undefined) return unavailable('skill-not-found');
  if (skill.state !== 'active') return unavailable('skill-not-active');

  const resolution = resolvePromotionPolicy(input.policies, {
    companyId: input.companyId,
    subject,
    scope: skill.scope,
    at: input.at,
  });
  if (resolution.kind !== 'resolved') return unresolvedPolicy(resolution);

  const events = await deps.events.listByCompany(input.companyId);
  const aggregated = aggregateSkillOutcomes(events, {
    companyId: input.companyId,
    subject,
    windowStart: resolution.windowStart,
    windowEnd: resolution.windowEnd,
  });
  if (!aggregated.ok) return unavailable('fact-malformed', aggregated.reason);

  const explicit = parseExplicitPromotionEvidence(input.explicitEvidence, {
    companyId: input.companyId,
    subject,
  });
  if (!explicit.ok) return unavailable('explicit-evidence-malformed', explicit.reason);

  const authority = await resolveAuthority(deps, input, subject, resolution.policy);
  const candidate = createLearningCandidate({
    companyId: input.companyId,
    subject,
    scope: skill.scope,
    outcomes: aggregated.value.positiveObservations,
    createdAt: input.at,
  });
  if (!candidate.ok) return unavailable('no-matching-outcomes', candidate.reason);
  return {
    kind: 'evaluated',
    value: evaluatePromotion(
      candidate.value,
      aggregated.value,
      explicit.value,
      resolution.policy,
      authority,
    ),
  };
}

function unresolvedPolicy(
  resolution: Exclude<PolicyResolution, { readonly kind: 'resolved' }>,
): LearningEvaluationResult {
  switch (resolution.kind) {
    case 'policy-not-found':
      return unavailable('policy-not-found');
    case 'policy-invalid':
      return unavailable('policy-invalid', resolution.reason);
    case 'policy-ambiguous':
      return unavailable(
        'policy-ambiguous',
        resolution.policyRefs.map((ref) => `${ref.policyId}@${ref.version}`).join(','),
      );
  }
}

async function resolveAuthority(
  deps: LearningEvaluationDeps,
  input: LearningEvaluationInput,
  subject: LearningSubject,
  policy: { policyId: string; version: number },
): Promise<PromotionAuthorityResolution> {
  const binding = { companyId: input.companyId, subject };
  const parsed = parseAuthorityEvidence(input.authorityEvidence, binding, 'authorityEvidence');
  if (parsed.kind !== 'parsed') return { kind: 'unavailable', reason: parsed.reason };
  return deps.authority.resolve({
    sourceRef: parsed.value.sourceRef,
    companyId: input.companyId,
    subject,
    policyRef: { policyId: policy.policyId, version: policy.version },
    at: input.at,
    expectedPrincipalId: deps.trusted.principalId,
    expectedActorId: deps.trusted.actorId,
    command: 'learning.promote',
    capability: 'learning.promote',
    scope: promotionScopeFor(input.companyId, subject),
  });
}
