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
 * Read the app-instance singleton, throwing a guided error when it isn't set.
 *
 * Prefer this over importing the raw `appInstance` binding. A consumer that reads
 * the binding before any `Server` has been constructed gets the singleton's
 * `undefined` value, so the first property access fails with an opaque
 * `TypeError: cannot read properties of undefined (reading '…')` that gives no
 * hint about *why* it's undefined. This helper surfaces the real cause (and the
 * fix) at the point of use instead.
 */
export const getAppInstance = (): IApp => {
  if (!appInstance) {
    throw new Error(
      'App instance is not initialized yet — construct the Server first ' +
        '(its constructor sets the singleton). In tests, use setAppInstance() ' +
        'to inject one and resetAppInstance() to clear it.',
    );
  }
  return appInstance;
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
