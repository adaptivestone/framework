/* eslint-disable import-x/first */
console.time('CLI');
import Cli from './Cli.js';
import folderConfig from './folderConfig.js';

const cli = new Cli(folderConfig);

cli.run().then(() => {
  console.timeEnd('CLI');
});
