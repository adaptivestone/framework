/**
 * `true` for a plain `{}` object: its prototype is `Object.prototype` or
 * `null`. Arrays, class instances, Dates, Errors and Maps are not plain.
 */
export function isPlainObject(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
