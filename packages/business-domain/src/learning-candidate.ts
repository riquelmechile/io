import type { SkillScope } from './types.js';

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

function hasLoneSurrogate(value: string): boolean {
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
