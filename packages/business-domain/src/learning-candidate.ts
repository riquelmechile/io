import type { SkillScope } from './types.js';
import type { ParseResult } from './validation/command.js';

export type { ParseResult };

/**
 * Pure learning-candidate contracts (learning promotion design: "Domain
 * contracts and semantics"; proposal A1/A3). The learning subject is ONE
 * activated Skill version — `{skillId, skillVersion}` — never an invented
 * event field. Immutable value types only, zero @io/* imports.
 */

export type LearningSubject = Readonly<{ skillId: string; skillVersion: number }>;

export type LearningCandidateState = 'candidate' | 'active' | 'needs_review' | 'superseded';

export interface SkillOutcomeEvidence {
  readonly evidenceId: string;
  readonly eventId: string;
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly occurredAt: number;
  readonly workId: string;
}

export interface TransitionEvidence {
  readonly toState: LearningCandidateState;
  readonly occurredAt: number;
  readonly reason: string;
}

export interface LearningCandidate {
  readonly companyId: string;
  readonly candidateId: string;
  readonly revision: number;
  readonly subject: LearningSubject;
  readonly scope: SkillScope;
  readonly state: LearningCandidateState;
  readonly outcomeEvidence: readonly SkillOutcomeEvidence[];
  readonly linkedOutcomeIds: readonly string[];
  readonly createdAt: number;
  readonly supersedesRevision?: number;
  readonly transition?: TransitionEvidence;
}

export interface CreateCandidateCommand {
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly scope: SkillScope;
  readonly outcomes: readonly SkillOutcomeEvidence[];
  readonly createdAt: number;
}

/**
 * Ill-formed Unicode — a lone high or low surrogate — is NOT representable as
 * UTF-8: `TextEncoder` silently replaces each lone surrogate with the SAME
 * U+FFFD replacement bytes, so two distinct lone surrogates would collapse
 * onto one id and break the collision-free contract. `candidateIdFor` therefore
 * fails fast BEFORE encoding by throwing this typed RangeError, naming the
 * offending component. Well-formed surrogate PAIRS (astral characters such as
 * emoji) are unaffected and encode normally.
 */
export class InvalidCandidateIdComponentError extends RangeError {
  readonly component: 'companyId' | 'skillId';

  constructor(component: 'companyId' | 'skillId') {
    super(`candidateIdFor: ${component} contains ill-formed Unicode (lone surrogate)`);
    this.name = 'InvalidCandidateIdComponentError';
    this.component = component;
  }
}

export function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1; // valid pair — skip its low surrogate
      } else {
        return true; // lone high surrogate
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true; // lone low surrogate
    }
  }
  return false;
}

/**
 * Deterministic candidate identity:
 *
 *   `lc:<company byte length>:<company>:<skill byte length>:<skill>:v<version>`
 *
 * Every component is length-prefixed by its canonical UTF-8 BYTE length, so
 * delimiter (`:`) collisions and segment-boundary shifts between tenant,
 * subject, and version can never collapse two distinct candidates into one id.
 * Ill-formed Unicode components (lone surrogates) throw
 * {@link InvalidCandidateIdComponentError} before encoding. Pure function —
 * reads no clock, generates no identifiers.
 */
export function candidateIdFor(companyId: string, subject: LearningSubject): string {
  if (hasLoneSurrogate(companyId)) throw new InvalidCandidateIdComponentError('companyId');
  if (hasLoneSurrogate(subject.skillId)) throw new InvalidCandidateIdComponentError('skillId');
  const companyLength = new TextEncoder().encode(companyId).length;
  const skillLength = new TextEncoder().encode(subject.skillId).length;
  return `lc:${companyLength}:${companyId}:${skillLength}:${subject.skillId}:v${subject.skillVersion}`;
}

const CREATE_COMMAND_KEYS = new Set(['companyId', 'subject', 'scope', 'outcomes', 'createdAt']);
const SUBJECT_KEYS = new Set(['skillId', 'skillVersion']);
const SCOPE_KEYS = new Set(['process', 'schemaVersion']);
const OUTCOME_KEYS = new Set([
  'evidenceId',
  'eventId',
  'companyId',
  'subject',
  'occurredAt',
  'workId',
]);

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const badExtra = (
  record: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): string | undefined => {
  const key = Object.keys(record).find((k) => !allowed.has(k));
  return key ? `${path} must not carry injected field "${key}"` : undefined;
};

