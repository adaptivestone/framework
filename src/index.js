import Server from './server.js';
import folderConfig from './folderConfig.ts';

const server = new Server(folderConfig);

server.startServer().then(() => {
  console.log(server.app.controllerManager.controllers);
});
