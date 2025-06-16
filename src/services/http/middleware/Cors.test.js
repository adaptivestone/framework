import { describe, it, expect } from 'vitest';
import Cors from './Cors.ts';
import { appInstance } from '../../../helpers/appInstance.ts';

describe('cors middleware methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new Cors(appInstance, { origins: ['something'] });

    expect(Cors.description).toBeDefined();
  });

  it('should throw without origns', async () => {
    expect.assertions(1);
    expect(() => new Cors(appInstance)).toThrow();
  });

  it('should throw with empty options', async () => {
    expect.assertions(1);
    expect(() => new Cors(appInstance, {})).toThrow();
  });

  it('should throw with empty origins', async () => {
    expect.assertions(1);
    expect(() => new Cors(appInstance, { origins: [] })).toThrow();
  });

  it('should throw with empty origins not array', async () => {
    expect.assertions(1);
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

    await middleware.middleware(req, res, nextFunction);

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

    await middleware.middleware(req, {}, nextFunction);

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

    await middleware.middleware(req, res);

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

    await middleware.middleware(req, res);

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
});
