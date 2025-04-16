import Server from './server.js';
import folderConfig from './folderConfig.js';

const server = new Server(folderConfig);

server.startServer().then(() => {
  console.log(server.app.controllerManager.controllers);
});
