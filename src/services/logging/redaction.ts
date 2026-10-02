import winston from 'winston';
import { isPlainObject } from '../../helpers/objects.ts';

/** What a redacted value is replaced with. */
export const REDACTED = '[REDACTED]';

/**
 * Copy of `value` with the values of `keys` (lower-case) replaced at any
 * depth, matching keys case-insensitively. Only plain objects and arrays are
 * walked; anything else (Errors, Dates, class instances, strings) is returned
 * as is. Never mutates `value`.
 */
export function redactValue(
  value: unknown,
  keys: ReadonlySet<string>,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return value;
  }
  const known = seen.get(value);
  if (known) {
    return known;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(redactValue(item, keys, seen));
    }
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    copy[key] = keys.has(key.toLowerCase())
      ? REDACTED
      : redactValue(item, keys, seen);
  }
  return copy;
}

/**
 * Winston format that redacts a log entry's fields before any transport sees
 * them. The message text is never rewritten: put sensitive values in fields.
 */
export const createRedactFormat = (keys: readonly string[]) => {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  return winston.format((info) => {
    for (const key of Object.keys(info)) {
      if (key === 'level' || key === 'message') {
        continue;
      }
      info[key] = keySet.has(key.toLowerCase())
        ? REDACTED
        : redactValue(info[key], keySet);
    }
    return info;
  })();
};
