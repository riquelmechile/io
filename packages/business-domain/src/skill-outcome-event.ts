import type { BusinessEvent } from './types.js';

/**
 * Intent-captured Skill identity (skill delta: Intent-Captured Skill Usage
 * Outcomes). Captured ONCE at intent from the compiler's segment-7 selection
 * and NEVER re-derived at finalize — version drift never leaks into the fact.
 */
export type ActivatedSkillRef = Readonly<{ skillId: string; version: number }>;

/**
 * Versioned payload of the composite `work.skill-outcome` event. `version: 1`
 * is the only payload schema; `activatedSkills` carries the FULL intent-time
 * selection, including an EMPTY one (a verified close with no activated Skills
 * still records one composite fact).
 */
export type SkillOutcomePayload = Readonly<{
  version: 1;
  activatedSkills: readonly ActivatedSkillRef[];
}>;

/**
 * Terminal-close facts the deterministic builder consumes. `occurredAt` is a
 * caller-supplied close timestamp (never read from a clock) and stays EXCLUDED
 * from identity; `attemptId` follows the worker grammar
 * `att:{companyId}:{idempotencyKey}` so the eventId is retry-stable.
 */
export type SkillOutcomeEventInput = Readonly<{
  companyId: string;
  workId: string;
  attemptId: string;
  occurredAt: number;
  activatedSkills: readonly ActivatedSkillRef[];
}>;

/**
 * Deterministic skill-outcome event (business-event delta: Pure Deterministic
 * BusinessEvent, Idempotent Single Emission). Builds ONE composite
 * `work.skill-outcome` BusinessEvent per verified terminal close — the
 * worker-owned counterpart of {@link buildWorkAcceptedEvent}. The eventId is
 * SOLELY `attemptId`:
 *
 *   `evt:sk:${attemptId}` = `evt:sk:att:{companyId}:{idempotencyKey}`
 *
 * so a controlled retry rebuilds the SAME id and a duplicate append is
 * rejected by `uq_business_event_event_id` — at most one fact per attempt.
 * `occurredAt` is the ONLY clock-derived field and never enters identity; all
 * other fields derive deterministically from the terminal-close facts:
 * `aggregateId` is exactly the closed `workId`, and the versioned payload
 * preserves the intent-captured `activatedSkills` selection (empty included).
 * Prefix `evt:sk:` stays disjoint from `evt:hb:` (supervisor), `evt:att:`
 * (worker attempt), and `evt:acc:` (acceptor) namespaces; `source:'worker'`
 * marks exclusive ownership. Pure function — zero `@io/*` imports.
 */
export function buildSkillOutcomeEvent(input: SkillOutcomeEventInput): BusinessEvent {
  const { companyId, workId, attemptId, occurredAt, activatedSkills } = input;
  return {
    eventId: `evt:sk:${attemptId}`, // SOLELY attemptId — occurredAt excluded
    companyId,
    aggregateKind: 'work',
    aggregateId: workId, // the closed Work identity
    eventType: 'work.skill-outcome',
    occurredAt, // caller-supplied close timestamp; EXCLUDED from identity
    payload: { version: 1, activatedSkills },
    source: 'worker',
  };
}
