/* eslint-disable no-underscore-dangle */
const winston = require('winston');

class Base {
  constructor(app) {
    this.app = app;
    this._realLogger = null;
  }

  /**
   * Optimzation to lazy load logger. It will be inited only on request
   */
  get logger() {
    if (!this._realLogger) {
      this._realLogger = this.getLogger(
        this.constructor.loggerGroup + this.constructor.name,
      );
    }
    return this._realLogger;
  }

  getLogger(label) {
    const alignColorsAndTime = winston.format.combine(
      winston.format.colorize({
        all: true,
      }),
      winston.format.label({
        label: ` \x1B[32m[${label}]\x1B[39m`,
      }),
      winston.format.timestamp(),
      winston.format.printf(
        (info) =>
          `(${process.pid}) ${info.label}  ${info.timestamp}  ${info.level} : ${info.message}`,
      ),
    );

    const logConfig = this.app.getConfig('log');

    const transports = [];
    for (const log of logConfig) {
      if (log.enable) {
        if (log.transport === 'console') {
          transports.push(
            new winston.transports.Console({
              level: log.transportOptions.level,
              format: winston.format.combine(
                winston.format.colorize(),
                alignColorsAndTime,
              ),
            }),
          );
        } else {
          const Tr = require(log.transport);
          transports.push(new Tr(log.transportOptions));
        }
      }
    }


    return new winston.createLogger({
      level: 'silly',
      transports,
    });;
  }

  static get loggerGroup() {
    return 'Base_please_overwrite_';
  }
}

module.exports = Base;
