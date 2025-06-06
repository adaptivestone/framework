import type { IApp } from '../server.ts';

export let appInstance: IApp;

export const setAppInstance = (app: IApp) => {
  if (appInstance) {
    throw new Error('App instance is already set');
  }
  appInstance = app;
};
