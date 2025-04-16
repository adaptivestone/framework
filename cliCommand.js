/* eslint-disable import-x/first */
console.time('CLI');
import Cli from './src/Cli.js';
import folderConfig from './src/folderConfig.ts';

const cli = new Cli(folderConfig);

cli.run().then(() => {
  console.timeEnd('CLI');
});
