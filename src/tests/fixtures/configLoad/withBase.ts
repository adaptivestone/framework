// Base config fixture (has both a base file and a `.production` override) — pins
// that base+env merge stays byte-identical after the env-only fix.
export default {
  a: 1,
  b: 'base',
};
