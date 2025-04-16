import cluster from 'node:cluster';
import { cpus } from 'node:os';

const numCPUs = cpus().length;

if (cluster.isPrimary) {
  console.log(`Master ${process.pid} is running`);
  // Fork workers.
  for (let i = 0; i < numCPUs; i += 1) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(
      `Worker \x1B[45m ${
        worker.process.pid
      } \x1B[49m \x1B[41m †††† died †††† \x1B[49m. Code: ${
        signal || code
      }. Restarting...`,
    );
    cluster.fork();
  });
} else {
  import('./server.ts');
}
