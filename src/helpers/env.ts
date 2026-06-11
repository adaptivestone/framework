/**
 * Read a boolean from the environment. Env values are strings, so the common
 * `process.env.X || default` is wrong for booleans — `"false"` and `"0"` are
 * truthy strings, so they read as `true`. This coerces explicitly: only
 * `"true"`/`"1"` are `true`, any other present value is `false`, and an
 * unset/empty variable falls back to the default.
 */
export const envBool = (name: string, defaultValue: boolean): boolean => {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return v === 'true' || v === '1';
};
