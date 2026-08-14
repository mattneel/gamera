import { describe, expect, it } from 'vitest';
import { createHandleTable } from '../src/handles.ts';
import { NotSerializable, serialize } from '../src/serialize.ts';

function dump(value: unknown, isUObject?: (value: unknown) => boolean) {
  return serialize(value, { handles: createHandleTable(), isUObject });
}

describe('serialize', () => {
  it('keeps JSON primitives', () => {
    expect(dump(null)).toBe(null);
    expect(dump(true)).toBe(true);
    expect(dump('ok')).toBe('ok');
    expect(dump(3)).toBe(3);
    expect(dump(undefined)).toBe(null);
  });

  it('rejects non-finite numbers and functions', () => {
    expect(() => dump(Number.NaN)).toThrow(NotSerializable);
    expect(() => dump(() => 1)).toThrow(NotSerializable);
  });

  it('walks Map and Set instead of retaining them', () => {
    expect(dump(new Map([['a', 1]]))).toEqual([['a', 1]]);
    expect(dump(new Set([1, 2]))).toEqual([1, 2]);
  });

  it('walks own enumerable DTO fields on prototyped rows', () => {
    function Row(this: { type: number }) { this.type = 7; }
    Row.prototype.reset = function reset() { return this; };
    const row = new (Row as unknown as { new (): { type: number } })();
    expect(dump(row)).toEqual({ type: 7 });
  });

  it('retains UObjects and objects with own functions', () => {
    const uobject = { id: 1 };
    const withFn = { restore() { return true; } };
    expect(dump(uobject, value => value === uobject)).toEqual({ $h: 1 });
    expect(dump(withFn)).toEqual({ $h: 1 });
  });

  it('try/catches isUObject', () => {
    expect(dump({ type: 1 }, () => { throw new Error('boom'); })).toEqual({ type: 1 });
  });

  it('encodes Long-like objects as decimal strings', () => {
    expect(dump({ low: 1, high: 0, unsigned: false })).toBe('1');
  });
});
