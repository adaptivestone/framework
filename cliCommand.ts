console.time('CLI');

import Cli from './src/Cli.ts';
import folderConfig from './src/folderConfig.ts';

const cli = new Cli(folderConfig);

cli
  .run()
  .then(() => {
    console.timeEnd('CLI');
    // Explicit clean exit. Without this, lazy mongoose connections (held by
    // controllers/middlewares instantiated for introspection commands like
    // `generatetypes`) keep the event loop alive, so the CLI would hang after
    // the command finished (the force-exit timer now lives only in the HTTP
    // server's signal handler, not on every `shutdown` event). A delayed exit
    // would also break npm `&&` chains (e.g., `npm run check:types`).
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
