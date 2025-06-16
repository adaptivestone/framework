import { appInstance } from '../helpers/appInstance.ts';
import type Server from '../server.ts';

export let serverInstance: Server;

export const setServerInstance = (serverInstanceToSet: Server) => {
  if (serverInstance) {
    throw new Error('Server instance is already set');
  }
  serverInstance = serverInstanceToSet;
};

export const getServerBaseURL = (urlPart?: string) => {
  return `http://127.0.0.1:${appInstance.getConfig('http').port}${urlPart}`;
};
