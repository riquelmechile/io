import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  parseExplicitPromotionEvidence,
  type ExplicitObservation,
  type ExplicitPromotionEvidence,
} from '../src/index.js';
import type { LearningSubject, ParseResult } from '../src/index.js';

const BINDING = { companyId: 'acme', subject: { skillId: 'sk', skillVersion: 3 } } as const;
const SUBJ = { skillId: 'sk', skillVersion: 3 };
const obs = (evidenceId: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  ...{ evidenceId, companyId: 'acme', subject: SUBJ, sourceRef: 's1', observedAt: 100 },
  ...extra,
  value,
});
const CONF = obs('e1', 0.9);
const SA = obs('sa1', 'registry');
const RATE = obs('r1', { positive: true, harmful: false });
const CONFLICT = obs('c1', { unresolved: true, description: 'd1' });
const VETO = obs('v1', { triggered: true, description: 'd1' });
const GOLD = {
  confidence: CONF,
  sourceAuthority: SA,
  rateObservations: [RATE],
  conflicts: [CONFLICT],
  catastrophicVetoes: [VETO],
};
const parse = (raw: unknown) => parseExplicitPromotionEvidence(raw, BINDING);
const mustOk = <T>(r: ParseResult<T>): T => {
  if (!r.ok) throw new Error('expected ok');
  return r.value;
};
const rejects = (raw: unknown) => expect(parse(raw).ok).toBe(false);
const reason = (raw: unknown, fragment: string) =>
  expect(parse(raw)).toEqual({ ok: false, reason: expect.stringContaining(fragment) });
