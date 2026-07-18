import {
  type ClusterEvent,
  type ClusterWorkerCount,
  type RunClusterOptions,
  runCluster,
} from './clusterRunner.ts';

export type { ClusterEvent, ClusterWorkerCount, RunClusterOptions };
export { runCluster };

// Keep the framework's own production entry on the public implementation.
// Importing `@adaptivestone/framework/cluster.js` has no side effects; this runs
// only for `node src/cluster.ts` / `node dist/cluster.js`.
if (import.meta.main) {
  await runCluster(async () => {
    await import('./index.ts');
  });
}
