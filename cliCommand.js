const Cli = require('./Cli');
const folderConfig = require('./folderConfig');

const cli = new Cli(folderConfig);

cli.run();
