import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import Transport from 'winston-transport';
import { appInstance } from '../../../helpers/appInstance.ts';
import { assertThrowsLike } from '../../../tests/assertions.ts';
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
    // const middleware = new Cors(appInstance, { origins: ['something'] });

    assert.notStrictEqual(Cors.description, undefined);
  });

  it('should throw without origns', async () => {
    // @ts-expect-error we not pass options
    assertThrowsLike(() => new Cors(appInstance));
  });

  it('should throw with empty options', async () => {
    // @ts-expect-error we are passong wrong option
    assertThrowsLike(() => new Cors(appInstance, {}));
  });

  it('should throw with empty origins', async () => {
    assertThrowsLike(() => new Cors(appInstance, { origins: [] }));
  });

  it('should throw with empty origins not array', async () => {
    // @ts-expect-error we passing not an Array
    assertThrowsLike(() => new Cors(appInstance, { origins: 'origins' }));
  });

  it('non options should be different', async () => {
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
      set: (key: string, val?: string | string[]) => {
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

    assert.ok(isCalled);
    assert.strictEqual(map.get('Vary'), 'Origin');
  });

  it('host the not match origin', async () => {
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

    assert.ok(isCalled);
  });

  it('continues safely if origins are unavailable at request time', async () => {
    const middleware = new Cors(appInstance, {
      origins: ['https://localhost'],
    });
    middleware.params = undefined;
    let isCalled = false;

    await middleware.middleware(
      {
        method: 'GET',
        headers: { origin: 'https://localhost' },
      } as FrameworkRequest,
      {} as Response,
      () => {
        isCalled = true;
      },
    );

    assert.strictEqual(isCalled, true);
  });

  it('string domain match', async () => {
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
      set: (key: string, val?: string | string[]) => {
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

    assert.ok(isEndCalled);
    assert.strictEqual(
      map.get('Vary'),
      'Origin, Access-Control-Request-Headers',
    );
    assert.strictEqual(
      map.get('Access-Control-Allow-Headers'),
      'someAccessControlRequestHeaders',
    );
    assert.strictEqual(
      map.get('Access-Control-Allow-Origin'),
      'https://localhost',
    );
    assert.strictEqual(
      map.get('Access-Control-Allow-Methods'),
      'GET,HEAD,PUT,PATCH,POST,DELETE',
    );
  });

  it('regexp domain match', async () => {
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
      set: (key: string, val?: string | string[]) => {
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

    assert.ok(isEndCalled);
    assert.strictEqual(
      map.get('Vary'),
      'Origin, Access-Control-Request-Headers',
    );
    assert.strictEqual(
      map.get('Access-Control-Allow-Headers'),
      'someAccessControlRequestHeaders',
    );
    assert.strictEqual(
      map.get('Access-Control-Allow-Origin'),
      'https://localhost',
    );
    assert.strictEqual(
      map.get('Access-Control-Allow-Methods'),
      'GET,HEAD,PUT,PATCH,POST,DELETE',
    );
  });

  it('an unanchored regex matches unintended origins; an anchored one does not (doc 21)', async () => {
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
    assert.strictEqual(
      await reflect([/example\.com/], 'https://evil-example.com'),
      'https://evil-example.com',
    );
    // Anchored regex does not.
    assert.strictEqual(
      await reflect(
        [/^https:\/\/([a-z0-9-]+\.)?example\.com$/],
        'https://evil-example.com',
      ),
      undefined,
    );
  });

  it('warns at construction for an unanchored CORS regex only (doc 21)', async () => {
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
    assert.ok(all.includes('not anchored'));
    assert.strictEqual((all.match(/not anchored/g) ?? []).length, 1);
  });
});
