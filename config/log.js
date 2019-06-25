const winston = require('winston');

let alignColorsAndTime = winston.format.combine(
    winston.format.colorize({
        all:true
    }),
    winston.format.label({
        label:'Default Logger'
    }),
    winston.format.timestamp({
        format:"YY-MM-DD HH:MM:SS"
    }),
    winston.format.printf(
        info => ` ${info.label}  ${info.timestamp}  ${info.level} : ${info.message}`
    )
);

const logger = winston.createLogger({
    level:  "debug",
    // level: process.env.LOG_LEVEL || 'silly',
    transports: [
        new (winston.transports.Console)({
            format: winston.format.combine(winston.format.colorize(),
                alignColorsAndTime)
        })
    ],
});


module.exports = logger;