const okString = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && !hasLoneSurrogate(v);
const okInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const okFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

export function createLearningCandidate(
  command: CreateCandidateCommand,
): ParseResult<LearningCandidate> {
  if (!isRecord(command)) return fail('command must be an object');
  const badCommand = badExtra(command, CREATE_COMMAND_KEYS, 'command');
  if (badCommand) return fail(badCommand);

  const companyId = command.companyId;
  if (!okString(companyId)) return fail('companyId must be a non-empty, well-formed string');

  const subject = command.subject;
  if (!isRecord(subject)) return fail('command.subject must be an object');
  const badSubject = badExtra(subject, SUBJECT_KEYS, 'command.subject');
  if (badSubject) return fail(badSubject);
  const skillId = subject.skillId;
  if (!okString(skillId))
    return fail('command.subject.skillId must be a non-empty, well-formed string');
  const skillVersion = subject.skillVersion;
  if (!okInt(skillVersion)) return fail('command.subject.skillVersion must be a positive integer');

  const scope = command.scope;
  if (!isRecord(scope)) return fail('command.scope must be an object');
  const badScope = badExtra(scope, SCOPE_KEYS, 'command.scope');
  if (badScope) return fail(badScope);
  const process = scope.process;
  if (!okString(process))
    return fail('command.scope.process must be a non-empty, well-formed string');
  const schemaVersion = scope.schemaVersion;
  if (!okInt(schemaVersion)) return fail('command.scope.schemaVersion must be a positive integer');

  const outcomes = command.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return fail('command.outcomes must be a non-empty array');
  }
  const createdAt = command.createdAt;
  if (!okFinite(createdAt)) return fail('createdAt must be a finite number');

  const evidenceIds = new Set<string>();
  const eventIds = new Set<string>();
  const copiedOutcomes: SkillOutcomeEvidence[] = [];

  for (const outcome of outcomes) {
    if (!isRecord(outcome)) return fail('each outcome must be an object');
    const badOutcome = badExtra(outcome, OUTCOME_KEYS, 'outcome');
    if (badOutcome) return fail(badOutcome);

    const evidenceId = outcome.evidenceId;
    if (!okString(evidenceId))
      return fail('outcome.evidenceId must be a non-empty, well-formed string');
    if (evidenceIds.has(evidenceId)) return fail(`duplicate evidenceId "${evidenceId}"`);
    evidenceIds.add(evidenceId);

    const eventId = outcome.eventId;
    if (!okString(eventId)) return fail('outcome.eventId must be a non-empty, well-formed string');
    if (eventIds.has(eventId)) return fail(`duplicate eventId "${eventId}"`);
    eventIds.add(eventId);

    if (outcome.companyId !== companyId) {
      return fail('outcome.companyId must equal command.companyId');
    }
    const outcomeSubject = outcome.subject;
    if (!isRecord(outcomeSubject)) return fail('outcome.subject must be an object');
    const badOutcomeSubject = badExtra(outcomeSubject, SUBJECT_KEYS, 'outcome.subject');
    if (badOutcomeSubject) return fail(badOutcomeSubject);
    const outcomeSkillId = outcomeSubject.skillId;
    if (!okString(outcomeSkillId)) return fail('skillId must be a non-empty, well-formed string');
    if (outcomeSubject.skillId !== skillId || outcomeSubject.skillVersion !== skillVersion) {
      return fail('outcome.subject must equal command.subject');
    }

    const occurredAt = outcome.occurredAt;
    if (!okFinite(occurredAt)) return fail('occurredAt must be a finite number');
    const workId = outcome.workId;
    if (!okString(workId)) return fail('outcome.workId must be a non-empty, well-formed string');

    copiedOutcomes.push({
      evidenceId,
      eventId,
      companyId,
      subject: { skillId, skillVersion },
      occurredAt,
      workId,
    });
  }

  copiedOutcomes.sort(
    (a, b) =>
      a.occurredAt - b.occurredAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  );

  const candidate: LearningCandidate = {
    companyId,
    candidateId: candidateIdFor(companyId, { skillId, skillVersion }),
    revision: 1,
    subject: { skillId, skillVersion },
    scope: { process, schemaVersion },
    state: 'candidate',
    outcomeEvidence: copiedOutcomes,
    linkedOutcomeIds: copiedOutcomes.map((outcome) => outcome.eventId),
    createdAt,
  };

  return { ok: true, value: deepFreeze(candidate) };
}
