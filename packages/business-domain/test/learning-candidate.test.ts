import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { candidateIdFor, InvalidCandidateIdComponentError } from '../src/index.js';
import * as learningCandidateApi from '../src/index.js';
import type {
  CreateCandidateCommand,
  LearningCandidate,
  LearningCandidateState,
  LearningSubject,
  SkillOutcomeEvidence,
  TransitionEvidence,
} from '../src/index.js';
import type { ParseResult } from '../src/validation/command.js';

/**
 * RED/GREEN domain unit tests for the pure learning-candidate contracts
 * (learning promotion design, tasks 1.1/1.2). `candidateIdFor` builds the
 * canonical length-prefixed identity `lc:<clen>:<co>:<slen>:<skill>:v<ver>`
 * where each length is the UTF-8 BYTE length of its component — deterministic
 * and collision-free across tenants, subjects, and versions. Ill-formed
 * Unicode (lone surrogates) is rejected deterministically BEFORE encoding via
 * a typed `InvalidCandidateIdComponentError` — TextEncoder would otherwise
 * collapse every distinct lone surrogate onto the same U+FFFD bytes. The type
 * block asserts the immutable contracts `LearningSubject`,
 * `LearningCandidateState`, `LearningCandidate`, `CreateCandidateCommand`,
 * `SkillOutcomeEvidence`, and `TransitionEvidence`.
 */

const subject = (skillId = 'sdlc-review', skillVersion = 3): LearningSubject => ({
  skillId,
  skillVersion,
});

/** One validated skill-outcome evidence item (task 1.3 fixtures). */
const evidence = (overrides: Partial<SkillOutcomeEvidence> = {}): SkillOutcomeEvidence => ({
  evidenceId: 'ev-1',
  eventId: 'evt:sk:att:acme:attempt-1',
  companyId: 'acme',
  subject: subject(),
  occurredAt: 1750000000000,
  workId: 'work-1',
  ...overrides,
});

/** A valid create command (task 1.3 fixtures). */
const command = (overrides: Partial<CreateCandidateCommand> = {}): CreateCandidateCommand => ({
  companyId: 'acme',
  subject: subject(),
  scope: { process: 'sdlc-review', schemaVersion: 1 },
  outcomes: [evidence()],
  createdAt: 1750000000000,
  ...overrides,
});

describe('candidateIdFor — canonical length-prefixed identity shape', () => {
  it('builds lc:<companyByteLen>:<company>:<skillByteLen>:<skill>:v<version>', () => {
    expect(candidateIdFor('acme', subject())).toBe('lc:4:acme:11:sdlc-review:v3');
  });
});

describe('candidateIdFor — deterministic', () => {
  it('same tenant/subject/version always yields the same id', () => {
    expect(candidateIdFor('acme', subject())).toBe(candidateIdFor('acme', subject()));
  });
});

describe('candidateIdFor — collision-free across tenants, subjects, versions', () => {
  it('a different tenant changes the id', () => {
    expect(candidateIdFor('acme', subject())).not.toBe(candidateIdFor('acme2', subject()));
  });

  it('a different subject changes the id', () => {
    expect(candidateIdFor('acme', subject())).not.toBe(candidateIdFor('acme', subject('sdlc')));
  });

  it('a different version changes the id', () => {
    expect(candidateIdFor('acme', subject('sdlc-review', 3))).not.toBe(
      candidateIdFor('acme', subject('sdlc-review', 4)),
    );
  });
});

describe('candidateIdFor — length prefixes disambiguate delimiter collisions', () => {
  it('segment-boundary shifts that would concatenate identically stay distinct', () => {
    const acMe = candidateIdFor('ac', { skillId: 'me', skillVersion: 1 });
    const acmE = candidateIdFor('acm', { skillId: 'e', skillVersion: 1 });
    expect(acMe).toBe('lc:2:ac:2:me:v1');
    expect(acmE).toBe('lc:3:acm:1:e:v1');
    expect(acMe).not.toBe(acmE);
  });

  it('colons inside components never collapse into the delimiters', () => {
    const abC = candidateIdFor('a:b', { skillId: 'c', skillVersion: 1 });
    const aBc = candidateIdFor('a', { skillId: 'b:c', skillVersion: 1 });
    expect(abC).toBe('lc:3:a:b:1:c:v1');
    expect(aBc).toBe('lc:1:a:3:b:c:v1');
    expect(abC).not.toBe(aBc);
  });
});

