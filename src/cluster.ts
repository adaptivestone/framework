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

  // Bound crash-loop restarts. A worker that keeps dying on boot (bad config,
  // port in use, missing Mongo/AUTH_SALT, unhandled rejection) must NOT be
  // re-forked in a tight loop — that pegs every core and floods logs. Track
  // restarts in a rolling window; if they arrive too fast, stop forking and
  // exit so the orchestrator surfaces the crash-loop instead of the primary
  // masking it forever. Healthy single crashes still recover (after a short
  // backoff).
  const RESTART_WINDOW_MS = 60_000;
  const MAX_RESTARTS_PER_WINDOW = numCPUs * 5;
  const RESTART_BACKOFF_MS = 1_000;
  let restartTimes: number[] = [];

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

    const now = Date.now();
    restartTimes = restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    restartTimes.push(now);
    if (restartTimes.length > MAX_RESTARTS_PER_WINDOW) {
      console.error(
        `Too many worker crashes (${restartTimes.length} in ${
          RESTART_WINDOW_MS / 1000
        }s). Refusing to keep forking — check the boot error above (config, DB, port). Exiting.`,
      );
      process.exit(1);
    }

    console.log(
      `Worker \x1B[45m ${
        worker.process.pid
      } \x1B[49m \x1B[41m †††† died †††† \x1B[49m. Code: ${
        signal || code
      }. Restarting in ${RESTART_BACKOFF_MS}ms...`,
    );
    setTimeout(() => {
      if (!shuttingDown) {
        cluster.fork();
      }
    }, RESTART_BACKOFF_MS).unref();
  });
} else {
  // index.ts is the entry that actually constructs the Server and starts
  // listening. server.ts only DEFINES the class, so importing it here would
  // let the worker's event loop drain and exit → infinite fork storm.
  import('./index.ts');
}
