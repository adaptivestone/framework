const winston = require('winston');
class Base {
    constructor(app){
        this.app = app;
        this.logger = this.getLogger(this.constructor.loggerGroup+this.constructor.name);
    }

    getLogger(label){
        let alignColorsAndTime = winston.format.combine(
            winston.format.colorize({
                all:true
            }),
            winston.format.label({
                label:` \x1B[32m[${label}]\x1B[39m`
            }),
            winston.format.timestamp(),
            winston.format.printf(
                info => `(${process.pid}) ${info.label}  ${info.timestamp}  ${info.level} : ${info.message}`
            )
        );

        let logConfig = this.app.getConfig("log");

        let logger;
        let transports = [];
        for (let log of logConfig){
            if(log.enable){
                if(log.transport === 'console'){
                    transports.push(new (winston.transports.Console)({
                        format: winston.format.combine(winston.format.colorize(),
                            alignColorsAndTime)
                    }));
                }else {
                    let tr = require(log.transport);
                    transports.push(new tr(log.transportOptions));
                }
            }
        }
        logger = new winston.createLogger({
            level:"silly",
            transports: transports
        });




        return logger;
    }

    static get loggerGroup(){
        return 'Base_please_overwrite_'
    }
}

module.exports = Base;