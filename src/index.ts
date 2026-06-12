import folderConfig from './folderConfig.ts';
import Server from './server.ts';

const server = new Server(folderConfig);

server.startServer().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
