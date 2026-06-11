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
    // Deliberate shutdown (clean exit, no kill signal) — do not resurrect,
    // otherwise the primary fights a graceful shutdown forever.
    if (code === 0 && !signal) {
      return;
    }
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
  // index.ts is the entry that actually constructs the Server and starts
  // listening. server.ts only DEFINES the class, so importing it here would
  // let the worker's event loop drain and exit → infinite fork storm.
  import('./index.ts');
}