describe('candidateIdFor — canonical UTF-8 BYTE lengths for non-ASCII', () => {
  it('multi-byte company counts bytes, not code units', () => {
    expect(candidateIdFor('acme-日本', subject())).toBe('lc:11:acme-日本:11:sdlc-review:v3');
  });

  it('equal JS length but different byte length yields different ids', () => {
    expect(candidateIdFor('acme', { skillId: 'αβ', skillVersion: 1 })).toBe('lc:4:acme:4:αβ:v1');
    expect(candidateIdFor('acme', { skillId: 'ab', skillVersion: 1 })).toBe('lc:4:acme:2:ab:v1');
  });

  it('astral-plane chars are length-prefixed by their 4-byte encoding', () => {
    expect(candidateIdFor('acme', { skillId: '😀', skillVersion: 1 })).toBe('lc:4:acme:4:😀:v1');
  });
});

describe('candidateIdFor — rejects ill-formed Unicode components (lone surrogates)', () => {
  it('distinct lone high/low surrogates in companyId fail fast before encoding', () => {
    for (const lone of ['\uD800', '\uDBFF', '\uDC00', '\uDFFF']) {
      expect(() => candidateIdFor(`a${lone}`, subject())).toThrow(InvalidCandidateIdComponentError);
    }
  });

  it('distinct lone high/low surrogates in skillId fail fast before encoding', () => {
    for (const lone of ['\uD800', '\uDBFF', '\uDC00', '\uDFFF']) {
      expect(() => candidateIdFor('acme', subject(lone))).toThrow(InvalidCandidateIdComponentError);
    }
  });

  it('throws a typed RangeError that names the offending component', () => {
    const attempt = () => candidateIdFor('x\uD800', subject());
    expect(attempt).toThrow(InvalidCandidateIdComponentError);
    expect(attempt).toThrow(RangeError);
    expect(attempt).toThrow(/companyId/);
    expect(() => candidateIdFor('acme', subject('\uDC00'))).toThrow(/skillId/);
  });

  it('well-formed surrogate pairs (astral chars) still encode normally', () => {
    expect(candidateIdFor('acme😀', subject())).toBe('lc:8:acme😀:11:sdlc-review:v3');
  });
});

describe('learning-candidate domain types (task 1.2)', () => {
  it('LearningSubject requires skillId + skillVersion', () => {
    const s: LearningSubject = subject();
    expect(s).toEqual({ skillId: 'sdlc-review', skillVersion: 3 });
    expectTypeOf(s).toEqualTypeOf<LearningSubject>();
  });

  it('LearningCandidateState is exactly the four memory states', () => {
    const states: readonly LearningCandidateState[] = [
      'candidate',
      'active',
      'needs_review',
      'superseded',
    ];
    expect(states).toHaveLength(4);
    expect(states).toContain('candidate');
    expect(states).toContain('superseded');
  });

  it('LearningCandidate binds identity, subject, scope, evidence, and lineage', () => {
    const evidence: SkillOutcomeEvidence = {
      evidenceId: 'ev-1',
      eventId: 'evt:sk:att:acme:attempt-1',
      companyId: 'acme',
      subject: subject(),
      occurredAt: 1750000000000,
      workId: 'work-1',
    };
    const transition: TransitionEvidence = {
      toState: 'active',
      occurredAt: 1750000100000,
      reason: 'promote',
    };
    const candidate: LearningCandidate = {
      companyId: 'acme',
      candidateId: candidateIdFor('acme', subject()),
      revision: 1,
      subject: subject(),
      scope: { process: 'sdlc-review', schemaVersion: 1 },
      state: 'candidate',
      outcomeEvidence: [evidence],
      linkedOutcomeIds: ['evt:sk:att:acme:attempt-1'],
      createdAt: 1750000000000,
    };
    expect(candidate.candidateId).toBe('lc:4:acme:11:sdlc-review:v3');
    expect(candidate.state).toBe('candidate');
    expect(candidate.outcomeEvidence).toEqual([evidence]);
    expect(candidate.transition).toBeUndefined();
    expect(transition.toState).toBe('active');
  });

  it('CreateCandidateCommand carries the caller-supplied creation inputs', () => {
    const command: CreateCandidateCommand = {
      companyId: 'acme',
      subject: subject(),
      scope: { process: 'sdlc-review', schemaVersion: 1 },
      outcomes: [
        {
          evidenceId: 'ev-1',
          eventId: 'evt:sk:att:acme:attempt-1',
          companyId: 'acme',
          subject: subject(),
          occurredAt: 1750000000000,
          workId: 'work-1',
        },
      ],
      createdAt: 1750000000000,
    };
    expect(command.outcomes).toHaveLength(1);
    expect(command.createdAt).toBe(1750000000000);
  });
});

