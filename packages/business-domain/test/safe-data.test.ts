import { describe, expect, it } from 'vitest';

import { readClosedDataRecord, readDenseDataArray } from '../src/validation/safe-data.js';

const ALLOWED = new Set(['companyId', 'subject', 'value']);
const record = (raw: unknown) => readClosedDataRecord(raw, 'ev', ALLOWED);
const array = (raw: unknown) => readDenseDataArray(raw, 'ev');

describe('readClosedDataRecord — plain and null-prototype records', () => {
  it('accepts a plain object whose own enumerable data fields are all allowed', () => {
    expect(record({ companyId: 'acme', subject: 's1' })).toEqual({
      ok: true,
      value: { companyId: 'acme', subject: 's1' },
    });
  });
  it('accepts a null-prototype record with allowed own data fields', () => {
    expect(record(Object.assign(Object.create(null), { value: 7 }))).toEqual({
      ok: true,
      value: { value: 7 },
    });
  });
  it('rejects non-objects and arrays', () => {
    for (const raw of [null, 42, 'x', true, [1, 2]]) expect(record(raw).ok).toBe(false);
  });
});

describe('readClosedDataRecord — injected keys, inherited fields, getters, adversarial descriptors', () => {
  it('rejects injected keys outside the allowed set', () => {
    expect(record({ companyId: 'acme', extra: 1 })).toEqual({
      ok: false,
      reason: expect.stringContaining('extra'),
    });
  });
  it('rejects a record with a custom prototype (inherited fields never satisfy the contract)', () => {
    const raw = Object.assign(Object.create({ companyId: 'acme' }), { subject: 's1' });
    expect(record(raw).ok).toBe(false);
  });
  it('rejects an own accessor field WITHOUT executing its getter', () => {
    let executed = false;
    const raw = { companyId: 'acme' };
    Object.defineProperty(raw, 'subject', {
      enumerable: true,
      get: () => {
        executed = true;
        return 's1';
      },
    });
    expect(record(raw).ok).toBe(false);
    expect(executed).toBe(false);
  });
  it('rejects hidden (non-enumerable) own fields', () => {
    const raw = { companyId: 'acme' };
    Object.defineProperty(raw, 'subject', { value: 's1', enumerable: false });
    expect(record(raw).ok).toBe(false);
  });
  it('rejects symbol-keyed own fields', () => {
    const raw = { companyId: 'acme' };
    Object.defineProperty(raw, Symbol('s'), { value: 1, enumerable: true });
    expect(record(raw).ok).toBe(false);
  });
});

describe('readDenseDataArray — canonical dense arrays', () => {
  it('accepts a dense array with plain Array.prototype and exact canonical index descriptors', () => {
    expect(array([1, 'two', null])).toEqual({ ok: true, value: [1, 'two', null] });
  });
  it('accepts an empty dense array', () => {
    expect(array([])).toEqual({ ok: true, value: [] });
  });
  it('rejects holes (missing canonical index descriptors)', () => {
    const holey: unknown[] = [];
    holey.length = 3;
    expect(array(holey).ok).toBe(false);
  });
  it('rejects extra own keys, symbols, accessor-index descriptors, and custom prototypes', () => {
    const extra = Object.assign([1], { extra: 2 });
    expect(array(extra).ok).toBe(false);
    const sym: unknown[] = [1];
    Object.defineProperty(sym, Symbol('s'), { value: 1, enumerable: true });
    expect(array(sym).ok).toBe(false);
    const acc: unknown[] = [];
    Object.defineProperty(acc, 0, { enumerable: true, get: () => 1 });
    expect(array(acc).ok).toBe(false);
    const custom = Object.assign([1], {});
    Object.setPrototypeOf(custom, {});
    expect(array(custom).ok).toBe(false);
  });
  it('rejects non-array objects', () => {
    expect(array({ 0: 1, length: 1 }).ok).toBe(false);
    expect(array(null).ok).toBe(false);
  });
});

describe('revoked proxies — failure, never throw', () => {
  it('readClosedDataRecord returns a failure for a revoked record proxy, never throws', () => {
    const { proxy, revoke } = Proxy.revocable({ companyId: 'acme' }, {});
    revoke();
    expect(record(proxy)).toEqual({
      ok: false,
      reason: 'ev is not a safe plain data structure',
    });
  });
  it('readDenseDataArray returns a failure for a revoked array proxy, never throws', () => {
    const { proxy, revoke } = Proxy.revocable([1], {});
    revoke();
    expect(array(proxy)).toEqual({
      ok: false,
      reason: 'ev is not a safe plain data structure',
    });
  });
});

describe('output independence — fresh containers, input untouched', () => {
  it('returns a fresh record: mutating the output does not touch the input', () => {
    const raw = { companyId: 'acme' };
    const result = record(raw);
    if (!result.ok) throw new Error('expected ok');
    result.value.injected = true;
    expect(raw).toEqual({ companyId: 'acme' });
  });
  it('returns a fresh array: mutating the output does not touch the input', () => {
    const raw = [1, 2];
    const result = array(raw);
    if (!result.ok) throw new Error('expected ok');
    result.value.push(3);
    expect(raw).toEqual([1, 2]);
  });
  it('never freezes or mutates the input', () => {
    const raw = { companyId: 'acme' };
    record(raw);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(raw).toEqual({ companyId: 'acme' });
  });
});
