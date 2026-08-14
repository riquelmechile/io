import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { candidateIdFor, InvalidCandidateIdComponentError } from '../src/index.js';
import type {
  CreateCandidateCommand,
  LearningCandidate,
  LearningCandidateState,
  LearningSubject,
  SkillOutcomeEvidence,
  TransitionEvidence,
} from '../src/index.js';

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
  it('imports only the local types module and never any @io/* package', () => {
    const source = readFileSync(new URL('../src/learning-candidate.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imported).toEqual(['./types.js']);
    expect(source).not.toMatch(/import\s+[^;]*@io\//);
  });
});
