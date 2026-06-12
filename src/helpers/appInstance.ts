import type { IApp } from '../server.ts';

export let appInstance: IApp;

export const setAppInstance = (app: IApp) => {
  if (appInstance) {
    throw new Error(
      'App instance is already set — only one Server per process is supported. ' +
        'In tests, isolate per file (see @adaptivestone/framework/tests/setupVitest.js), ' +
        'or call resetAppInstance() between servers if you accept the risks.',
    );
  }
  appInstance = app;
};

/**
 * Clear the app-instance singleton. **Test-only escape hatch** for runners that
 * can't isolate per file. It does NOT clean up mongoose-registered models, the
 * redis client module state, or env vars — so one `Server` per process (per-file
 * isolation, as the shipped vitest setup does) stays the recommended path.
 */
export const resetAppInstance = (): void => {
  appInstance = undefined as unknown as IApp;
};
