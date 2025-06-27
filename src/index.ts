import folderConfig from './folderConfig.ts';
import Server from './server.ts';

const server = new Server(folderConfig);

server.startServer().then(() => {
  console.log(server.app.controllerManager?.controllers);
});
