import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  parseAuthorityEvidence,
  type AuthorityEvidence,
  type AuthorityEvidenceParse,
  type AuthorityUnavailableReason,
} from '../src/index.js';

const BINDING = { companyId: 'acme', subject: { skillId: 'sk', skillVersion: 3 } } as const;
const SUBJ = { skillId: 'sk', skillVersion: 3 };
const GOLD = { companyId: 'acme', subject: SUBJ, sourceRef: 'proof-1' };
const parse = (raw: unknown) => parseAuthorityEvidence(raw, BINDING, 'authority');
const parsed = (raw: unknown): AuthorityEvidence => {
  const r = parse(raw);
  if (r.kind !== 'parsed') throw new Error(`expected parsed, got ${r.reason}`);
  return r.value;
};
const unavailable = (raw: unknown, reason: AuthorityUnavailableReason) =>
  expect(parse(raw)).toEqual({ kind: 'unavailable', reason });
const withSubject = (subject: unknown) => ({ companyId: 'acme', subject, sourceRef: 'p' });
const malformed = (raw: unknown) => unavailable(raw, 'authority-malformed');

describe('parseAuthorityEvidence', () => {
  it('gold: closed envelope matching the trusted binding parses to the exact shape', () => {
    expect(parsed(GOLD)).toEqual(GOLD);
    expectTypeOf(parse).returns.toEqualTypeOf<AuthorityEvidenceParse>();
  });
  it.each([undefined, null])('missing: absent envelope input maps to authority-missing', (raw) => {
    unavailable(raw, 'authority-missing');
  });
  it('malformed: non-objects, injected keys, missing keys, ill-formed values map to authority-malformed', () => {
    for (const raw of ['x', 42, true, [GOLD], {}]) malformed(raw);
    for (const raw of [{ companyId: 'acme' }, { companyId: 'acme', subject: SUBJ }]) malformed(raw);
    malformed({ companyId: '', subject: SUBJ, sourceRef: 'p' });
    malformed({ companyId: 'acme', subject: SUBJ, sourceRef: '' });
    malformed({ companyId: 'acme', subject: SUBJ, sourceRef: 7 });
    malformed({ ...GOLD, extra: 1 });
    malformed({ ...GOLD, companyId: undefined });
    malformed(withSubject({ skillId: '', skillVersion: 3 }));
    malformed(withSubject({ skillId: 'sk', skillVersion: 0 }));
    malformed(withSubject({ skillId: 'sk', skillVersion: 1.5 }));
    malformed(withSubject({ skillId: 'sk', skillVersion: '3' }));
    malformed(withSubject({ skillId: 'sk' }));
    malformed(withSubject({ skillId: 's\uD800', skillVersion: 3 }));
    malformed(withSubject('sk'));
  });
  it('foreign: well-formed envelope with a differing identity maps to authority-foreign', () => {
    unavailable({ ...GOLD, companyId: 'other' }, 'authority-foreign');
    unavailable({ ...GOLD, subject: { skillId: 'x', skillVersion: 3 } }, 'authority-foreign');
    unavailable({ ...GOLD, subject: { skillId: 'sk', skillVersion: 9 } }, 'authority-foreign');
  });
  it('descriptor-safe: getters never execute; symbols, custom prototypes, revoked proxies are malformed', () => {
    const spy = { n: 0 };
    const accessor: Record<string, unknown> = { ...GOLD };
    const spyGet = () => spy.n++;
    Object.defineProperty(accessor, 'sourceRef', { enumerable: true, get: spyGet });
    malformed(accessor);
    expect(spy.n).toBe(0);
    const sym = { ...GOLD, [Symbol('s')]: 1 };
    malformed(sym);
    const proto = Object.create({ sourceRef: 'p' });
    Object.assign(proto, { companyId: 'acme', subject: SUBJ });
    malformed(proto);
    const revoked = Proxy.revocable(GOLD, {});
    revoked.revoke();
    malformed(revoked.proxy);
  });
  it('freeze: parsed value and nested subject are frozen; caller input stays mutable', () => {
    const input = { ...GOLD };
    const out = parsed(input);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.subject)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.subject)).toBe(false);
  });
  it('repeat: parsing the same input twice yields equal fresh parsed values', () => {
    const a = parsed(GOLD);
    expect(a).toEqual(parsed(GOLD));
    expect(a).not.toBe(parsed(GOLD));
  });
});
