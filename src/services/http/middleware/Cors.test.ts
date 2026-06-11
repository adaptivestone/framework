import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import Transport from 'winston-transport';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import Cors from './Cors.ts';

// Captures app log entries so a test can assert the boot-time CORS warning.
class CaptureTransport extends Transport {
  sink: string[];
  constructor(sink: string[]) {
    super({ level: 'silly' });
    this.sink = sink;
  }
  log(info: unknown, callback: () => void) {
    this.sink.push(JSON.stringify(info));
    callback();
  }
}

describe('cors middleware methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new Cors(appInstance, { origins: ['something'] });

    expect(Cors.description).toBeDefined();
  });

  it('should throw without origns', async () => {
    expect.assertions(1);
    // @ts-expect-error we not pass options
    expect(() => new Cors(appInstance)).toThrow();
  });

  it('should throw with empty options', async () => {
    expect.assertions(1);
    // @ts-expect-error we are passong wrong option
    expect(() => new Cors(appInstance, {})).toThrow();
  });

  it('should throw with empty origins', async () => {
    expect.assertions(1);
    expect(() => new Cors(appInstance, { origins: [] })).toThrow();
  });

  it('should throw with empty origins not array', async () => {
    expect.assertions(1);
    // @ts-expect-error we passing not an Array
    expect(() => new Cors(appInstance, { origins: 'origins' })).toThrow();
  });

  it('non options should be different', async () => {
    expect.assertions(2);

    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const map = new Map();
    const req = {
      method: 'GET',

      headers: { origin: 'https://localhost' },
    };
    const res = {
      set: (key, val) => {
        map.set(key, val);
      },
    };
    const middleware = new Cors(appInstance, {
      origins: ['https://localhost'],
    });

    await middleware.middleware(
      req as FrameworkRequest,
      res as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(map.get('Vary')).toBe('Origin');
  });

  it('host the not match origin', async () => {
    expect.assertions(1);

    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      method: 'OPTIONS',
      headers: { origin: 'http://anotherDomain.com' },
    };
    const middleware = new Cors(appInstance, {
      origins: ['https://localhost'],
    });

    await middleware.middleware(
      req as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
  });

  it('string domain match', async () => {
    expect.assertions(5);

    let isEndCalled = false;
    const map = new Map();
    const req = {
      method: 'OPTIONS',
      headers: {
        origin: 'https://localhost',
        'access-control-request-headers': 'someAccessControlRequestHeaders',
      },
    };
    const res = {
      set: (key, val) => {
        map.set(key, val);
      },
      status: () => {},
      end: () => {
        isEndCalled = true;
      },
    };
    const middleware = new Cors(appInstance, {
      origins: ['https://localhost'],
    });

    await middleware.middleware(
      req as FrameworkRequest,
      res as unknown as Response,
      () => {},
    );

    expect(isEndCalled).toBeTruthy();
    expect(map.get('Vary')).toBe('Origin, Access-Control-Request-Headers');
    expect(map.get('Access-Control-Allow-Headers')).toBe(
      'someAccessControlRequestHeaders',
    );
    expect(map.get('Access-Control-Allow-Origin')).toBe('https://localhost');
    expect(map.get('Access-Control-Allow-Methods')).toBe(
      'GET,HEAD,PUT,PATCH,POST,DELETE',
    );
  });

  it('regexp domain match', async () => {
    expect.assertions(5);

    let isEndCalled = false;
    const map = new Map();
    const req = {
      method: 'OPTIONS',
      headers: {
        origin: 'https://localhost',
        'access-control-request-headers': 'someAccessControlRequestHeaders',
      },
      appInfo: {
        app: {},
      },
    };
    const res = {
      set: (key, val) => {
        map.set(key, val);
      },
      status: () => {},

      end: () => {
        isEndCalled = true;
      },
    };
    const middleware = new Cors(appInstance, {
      origins: [/./],
    });

    await middleware.middleware(
      req as FrameworkRequest,
      res as unknown as Response,
      () => {},
    );

    expect(isEndCalled).toBeTruthy();
    expect(map.get('Vary')).toBe('Origin, Access-Control-Request-Headers');
    expect(map.get('Access-Control-Allow-Headers')).toBe(
      'someAccessControlRequestHeaders',
    );
    expect(map.get('Access-Control-Allow-Origin')).toBe('https://localhost');
    expect(map.get('Access-Control-Allow-Methods')).toBe(
      'GET,HEAD,PUT,PATCH,POST,DELETE',
    );
  });

  it('an unanchored regex matches unintended origins; an anchored one does not (doc 21)', async () => {
    expect.assertions(2);

    const reflect = async (origins: (string | RegExp)[], origin: string) => {
      const map = new Map();
      await new Cors(appInstance, { origins }).middleware(
        { method: 'GET', headers: { origin } } as FrameworkRequest,
        { set: (k: string, v: string) => map.set(k, v) } as unknown as Response,
        () => {},
      );
      return map.get('Access-Control-Allow-Origin');
    };

    // Footgun: `/example\.com/` (unanchored) reflects an attacker origin.
    expect(await reflect([/example\.com/], 'https://evil-example.com')).toBe(
      'https://evil-example.com',
    );
    // Anchored regex does not.
    expect(
      await reflect(
        [/^https:\/\/([a-z0-9-]+\.)?example\.com$/],
        'https://evil-example.com',
      ),
    ).toBeUndefined();
  });

  it('warns at construction for an unanchored CORS regex only (doc 21)', async () => {
    expect.assertions(2);

    const captured: string[] = [];
    const transport = new CaptureTransport(captured);
    appInstance.logger.add(transport);
    try {
      new Cors(appInstance, { origins: [/example\.com/] }); // unanchored → warn
      new Cors(appInstance, {
        origins: [/^https:\/\/app\.example\.com$/, 'https://x.com'], // anchored + string → no warn
      });
    } finally {
      appInstance.logger.remove(transport);
    }

    const all = captured.join('\n');
    expect(all).toContain('not anchored');
    expect((all.match(/not anchored/g) ?? []).length).toBe(1);
  });
});
