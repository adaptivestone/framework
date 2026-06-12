import cluster from 'node:cluster';
import { cpus } from 'node:os';

const numCPUs = cpus().length;

if (cluster.isPrimary) {
  console.log(`Master ${process.pid} is running`);
  // Fork workers.
  for (let i = 0; i < numCPUs; i += 1) {
    cluster.fork();
  }

  // An orchestrator sends SIGTERM/SIGINT to PID 1 (the primary). Forward it to
  // every worker so each drains gracefully via its own signal handler (workers
  // run index.ts → startServer); the primary exits once the last worker is gone.
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      shuttingDown = true;
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker?.kill(signal);
      }
    });
  }

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) {
      // Tearing down: don't resurrect; exit when the last worker has gone.
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        process.exit(0);
      }
      return;
    }
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
