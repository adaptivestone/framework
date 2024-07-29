import { describe, it, expect } from 'vitest';
import IpDetector from './IpDetector.js';

const testVectors = [
  // IPv4 CIDR blocks
  {
    cidr: '192.168.0.0/16',
    tests: [
      { ip: '192.168.1.1', matches: true },
      { ip: '192.169.1.1', matches: false },
    ],
  },
  {
    cidr: '10.0.0.0/8',
    tests: [
      { ip: '10.0.0.1', matches: true },
      { ip: '11.0.0.1', matches: false },
    ],
  },
  {
    cidr: '172.16.0.0/12',
    tests: [
      { ip: '172.16.0.1', matches: true },
      { ip: '172.32.0.1', matches: false },
    ],
  },

  // // IPv6 CIDR blocks
  {
    cidr: '2001:db8::/32',
    tests: [
      { ip: '2001:db8::1', matches: true },
      { ip: '2001:db9::1', matches: false },
    ],
  },
  {
    cidr: 'fe80::/10',
    tests: [
      { ip: 'fe80::1', matches: true },
      { ip: 'fec0::1', matches: false },
    ],
  },
  {
    cidr: '::ffff:0:0/96',
    tests: [
      { ip: '::ffff:192.0.2.1', matches: true },
      { ip: '2001:db8::1', matches: false },
    ],
  },

  // // Specific IPv4 addresses
  {
    cidr: '203.0.113.1/32',
    tests: [
      { ip: '203.0.113.1', matches: true },
      { ip: '203.0.113.2', matches: false },
    ],
  },

  // // Specific IPv6 addresses
  {
    cidr: '2001:db8:85a3::8a2e:370:7334/128',
    tests: [
      { ip: '2001:db8:85a3::8a2e:370:7334', matches: true },
      { ip: '2001:db8:85a3::8a2e:370:7335', matches: false },
    ],
  },

  // // Mixed scenarios
  {
    cidr: '::ffff:192.0.2.0/120',
    tests: [
      { ip: '::ffff:192.0.2.1', matches: true },
      { ip: '192.0.2.1', matches: true }, // IPv4-mapped addresses should match their IPv4 equivalents
      { ip: '::ffff:192.0.3.1', matches: false },
    ],
  },

  // // Edge cases
  {
    cidr: '0.0.0.0/0',
    tests: [
      { ip: '0.0.0.0', matches: true },
      { ip: '255.255.255.255', matches: true },
      { ip: '2001:db8::1', matches: false }, // Matches any IPv4 but not IPv6
    ],
  },
  {
    cidr: '::/0',
    tests: [
      { ip: '::1', matches: true },
      { ip: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', matches: true },
      { ip: '192.168.1.1', matches: true },
    ],
  },
  {
    cidr: '8.8.8.8-8.8.8.10', // our feature range
    tests: [
      { ip: '8.8.8.7', matches: false },
      { ip: '8.8.8.8', matches: true },
      { ip: '8.8.8.9', matches: true },
      { ip: '8.8.8.10', matches: true },
      { ip: '8.8.8.11', matches: false },
    ],
  },
  {
    cidr: '1.1.1.1', // one ip
    tests: [
      { ip: '8.8.8.7', matches: false },
      { ip: '1.1.1.1', matches: true },
    ],
  },
];

describe('ipDetector methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);
    const middleware = new IpDetector(global.server.app);
    expect(middleware.constructor.description).toBeDefined();
  });

  it('middleware that works', async () => {
    expect.hasAssertions();
    const nextFunction = () => {};
    for (const vector of testVectors) {
      global.server.app.updateConfig('ipDetector', {
        trustedProxy: [vector.cidr],
      });
      const middleware = new IpDetector(global.server.app);
      for (const test of vector.tests) {
        const req = {
          appInfo: {},
          headers: { 'x-forwarded-for': 'notAnIP' },
          socket: { remoteAddress: test.ip },
        };
        // eslint-disable-next-line no-await-in-loop
        await middleware.middleware(req, {}, nextFunction);
        const result = req.appInfo.ip === 'notAnIP';
        expect(result).toBe(test.matches);
      }
    }
  });
});
