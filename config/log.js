const winston = require('winston');

//{ error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }
 let container = new winston.Container({
     console: {
         level: 'silly',
         colorize: true,
         label: 'Default Logger',
         timestamp:true
     }
  });

module.exports = container;





