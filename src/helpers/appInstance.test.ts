import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Server from '../server.ts';
import { assertThrowsLike } from '../tests/assertions.ts';
import {
  appInstance,
  getAppInstance,
  resetAppInstance,
  setAppInstance,
} from './appInstance.ts';

const minimalFolders = {
  folders: {
    config: '',
    models: '',
    controllers: '',
    locales: '',
    emails: '',
    commands: '',
    migrations: '',
  },
};

describe('appInstance singleton (doc 27)', () => {
  it('throws a guided error when a second Server is constructed', () => {
    // The native test preload already created one Server, so the singleton is set.
    assertThrowsLike(
      () => new Server(minimalFolders),
      /only one Server per process/,
    );
  });

  it('resetAppInstance allows a second Server (test-only escape hatch)', () => {
    const original = appInstance;
    resetAppInstance();
    try {
      assert.doesNotThrow(() => new Server(minimalFolders));
    } finally {
      // Restore so the rest of the suite keeps the original app.
      resetAppInstance();
      setAppInstance(original);
    }
  });
});

describe('getAppInstance()', () => {
  it('throws before set, returns the exact instance after set, throws again after reset', () => {
    // The native test preload constructed a Server, so the singleton starts set.
    const original = appInstance;
    try {
      resetAppInstance();
      assertThrowsLike(() => getAppInstance(), /not initialized yet/);

      setAppInstance(original);
      assert.strictEqual(getAppInstance(), original);

      resetAppInstance();
      assertThrowsLike(() => getAppInstance(), /not initialized yet/);
    } finally {
      // Restore so the rest of the suite keeps the original app.
      resetAppInstance();
      setAppInstance(original);
    }
  });
});
