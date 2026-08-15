import { describe, expect, it } from 'vitest';
import {
  InvalidCandidateIdComponentError,
  parsePromotionScope,
  promotionScopeFor,
  type PromotionScopeValue,
} from '../src/index.js';

const mustOk = (scope: string): PromotionScopeValue => {
  const r = parsePromotionScope(scope);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const rejects = (scope: unknown) => expect(parsePromotionScope(scope).ok).toBe(false);
const rejectGroup = (scopes: string) =>
  scopes.split(' ').forEach((scope) => {
    rejects(scope);
  });
const scopeFor = (companyId: string, skillId: string, skillVersion: number): string =>
  promotionScopeFor(companyId, { skillId, skillVersion });
const BAD_SCOPES =
  'promote:4:acme:2:s1:v3 xlearning.promote:4:acme:2:s1:v3 learning.promote:\uD800:4:acme learning.promote:04:acme:2:s1:v3 learning.promote:0:acme:2:s1:v3 learning.promote:5:acme:2:s1:v3 learning.promote:4:acm:2:s1:v3 learning.promote:4:acme:3:s1:v3 learning.promote:4:acme:2:s1x:v3 learning.promote:2:😀:1:s:v1 learning.promote:4:acme learning.promote:4:acme:2:s1 learning.promote:4:acme:2:s1:v0 learning.promote:4:acme:2:s1:v-1 learning.promote:4:acme:2:s1:v3.5 learning.promote:4:acme:2:s1:v03 learning.promote:4:acme:2:s1:v3e2 learning.promote:4:acme:2:s1:v3x learning.promote:4:acme:2:s1:v3:extra';

describe('promotion scope', () => {
  it('emits canonical UTF-8 byte-prefixed scopes for ASCII, non-ASCII, astral, and colon identities', () => {
    expect(scopeFor('acme', 's1', 3)).toBe('learning.promote:4:acme:2:s1:v3');
    expect(scopeFor('café', 's1', 3)).toBe('learning.promote:5:café:2:s1:v3');
    expect(scopeFor('😀', 's', 1)).toBe('learning.promote:4:😀:1:s:v1');
    expect(scopeFor('a:b', 'x:y', 7)).toBe('learning.promote:3:a:b:3:x:y:v7');
  });
  it('throws InvalidCandidateIdComponentError on ill-formed Unicode', () => {
    expect(() => scopeFor('a\uD800', 's', 1)).toThrow(InvalidCandidateIdComponentError);
    expect(() => scopeFor('a', '\uDC00s', 1)).toThrow(InvalidCandidateIdComponentError);
  });
  it('round-trips canonical scopes into companyId and subject', () => {
    const P1 = { companyId: 'acme', subject: { skillId: 's1', skillVersion: 3 } };
    const P2 = { companyId: 'café', subject: { skillId: 's1', skillVersion: 3 } };
    const P3 = { companyId: '😀', subject: { skillId: 's', skillVersion: 1 } };
    const P4 = { companyId: 'a:b', subject: { skillId: 'x:y', skillVersion: 7 } };
    expect(mustOk('learning.promote:4:acme:2:s1:v3')).toEqual(P1);
    expect(mustOk('learning.promote:5:café:2:s1:v3')).toEqual(P2);
    expect(mustOk('learning.promote:4:😀:1:s:v1')).toEqual(P3);
    expect(mustOk('learning.promote:3:a:b:3:x:y:v7')).toEqual(P4);
  });
  it('rejects non-string, empty, ill-formed Unicode, wrong-prefix, non-canonical count, truncated, mid-code-point, and non-positive version scopes', () => {
    for (const scope of [undefined, null, 42, '', 'learning.promote:']) rejects(scope);
    rejectGroup(BAD_SCOPES);
  });
  it('requires byte-for-byte canonical re-encoding: lossy or unsafe versions fail', () => {
    rejects('learning.promote:4:acme:2:s1:v99999999999999999999');
  });
  it('freeze: parsed output and nested subject are frozen', () => {
    expect(Object.isFrozen(mustOk('learning.promote:4:acme:2:s1:v3'))).toBe(true);
    expect(Object.isFrozen(mustOk('learning.promote:4:acme:2:s1:v3').subject)).toBe(true);
  });
});
