import { describe, expect, it } from 'vitest';

import {
  cloneAndFreezeSafeData,
  readClosedDataRecord,
  readDenseDataArray,
} from '../src/validation/safe-data.js';

const ALLOWED = new Set(['companyId', 'subject', 'value']);
const record = (raw: unknown) => readClosedDataRecord(raw, 'ev', ALLOWED);
const array = (raw: unknown) => readDenseDataArray(raw, 'ev');
const clone = (raw: unknown, path = 'ev') => cloneAndFreezeSafeData(raw, path);
const rejects = (raws: readonly unknown[]) => {
  for (const raw of raws) expect(clone(raw).ok).toBe(false);
};
type Sample = { a: { b: { c: number } }; list: Array<{ c: number }> };

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

describe('cloneAndFreezeSafeData — scalars and nested structures', () => {
  it('accepts JSON-like scalars (finite number, string, boolean, null)', () => {
    for (const scalar of [0, -2.5, 1e3, 's', true, false, null]) {
      expect(clone(scalar)).toEqual({ ok: true, value: scalar });
    }
  });
  it('deep-clones nested records and dense arrays', () => {
    const raw = { a: { b: [1, { c: null }], d: [], e: {} } };
    expect(clone(raw)).toEqual({ ok: true, value: raw });
  });
  it('accepts null-prototype records recursively', () => {
    const raw = { value: Object.assign(Object.create(null), { n: [1, { x: null }] }) };
    expect(clone(raw)).toEqual({ ok: true, value: raw });
  });
});

describe('cloneAndFreezeSafeData — fresh references, deep freeze, mutation isolation', () => {
  it('returns fresh, deeply frozen containers', () => {
    const raw = { a: { b: { c: 1 } }, list: [{ c: 2 }] };
    const result = cloneAndFreezeSafeData(raw, 'ev');
    if (!result.ok) throw new Error('expected ok');
    const out = result.value as Sample;
    const [first] = out.list;
    if (!first) throw new Error('test setup: list[0] is required');
    for (const node of [out, out.a, out.a.b, out.list, first])
      expect(Object.isFrozen(node)).toBe(true);
    expect(out).not.toBe(raw);
    expect(out.a).not.toBe(raw.a);
    expect(out.list).not.toBe(raw.list);
  });
  it('isolation: caller stays mutable, output frozen and independent', () => {
    const raw = { a: { b: { c: 1 } }, list: [{ c: 2 }] };
    const result = cloneAndFreezeSafeData(raw, 'ev');
    if (!result.ok) throw new Error('expected ok');
    const out = result.value as Sample;
    raw.a.b.c = 99;
    raw.list.push({ c: 3 });
    expect(out.a.b.c).toBe(1);
    expect(out.list).toHaveLength(1);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(raw).toEqual({ a: { b: { c: 99 } }, list: [{ c: 2 }, { c: 3 }] });
  });
});

describe('cloneAndFreezeSafeData — accessors are rejected without execution', () => {
  it('rejects record field and array index getters without executing them', () => {
    let executed = 0;
    const getter = () => {
      executed += 1;
      return 'boom';
    };
    const raw: Record<string, unknown> = { safe: 1 };
    Object.defineProperty(raw, 'trap', { enumerable: true, get: getter });
    expect(clone(raw).ok).toBe(false);
    const arr: unknown[] = [1];
    Object.defineProperty(arr, 1, { enumerable: true, get: getter });
    expect(clone(arr).ok).toBe(false);
    expect(executed).toBe(0);
  });
});

describe('cloneAndFreezeSafeData — adversarial and unsupported values', () => {
  it('rejects unsupported scalars: undefined, non-finite numbers, symbol, function, bigint', () => {
    rejects([undefined, NaN, Infinity, -Infinity, Symbol('s'), () => 1, 42n]);
  });
  it('rejects custom prototypes, hidden/symbol fields, holes, and extra array keys', () => {
    const hidden: Record<string, unknown> = {};
    Object.defineProperty(hidden, 'x', { value: 1, enumerable: false });
    const sym: Record<string, unknown> = {};
    Object.defineProperty(sym, Symbol('k'), { value: 1, enumerable: true });
    const holey: unknown[] = [];
    holey.length = 2;
    const extra: unknown[] = [1];
    Object.assign(extra, { extra: 2 });
    rejects([new Date(0), hidden, sym, holey, extra]);
  });
  it('rejects revoked record and array proxies without throwing', () => {
    const reason = 'ev is not a safe plain data structure';
    const rec = Proxy.revocable({ a: 1 }, {});
    rec.revoke();
    expect(clone(rec.proxy)).toEqual({ ok: false, reason });
    const arr = Proxy.revocable([1], {});
    arr.revoke();
    expect(clone(arr.proxy)).toEqual({ ok: false, reason });
  });
  it('rejects cycles in records and arrays', () => {
    const rec: Record<string, unknown> = {};
    rec.self = rec;
    expect(clone(rec).ok).toBe(false);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(clone(arr).ok).toBe(false);
  });
});

describe('readClosedDataRecord — special keys (__proto__, constructor, prototype)', () => {
  const special = (raw: unknown) =>
    readClosedDataRecord(raw, 'ev', new Set(['__proto__', 'constructor', 'prototype']));
  it('keeps own special data fields as own data with a safe null-prototype output', () => {
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, '__proto__', {
      value: { marker: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(raw, 'constructor', {
      value: 'ctor',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(raw, 'prototype', {
      value: 'proto',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const result = special(raw);
    if (!result.ok) throw new Error('expected ok');
    expect(Object.getPrototypeOf(result.value)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(result.value, '__proto__')).toMatchObject({
      value: { marker: true },
      enumerable: true,
    });
    expect(result.value.constructor).toBe('ctor');
    expect(result.value.prototype).toBe('proto');
    expect(result.value.toString).toBeUndefined();
    expect(result.value.marker).toBeUndefined();
  });
});

describe('cloneAndFreezeSafeData — concrete ReadonlySafeData return type', () => {
  it('returns the concrete ReadonlySafeData union — callers cannot select an arbitrary shape', () => {
    // @ts-expect-error — no caller-selected generic T: callers narrow after validation
    cloneAndFreezeSafeData<{ nope: string }>({ nope: 'x' }, 'ev');
    const result = cloneAndFreezeSafeData({ nested: [{ ok: true }] }, 'ev');
    if (!result.ok) throw new Error('expected ok');
    expect(Object.isFrozen(result.value)).toBe(true);
  });
  it('clone: keeps top-level __proto__/constructor/prototype own data with a safe prototype', () => {
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, '__proto__', {
      value: { marker: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(raw, 'constructor', {
      value: 'ctor',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(raw, 'prototype', {
      value: 'proto',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const result = clone(raw);
    if (!result.ok) throw new Error('expected ok');
    const out = result.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')).toMatchObject({
      value: { marker: true },
      enumerable: true,
    });
    expect(out.constructor).toBe('ctor');
    expect(out.prototype).toBe('proto');
    expect(out.marker).toBeUndefined();
  });
  it('clone: preserves nested special keys and keeps nested output prototypes safe', () => {
    const inner: Record<string, unknown> = {};
    Object.defineProperty(inner, '__proto__', {
      value: { x: 1 },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const raw = { nested: inner };
    const result = clone(raw);
    if (!result.ok) throw new Error('expected ok');
    const nested = (result.value as { nested: Record<string, unknown> }).nested;
    expect(Object.getPrototypeOf(nested)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(nested, '__proto__')).toMatchObject({
      value: { x: 1 },
      enumerable: true,
    });
    expect(nested.x).toBeUndefined();
  });
});