describe('parseExplicitPromotionEvidence', () => {
  it('gold: a complete five-category envelope parses to the exact shape', () => {
    const out = mustOk(parse(GOLD));
    expect(out).toEqual(GOLD);
    expect(out.confidence?.value).toBe(0.9);
    expect(out.conflicts[0]?.value.description).toBe('d1');
  });
  it('minimal: only required conflicts/catastrophicVetoes; absent optionals omitted', () => {
    const minimal = { conflicts: [], catastrophicVetoes: [] };
    const out = mustOk(parse(minimal));
    expect(out).toEqual(minimal);
    expect('confidence' in out).toBe(false);
    expect('sourceAuthority' in out).toBe(false);
    expect('rateObservations' in out).toBe(false);
  });
  it('types: recursively readonly value and exact envelope shape', () => {
    const out = mustOk(parse(GOLD));
    expectTypeOf(out).toMatchTypeOf<ExplicitPromotionEvidence>();
    expectTypeOf<ExplicitObservation<number>>().toEqualTypeOf<{
      readonly evidenceId: string;
      readonly companyId: string;
      readonly subject: LearningSubject;
      readonly sourceRef: string;
      readonly observedAt: number;
      readonly value: number;
    }>();
    const rate = out.rateObservations?.[0];
    if (!rate) throw new Error('expected rate observation');
    const mutate = () => {
      // @ts-expect-error — value is recursively readonly (ReadonlyDeep<T>)
      rate.value.harmful = true;
    };
    void mutate;
  });
  it('top closed: rejects injected fields and adversarial envelopes without throwing', () => {
    rejects({ ...GOLD, extra: 1 });
    rejects(null);
    rejects([GOLD]);
    rejects({ conflicts: [], catastrophicVetoes: [], confidence: 'x' });
    const spy = { n: 0 };
    const accessor: Record<string, unknown> = { conflicts: [], catastrophicVetoes: [] };
    Object.defineProperty(accessor, 'confidence', {
      enumerable: true,
      get: () => {
        spy.n += 1;
        return CONF;
      },
    });
    rejects(accessor);
    expect(spy.n).toBe(0);
    const sym: Record<string, unknown> = { ...GOLD };
    Object.defineProperty(sym, Symbol('s'), { value: 1, enumerable: true });
    rejects(sym);
    rejects(
      Object.assign(Object.create({ confidence: CONF }), { conflicts: [], catastrophicVetoes: [] }),
    );
    const revoked = Proxy.revocable(GOLD, {});
    revoked.revoke();
    rejects(revoked.proxy);
  });
  it('required optional: required missing fails; present-undefined optionals are malformed', () => {
    rejects({ catastrophicVetoes: [] });
    rejects({ conflicts: [] });
    rejects({});
    rejects({ ...GOLD, confidence: undefined });
    rejects({ ...GOLD, sourceAuthority: undefined });
    rejects({ ...GOLD, rateObservations: undefined });
  });
  it('global duplicates: evidenceIds are unique across all categories', () => {
    rejects({ ...GOLD, conflicts: [obs('e1', { unresolved: true, description: 'd' })] });
    rejects({ ...GOLD, catastrophicVetoes: [obs('sa1', { triggered: true, description: 'd' })] });
    rejects({ ...GOLD, rateObservations: [obs('r1', RATE.value), obs('e1', RATE.value)] });
    rejects({ conflicts: [CONFLICT, CONFLICT], catastrophicVetoes: [] });
  });
  it('foreign single omitted; foreign list items skipped; malformed never omitted', () => {
    expect(
      'confidence' in mustOk(parse({ ...GOLD, confidence: { ...CONF, companyId: 'other' } })),
    ).toBe(false);
    expect(
      'sourceAuthority' in
        mustOk(
          parse({
            ...GOLD,
            sourceAuthority: { ...SA, subject: { skillId: 'x', skillVersion: 3 } },
          }),
        ),
    ).toBe(false);
    const out = mustOk(
      parse({
        ...GOLD,
        conflicts: [CONFLICT, { ...CONFLICT, evidenceId: 'c2', companyId: 'other' }],
      }),
    );
    expect(out.conflicts).toHaveLength(1);
    const onlyForeign = mustOk(
      parse({ conflicts: [{ ...CONFLICT, companyId: 'other' }], catastrophicVetoes: [] }),
    );
    expect(onlyForeign.conflicts).toHaveLength(0);
    rejects({ ...GOLD, confidence: { ...CONF, companyId: '' } });
    rejects({ ...GOLD, confidence: { ...CONF, subject: { skillId: '', skillVersion: 3 } } });
  });
  it('order: each category list is canonically sorted by (observedAt, evidenceId)', () => {
    const out = mustOk(
      parse({
        ...GOLD,
        rateObservations: [
          obs('rb', RATE.value, { observedAt: 200 }),
          obs('ra', RATE.value, { observedAt: 100 }),
        ],
        conflicts: [
          obs('cb', CONFLICT.value, { observedAt: 100 }),
          obs('ca', CONFLICT.value, { observedAt: 100 }),
          obs('cc', CONFLICT.value, { observedAt: 50 }),
        ],
      }),
    );
    expect(out.rateObservations?.map((o) => o.evidenceId)).toEqual(['ra', 'rb']);
    expect(out.conflicts.map((o) => o.evidenceId)).toEqual(['cc', 'ca', 'cb']);
  });
  it('repeat: parsing the same input twice yields equal fresh outputs', () => {
    const a = mustOk(parse(GOLD));
    const b = mustOk(parse(GOLD));
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.conflicts).not.toBe(b.conflicts);
  });
  it('freeze: output deeply frozen at every level; caller input stays mutable', () => {
    const input = { ...GOLD };
    const out = mustOk(parse(input));
    for (const node of [out, out.conflicts, out.catastrophicVetoes])
      expect(Object.isFrozen(node)).toBe(true);
    if (out.confidence) expect(Object.isFrozen(out.confidence)).toBe(true);
    if (out.rateObservations) expect(Object.isFrozen(out.rateObservations)).toBe(true);
    for (const obsNode of out.conflicts) {
      expect(Object.isFrozen(obsNode)).toBe(true);
      expect(Object.isFrozen(obsNode.value)).toBe(true);
      expect(Object.isFrozen(obsNode.subject)).toBe(true);
    }
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.confidence)).toBe(false);
    expect(Object.isFrozen(input.conflicts[0])).toBe(false);
  });
  it('revoked: revoked proxies anywhere fail stable, never throw', () => {
    const revokedSubject = () => {
      const p = Proxy.revocable({ skillId: 'sk', skillVersion: 3 }, {});
      p.revoke();
      return p.proxy;
    };
    rejects({ ...GOLD, confidence: { ...CONF, subject: revokedSubject() } });
    rejects({ ...GOLD, conflicts: [{ ...CONFLICT, subject: revokedSubject() }] });
    rejects({ ...GOLD, rateObservations: [{ ...RATE, value: revokedSubject() }] });
  });
  it('category malformed: category errors propagate with their envelope path', () => {
    reason({ ...GOLD, confidence: { ...CONF, value: 1.5 } }, 'envelope.confidence');
    rejects({ ...GOLD, sourceAuthority: { ...SA, value: '' } });
    rejects({ ...GOLD, rateObservations: [obs('r2', { positive: 1, harmful: false })] });
    rejects({ ...GOLD, conflicts: [obs('c2', { unresolved: 'x', description: 'd' })] });
    rejects({ ...GOLD, catastrophicVetoes: [obs('v2', { triggered: 1, description: 'd' })] });
  });
});
