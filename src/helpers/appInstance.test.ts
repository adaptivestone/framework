import { describe, expect, it } from 'vitest';
import Server from '../server.ts';
import {
  appInstance,
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
    // setupVitest already created one Server, so the singleton is set.
    expect(() => new Server(minimalFolders)).toThrow(
      /only one Server per process/,
    );
  });

  it('resetAppInstance allows a second Server (test-only escape hatch)', () => {
    const original = appInstance;
    resetAppInstance();
    try {
      expect(() => new Server(minimalFolders)).not.toThrow();
    } finally {
      // Restore so the rest of the suite keeps the original app.
      resetAppInstance();
      setAppInstance(original);
    }
  });
});
