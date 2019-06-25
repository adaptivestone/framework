class Base {
    constructor(app){
        this.app = app;
        this.logger = this.constructor.getLogger(this.constructor.loggerGroup+this.constructor.name);
    }

    static getLogger(label){
        const winston = require('winston');
        console.log(this.constructor.loggerGroup);
        let alignColorsAndTime = winston.format.combine(
            winston.format.colorize({
                all:true
            }),
            winston.format.label({
                label:` \x1B[32m[${label}]\x1B[39m`
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
        return logger;
    }

    static get loggerGroup(){
        return 'Base_please_overwrite_'
    }
}

module.exports = Base;