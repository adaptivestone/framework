const winston = require('winston');
//TODO normal config
//{ error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }
 let container = new winston.Container({
     console: {
         level: 'error',
         colorize: true,
         label: 'Default Logger',
         timestamp:true
     }
  });

module.exports = container;





