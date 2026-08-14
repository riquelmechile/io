import { describe, expect, it } from 'vitest';
import {
  parseBoundPromotionObservation,
  parseBoundPromotionObservationList,
  parseConfidenceValue,
  parseConflictValue,
  parsePromotionEvidenceBinding,
  parseRateValue,
  parseSourceAuthorityValue,
  parseVetoValue,
} from '../src/validation/promotion-observation.js';
import type { ParseResult } from '../src/validation/command.js';
import type { ObservationValueParser } from '../src/validation/promotion-observation.js';

const BINDING = { companyId: 'acme', subject: { skillId: 'sk', skillVersion: 3 } } as const;
const OBS = {
  evidenceId: 'e1',
  companyId: 'acme',
  subject: { skillId: 'sk', skillVersion: 3 },
  sourceRef: 's1',
  observedAt: 100,
  value: 0.9,
};
const RATE = { positive: true, harmful: false };
type MutableRate = { positive: boolean; harmful: boolean };
const FOREIGN_SUBJECT = { skillId: 'other', skillVersion: 3 };
const revokedSubject = () => {
  const p = Proxy.revocable({ skillId: 'sk', skillVersion: 3 }, {});
  p.revoke();
  return p.proxy;
};
const MALFORMED_SUBJECTS: unknown[] = [
  {},
  { skillId: 5, skillVersion: 3 },
  { skillId: 'sk', skillVersion: '3' },
  { skillId: 'sk\uD800', skillVersion: 3 },
  { skillId: 'sk', skillVersion: 0 },
];
const MALFORMED_COMPANIES: unknown[] = ['', 'ac\uD800me', 5];
const binding = (raw: unknown) => parsePromotionEvidenceBinding(raw, 'b');
const sng = (r: unknown) => parseBoundPromotionObservation(r, BINDING, parseConfidenceValue, 'o');
const lst = (raw: unknown) => parseBoundPromotionObservationList(raw, BINDING, parseRateValue, 'l');
const rejectsReason = (raw: unknown, fragment: string) =>
  expect(sng(raw)).toEqual({ ok: false, reason: expect.stringContaining(fragment) });
const item = (e: string, t: number) => ({ ...OBS, evidenceId: e, observedAt: t, value: RATE });
const mustOk = <T>(r: ParseResult<T>): T => {
  if (!r.ok) throw new Error('expected ok');
  return r.value;
};
describe('parsePromotionEvidenceBinding', () => {
  it('accepts a closed companyId+subject record frozen; rejects injected/adversarial/malformed', () => {
    expect(binding(BINDING)).toEqual({ ok: true, value: BINDING });
    expect(Object.isFrozen(mustOk(binding(BINDING)))).toBe(true);
    const rejects = (raw: unknown) => expect(binding(raw).ok).toBe(false);
    rejects({ ...BINDING, extra: 1 });
    rejects(null);
    rejects([BINDING]);
    rejects(Object.assign(Object.create({ companyId: 'acme' }), { subject: BINDING.subject }));
    const accessor: Record<string, unknown> = { subject: BINDING.subject };
    Object.defineProperty(accessor, 'companyId', { enumerable: true, get: () => 'acme' });
    rejects(accessor);
    const sym: Record<string, unknown> = { ...BINDING };
    Object.defineProperty(sym, Symbol('s'), { value: 1, enumerable: true });
    rejects(sym);
    rejects({ ...BINDING, companyId: '' });
    rejects({ ...BINDING, companyId: 'ac\uD800me' });
    rejects({ ...BINDING, companyId: 5 });
    rejects({ ...BINDING, subject: { skillId: '', skillVersion: 3 } });
    rejects({ ...BINDING, subject: { skillId: 'sk', skillVersion: 0 } });
    rejects({ ...BINDING, subject: { skillId: 'sk', skillVersion: 2.5 } });
    rejects({ ...BINDING, subject: { skillId: 'sk' } });
  });
});

describe('category value parsers', () => {
  it('scalar and record values: valid accepted frozen; invalid rejected', () => {
    for (const ok of [0, 0.5, 1])
      expect(parseConfidenceValue(ok, 'v')).toEqual({ ok: true, value: ok });
    for (const bad of [NaN, Infinity, -0.1, 1.5, '0.5', null])
      expect(parseConfidenceValue(bad, 'v').ok).toBe(false);
    expect(parseSourceAuthorityValue('registry', 'v')).toEqual({ ok: true, value: 'registry' });
    for (const bad of ['', 'a\uD800b', 5, null])
      expect(parseSourceAuthorityValue(bad, 'v').ok).toBe(false);
    expect(parseRateValue(RATE, 'v')).toEqual({ ok: true, value: RATE });
    expect(mustOk(parseConflictValue({ unresolved: true, description: 'd' }, 'v'))).toEqual({
      unresolved: true,
      description: 'd',
    });
    const veto = mustOk(parseVetoValue({ triggered: false, description: 'd2' }, 'v'));
    expect(veto).toEqual({ triggered: false, description: 'd2' });
    expect(Object.isFrozen(veto)).toBe(true);
    const shapes: unknown[] = [
      null,
      [true, false],
      {},
      { positive: 1 },
      { positive: true, harmful: 'x' },
      { positive: true },
      { harmful: false },
      { positive: true, harmful: false, extra: 1 },
      { positive: true, harmful: false, description: 'd' },
    ];
    for (const shape of shapes) {
      expect(parseRateValue(shape, 'v').ok).toBe(false);
      expect(parseConflictValue(shape, 'v').ok).toBe(false);
      expect(parseVetoValue(shape, 'v').ok).toBe(false);
    }
  });
});

