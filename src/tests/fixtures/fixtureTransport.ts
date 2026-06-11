import fs from 'node:fs';
import TransportStream from 'winston-transport';

// A minimal winston transport for doc-13's spawn test. It writes a marker on
// construction so the test can prove the transport was actually instantiated
// and added — the inverted-logic bug rejected valid transports and never
// constructed them.
export default class FixtureTransport extends TransportStream {
  constructor(opts?: ConstructorParameters<typeof TransportStream>[0]) {
    super(opts);
    fs.writeSync(1, 'FIXTURE_TRANSPORT_LOADED\n');
  }

  log(_info: unknown, callback: () => void) {
    callback();
  }
}
