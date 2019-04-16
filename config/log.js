const winston = require('winston');
//TODO normal config
//{ error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }
 let container = new winston.Container({
     console: {
         level: process.env.LOG_LEVEL || 'silly',
         colorize: true,
         label: 'Default Logger',
         timestamp:true
     }
  });

module.exports = container;





