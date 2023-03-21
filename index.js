const Server = require('./server');
const folderConfig = require('./folderConfig');

const server = new Server(folderConfig);

server.startServer().then(() => {
  console.log(server.app.controllerManager.controllers);
});
