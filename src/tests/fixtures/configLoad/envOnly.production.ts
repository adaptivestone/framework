// Env-only config fixture: exists ONLY as an env-specific file, with no base
// `envOnly.ts`. Exercises the env-only load path (finding #11).
export default {
  marker: 'env-only-production-value',
  fromEnv: 42,
};