describe('learning-candidate.ts — pure dependency surface (zero @io/*)', () => {
  it('imports only LOCAL modules and never any @io/* package', () => {
    const source = readFileSync(new URL('../src/learning-candidate.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
    expect(imported.every((path) => path.startsWith('./'))).toBe(true);
    expect(imported).not.toContain('@io/');
    expect(source).not.toMatch(/import\s+[^;]*@io\//);
  });
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

const corrupt = (patch: Record<string, unknown>): CreateCandidateCommand =>
  ({ ...command(), ...patch }) as unknown as CreateCandidateCommand;

const two = (patch: Partial<SkillOutcomeEvidence>): CreateCandidateCommand =>
  command({ outcomes: [evidence(), evidence({ evidenceId: 'ev-2', eventId: 'evt-2', ...patch })] });
const o = (patch: Record<string, unknown>): CreateCandidateCommand =>
  corrupt({ outcomes: [{ ...evidence(), ...patch }] });

const rejects = (cmd: CreateCandidateCommand, needle: string): void => {
  const result = learningCandidateApi.createLearningCandidate(cmd);
  expect(result.ok).toBe(false);
  if (result.ok === false) expect(result.reason).toContain(needle);
};

describe('createLearningCandidate — canonical creation (task 1.3)', () => {
  it('builds the candidate root: state candidate, revision 1, no parent, caller createdAt', () => {
    const result = learningCandidateApi.createLearningCandidate(command());
    expect(result).toEqual({
      ok: true,
      value: {
        companyId: 'acme',
        candidateId: candidateIdFor('acme', subject()),
        revision: 1,
        subject: subject(),
        scope: { process: 'sdlc-review', schemaVersion: 1 },
        state: 'candidate',
        outcomeEvidence: [evidence()],
        linkedOutcomeIds: ['evt:sk:att:acme:attempt-1'],
        createdAt: 1750000000000,
      },
    });
    expectTypeOf(result).toEqualTypeOf<ParseResult<LearningCandidate>>();
  });

  it('canonically sorts by (occurredAt, eventId) and derives unique linkedOutcomeIds', () => {
    const result = learningCandidateApi.createLearningCandidate(
      command({
        outcomes: [
          evidence({ evidenceId: 'ev-3', eventId: 'evt-3', occurredAt: 3000 }),
          evidence({ evidenceId: 'ev-1', eventId: 'evt-1', occurredAt: 1000 }),
          evidence({ evidenceId: 'ev-2', eventId: 'evt-2a', occurredAt: 2000 }),
          evidence({ evidenceId: 'ev-2b', eventId: 'evt-2', occurredAt: 2000 }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcomeEvidence.map((o) => o.evidenceId)).toEqual([
        'ev-1',
        'ev-2b',
        'ev-2',
        'ev-3',
      ]);
      expect(result.value.linkedOutcomeIds).toEqual(['evt-1', 'evt-2', 'evt-2a', 'evt-3']);
    }
  });

  it('deep-copies every nested object — caller input stays unfrozen/mutable, output frozen & independent', () => {
    const input = command({
      outcomes: [
        evidence(),
        evidence({ evidenceId: 'ev-2', eventId: 'evt:sk:att:acme:attempt-2' }),
      ],
    });
    const result = learningCandidateApi.createLearningCandidate(input);
    expect(result.ok).toBe(true);
    const raw = input as unknown as {
      companyId: string;
      subject: { skillId: string };
      scope: { process: string };
      outcomes: Array<{ occurredAt: number; subject: { skillId: string } }>;
    };
    const firstOutcome = raw.outcomes[0];
    if (!firstOutcome) throw new Error('test setup: outcomes[0] is required');
    for (const obj of [input.subject, input.scope, firstOutcome, firstOutcome.subject]) {
      expect(Object.isFrozen(obj)).toBe(false); // input unfrozen + mutable after creation
    }
    raw.companyId = 'evil';
    raw.subject.skillId = 'hacked';
    raw.scope.process = 'hacked';
    firstOutcome.occurredAt = 999999;
    firstOutcome.subject.skillId = 'hacked';

    if (result.ok) {
      expect(result.value.companyId).toBe('acme');
      expect(result.value.subject).toEqual(subject());
      expect(result.value.scope).toEqual({ process: 'sdlc-review', schemaVersion: 1 });
      expect(result.value.outcomeEvidence.map((o) => o.evidenceId)).toEqual(['ev-1', 'ev-2']);
      expect(result.value.outcomeEvidence[0]?.occurredAt).toBe(1750000000000);
      expect(result.value.outcomeEvidence[0]?.subject).toEqual(subject());
      expect(result.value.outcomeEvidence[0]).not.toBe(input.outcomes[0]);
      for (const frozen of [
        result.value,
        result.value.subject,
        result.value.scope,
        result.value.outcomeEvidence,
        result.value.outcomeEvidence[0]?.subject,
        result.value.linkedOutcomeIds,
      ]) {
        expect(Object.isFrozen(frozen)).toBe(true);
      }
    }
  });
});
describe('createLearningCandidate — rejects invalid input with a typed result (task 1.3)', () => {
  it('rejects malformed, misbound, extra-key, and ill-formed input everywhere', () => {
    const cases: Array<[CreateCandidateCommand, string]> = [
      [null as unknown as CreateCandidateCommand, 'command must be an object'],
      [undefined as unknown as CreateCandidateCommand, 'command must be an object'],
      ['cmd' as unknown as CreateCandidateCommand, 'command must be an object'],
      [42 as unknown as CreateCandidateCommand, 'command must be an object'],
      [['acme'] as unknown as CreateCandidateCommand, 'command must be an object'],
      [corrupt({ companyId: 42 }), 'companyId'],
      [corrupt({ companyId: '' }), 'companyId'],
      [corrupt({ companyId: 'ac\uD800me' }), 'companyId'],
      [corrupt({ subject: { skillId: '', skillVersion: 3 } }), 'skillId'],
      [corrupt({ subject: { skillId: 'sd\uD800l', skillVersion: 3 } }), 'skillId'],
      [corrupt({ subject: { skillId: 'x', skillVersion: 0 } }), 'skillVersion'],
      [corrupt({ subject: { skillId: 'x', skillVersion: 1.5 } }), 'skillVersion'],
      [corrupt({ scope: undefined }), 'scope'],
      [corrupt({ scope: { process: '', schemaVersion: 1 } }), 'process'],
      [corrupt({ scope: { process: 'sd\uD800l', schemaVersion: 1 } }), 'process'],
      [corrupt({ scope: { process: 'x', schemaVersion: 0 } }), 'schemaVersion'],
      [corrupt({ outcomes: [] }), 'outcomes'],
      [corrupt({ createdAt: NaN }), 'createdAt'],
      [o({ occurredAt: NaN }), 'occurredAt'],
      [o({ evidenceId: '' }), 'evidenceId'],
      [o({ evidenceId: 'ev\uD800' }), 'evidenceId'],
      [o({ eventId: 'ev\uD800' }), 'eventId'],
      [o({ workId: 'wo\uD800' }), 'workId'],
      [o({ subject: { skillId: 'sd\uD800l', skillVersion: 3 } }), 'skillId'],
      [corrupt({ subject: { skillId: 'x', skillVersion: 1, extra: 1 } }), 'injected'],
      [corrupt({ scope: { process: 'x', schemaVersion: 1, extra: 1 } }), 'injected'],
      [o({ extra: 1 }), 'injected'],
      [o({ subject: { skillId: 'x', skillVersion: 1, extra: 1 } }), 'injected'],
      [two({ companyId: 'other' }), 'companyId'],
      [two({ subject: { skillId: 'other', skillVersion: 3 } }), 'subject'],
      [two({ subject: { skillId: 'sdlc-review', skillVersion: 9 } }), 'subject'],
      [command({ outcomes: [evidence(), evidence({ eventId: 'evt-2' })] }), 'evidenceId'],
      [command({ outcomes: [evidence(), evidence({ evidenceId: 'ev-2' })] }), 'eventId'],
      [corrupt({ candidateId: 'x' }), 'candidateId'],
      [corrupt({ state: 'x' }), 'state'],
      [corrupt({ revision: 1 }), 'revision'],
      [corrupt({ supersedesRevision: 1 }), 'supersedesRevision'],
      [corrupt({ transition: {} }), 'transition'],
      [corrupt({ parent: 'x' }), 'parent'],
      [corrupt({ parentRevision: 1 }), 'parentRevision'],
      [corrupt({ supersedes: 'x' }), 'supersedes'],
      [corrupt({ linkedOutcomeIds: [] }), 'linkedOutcomeIds'],
      [corrupt({ outcomeEvidence: [] }), 'outcomeEvidence'],
    ];
    for (const [cmd, needle] of cases) rejects(cmd, needle);
  });

  it('handles deeply frozen commands without mutating them (valid accepted, invalid rejected)', () => {
    expect(learningCandidateApi.createLearningCandidate(deepFreeze(command())).ok).toBe(true);
    const frozenInvalid = deepFreeze(
      command({ outcomes: [evidence(), evidence({ eventId: 'evt-2' })] }),
    );
    expect(() => learningCandidateApi.createLearningCandidate(frozenInvalid)).not.toThrow();
    rejects(frozenInvalid, 'evidenceId');
  });
});
