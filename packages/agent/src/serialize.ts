import type { HandleTable } from './handles.ts';

export class NotSerializable extends Error {
  override readonly name = 'NotSerializable';
  readonly code = 'NotSerializable' as const;
  constructor(message: string) {
    super(message);
  }
}

export interface SerializeOptions {
  handles: HandleTable;
  isUObject?: (value: unknown) => boolean;
  maxDepth?: number;
}

function isLongLike(value: object): boolean {
  const record = value as { low?: unknown; high?: unknown; unsigned?: unknown };
  const keys = Object.keys(record);
  return typeof record.low === 'number' && typeof record.high === 'number'
    && keys.every(key => key === 'low' || key === 'high' || key === 'unsigned');
}

function longToString(value: { low: number; high: number; unsigned?: boolean }): string {
  const unsigned = Boolean(value.unsigned);
  const big = (BigInt(value.high | 0) << 32n) | BigInt(value.low >>> 0);
  if (unsigned) return big.toString();
  const signed = big >= 0x8000000000000000n ? big - 0x10000000000000000n : big;
  return signed.toString();
}

function ownFunctions(value: object): boolean {
  for (const key of Object.keys(value)) {
    if (typeof (value as Record<string, unknown>)[key] === 'function') return true;
  }
  return false;
}

export function serialize(value: unknown, options: SerializeOptions, depth = 0, seen?: WeakSet<object>): unknown {
  const maxDepth = options.maxDepth ?? 32;
  if (value === null) return null;
  const type = typeof value;
  if (type === 'boolean' || type === 'string') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new NotSerializable(`non-finite number ${String(value)}`);
    return value;
  }
  if (type === 'undefined') return depth === 0 ? null : undefined;
  if (type === 'function') throw new NotSerializable('functions are not serializable');
  if (type === 'bigint') return (value as bigint).toString();
  if (type !== 'object' || value === null) throw new NotSerializable(`cannot serialize ${type}`);
  if (depth >= maxDepth) throw new NotSerializable('max depth exceeded');
  const object = value as object;

  if (object instanceof Date) return object.toISOString();
  if (object instanceof Map) {
    return Array.from(object, ([key, item]) => [
      serialize(key, options, depth + 1, seen),
      serialize(item, options, depth + 1, seen),
    ]);
  }
  if (object instanceof Set) {
    return Array.from(object, item => serialize(item, options, depth + 1, seen));
  }
  if (Array.isArray(object)) {
    return object.map(item => serialize(item, options, depth + 1, seen));
  }

  if (isLongLike(object)) return longToString(object as { low: number; high: number; unsigned?: boolean });

  let uobject = false;
  try { uobject = Boolean(options.isUObject?.(object)); }
  catch { uobject = false; }
  if (uobject || ownFunctions(object)) {
    return { $h: options.handles.retain(object) };
  }

  const seenSet = seen ?? new WeakSet<object>();
  if (seenSet.has(object)) throw new NotSerializable('cycle');
  seenSet.add(object);

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    const item = serialize((object as Record<string, unknown>)[key], options, depth + 1, seenSet);
    if (item !== undefined) output[key] = item;
  }
  return output;
}

export function defaultIsUObject(ue: { IsValid?: (value: unknown) => boolean } | undefined) {
  return (value: unknown) => {
    try {
      return typeof ue?.IsValid === 'function' && Boolean(ue.IsValid(value));
    } catch {
      return false;
    }
  };
}
