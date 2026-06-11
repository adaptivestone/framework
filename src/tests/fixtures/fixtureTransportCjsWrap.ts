import FixtureTransport from './fixtureTransport.ts';

// Simulates a CJS-interop double-wrap (`{ default: { default: Class } }`): the
// module's default export is itself an object whose `.default` is the
// constructor. Pins the "unwrap the inner default before validating" path.
export default { default: FixtureTransport };