describe('parseBoundPromotionObservation', () => {
  it('accepts a well-formed observation frozen; foreign/malformed/adversarial fail safely', () => {
    const frozen = mustOk(sng(OBS));
    expect(frozen).toEqual(OBS);
    for (const node of [frozen, frozen.subject]) expect(Object.isFrozen(node)).toBe(true);
    rejectsReason({ ...OBS, companyId: 'other' }, 'companyId must equal the binding companyId');
    rejectsReason({ ...OBS, subject: FOREIGN_SUBJECT }, 'subject must equal the binding subject');
    const rejects = (raw: unknown) => expect(sng(raw).ok).toBe(false);
    rejects({ ...OBS, evidenceId: '' });
    rejects({ ...OBS, evidenceId: 'e\uD8001' });
    rejects({ ...OBS, sourceRef: '' });
    rejects({ ...OBS, observedAt: NaN });
    rejects({ ...OBS, value: 1.5 });
    rejects({ ...OBS, extra: 1 });
    rejects(null);
    // Malformed identities fail as malformed — never treated as foreign.
    for (const subject of MALFORMED_SUBJECTS) rejects({ ...OBS, subject });
    for (const companyId of MALFORMED_COMPANIES) rejects({ ...OBS, companyId });
    // Descriptor-safe probes only: nested subject getters never execute.
    const spy = { n: 0 };
    const sg = () => {
      spy.n += 1;
      return 'sk';
    };
    const subjectWithGetter: Record<string, unknown> = {};
    Object.defineProperty(subjectWithGetter, 'skillId', { enumerable: true, get: sg });
    rejects({ ...OBS, subject: subjectWithGetter });
    expect(spy.n).toBe(0);
    // A revoked nested subject proxy fails stable — never throws.
    rejects({ ...OBS, subject: revokedSubject() });
    const sym: Record<string, unknown> = { ...OBS, value: 0.5 };
    Object.defineProperty(sym, Symbol('s'), { value: 1, enumerable: true });
    rejects(sym);
    const boom = (): never => {
      throw new Error('boom');
    };
    expect(parseBoundPromotionObservation(OBS, BINDING, boom, 'o')).toEqual({
      ok: false,
      reason: expect.stringContaining('could not be parsed'),
    });
    const v = { ...RATE };
    const rr = parseBoundPromotionObservation({ ...OBS, value: v }, BINDING, parseRateValue, 'o');
    expect(rr).toEqual({ ok: true, value: { ...OBS, value: RATE } });
    const rrValue = mustOk(rr).value;
    expect(rrValue).not.toBe(v);
    expect(Object.isFrozen(rrValue)).toBe(true);
    v.harmful = true;
    expect(rrValue).toEqual(RATE);
    const parseMutable: ObservationValueParser<MutableRate> = () => ({ ok: true, value: RATE });
    const mr = parseBoundPromotionObservation({ ...OBS, value: RATE }, BINDING, parseMutable, 'o');
    const mutate = () => {
      if (!mr.ok) throw new Error('expected ok');
      // @ts-expect-error — value is recursively readonly (ReadonlyDeep<T>)
      mr.value.value.harmful = true;
    };
    void mutate;
  });
});

describe('parseBoundPromotionObservationList', () => {
  it('accepts, sorts canonically, skips foreign, and rejects duplicates/malformed', () => {
    const sorted = mustOk(lst([item('b', 200), item('a', 100), item('c', 100)]));
    expect(sorted).toEqual([item('a', 100), item('c', 100), item('b', 200)]);
    expect(Object.isFrozen(sorted)).toBe(true);
    const skipped = lst([
      item('a', 100),
      { ...item('foreign', 200), companyId: 'other', value: { not: 'a rate' } },
      item('b', 200),
    ]);
    expect(skipped).toEqual({ ok: true, value: [item('a', 100), item('b', 200)] });
    expect(lst([item('a', 100), item('a', 200)])).toEqual({
      ok: false,
      reason: expect.stringContaining('must be unique'),
    });
    expect(lst([{ ...item('x', 100), value: { not: 'a rate' } }, item('a', 100)]).ok).toBe(false);
    // A revoked nested subject proxy fails stable in the list too — never throws.
    expect(lst([{ ...item('a', 100), subject: revokedSubject() }]).ok).toBe(false);
    // Malformed identities fail the list — never silently skipped as foreign.
    for (const subject of MALFORMED_SUBJECTS)
      expect(lst([{ ...item('a', 100), subject }]).ok).toBe(false);
    for (const companyId of MALFORMED_COMPANIES)
      expect(lst([{ ...item('a', 100), companyId }]).ok).toBe(false);
    expect(mustOk(lst([]))).toEqual([]);
    const holey: unknown[] = [];
    holey.length = 2;
    for (const bad of [null, {}, item('a', 100), holey]) expect(lst(bad).ok).toBe(false);
    const input = [item('a', 100)];
    expect(mustOk(lst(input))).toEqual(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input[0])).toBe(false);
  });
});
