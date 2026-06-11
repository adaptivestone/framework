import type { IncomingMessage } from 'node:http';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import IpDetector from './IpDetector.ts';

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
    // const middleware = new IpDetector(appInstance);
    expect(IpDetector.description).toBeDefined();
  });

  it('middleware that works', async () => {
    expect.hasAssertions();

    const nextFunction = () => {};
    for (const vector of testVectors) {
      appInstance.updateConfig('ipDetector', {
        trustedProxy: [vector.cidr],
      });
      const middleware = new IpDetector(appInstance);
      for (const test of vector.tests) {
        const req = {
          appInfo: {
            ip: undefined,
          },
          // A valid but untrusted client IP. When the socket peer is trusted
          // the walk returns this header value; otherwise the header is
          // ignored and the socket address wins. (The old test used a non-IP
          // sentinel, which the right-to-left walk now correctly rejects.)
          headers: { 'x-forwarded-for': '203.0.113.7' },
          socket: { remoteAddress: test.ip },
        };
        await middleware.middleware(
          req as unknown as FrameworkRequest,
          {} as Response,
          nextFunction,
        );

        expect(req.appInfo.ip).toBe(test.matches ? '203.0.113.7' : test.ip);
      }
    }
  });
});

// X-Forwarded-For trusted-hop walk (doc 04). Standard proxies APPEND the real
// client, so the framework must walk the chain right-to-left and skip trusted
// hops, NOT trust the spoofable left-most entry.
describe('getIpAdressFromIncomingMessage trusted-hop walk', () => {
  const makeReq = (remoteAddress: string, xff?: string) =>
    ({
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      socket: { remoteAddress },
    }) as unknown as IncomingMessage;

  // 127.0.0.1 = trusted socket peer; 10.0.0.0/8 = a trusted inner hop;
  // 203.0.113.x / 1.2.3.4 = untrusted (public) clients.
  const detector = () => {
    appInstance.updateConfig('ipDetector', {
      headers: ['X-Forwarded-For'],
      trustedProxy: ['127.0.0.1/8', '10.0.0.0/8'],
    });
    return new IpDetector(appInstance);
  };

  it('returns the right-most untrusted hop, not the spoofable left-most', () => {
    expect.assertions(1);
    // Client spoofs `1.2.3.4`; the proxy appends the real `203.0.113.7`.
    const ip = detector().getIpAdressFromIncomingMessage(
      makeReq('127.0.0.1', '1.2.3.4, 203.0.113.7'),
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('skips trailing trusted-proxy hops to find the client', () => {
    expect.assertions(1);
    const ip = detector().getIpAdressFromIncomingMessage(
      makeReq('127.0.0.1', '203.0.113.7, 10.0.0.5'),
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('ignores the header when the socket peer is not trusted', () => {
    expect.assertions(1);
    const ip = detector().getIpAdressFromIncomingMessage(
      makeReq('203.0.113.9', '1.2.3.4'),
    );
    expect(ip).toBe('203.0.113.9');
  });

  it('falls back to the left-most when the whole chain is trusted', () => {
    expect.assertions(1);
    const ip = detector().getIpAdressFromIncomingMessage(
      makeReq('127.0.0.1', '10.1.1.1, 10.0.0.5'),
    );
    expect(ip).toBe('10.1.1.1');
  });

  it('does not return a garbage entry to the left of the real client', () => {
    expect.assertions(2);
    const ip = detector().getIpAdressFromIncomingMessage(
      makeReq('127.0.0.1', 'evil, 203.0.113.7'),
    );
    expect(ip).toBe('203.0.113.7');
    expect(ip).not.toBe('evil');
  });
});
