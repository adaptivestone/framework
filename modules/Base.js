const fs = require('node:fs').promises;
const { join, normalize } = require('node:path');

class Base {
  #realLogger = null;

  constructor(app) {
    this.app = app;
  }

  /**
   * In case of logging sometimes we might need to replace name
   */
  getConstructorName() {
    return this.constructor.name;
  }

  /**
   * Optimzation to lazy load logger. It will be inited only on request
   */
  get logger() {
    if (!this.#realLogger) {
      this.#realLogger = this.getLogger(
        this.constructor.loggerGroup + this.getConstructorName(),
      );
    }
    return this.#realLogger;
  }

  /**
   * Get winston loger for given label
   * @param {string} label name of logger
   */
  getLogger(label) {
    // eslint-disable-next-line global-require
    const winston = require('winston'); // speed up optimisation
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
          `(${process.pid}) ${info.label}  ${info.timestamp}  ${info.level} : ${info.message} ${info?.stack}`,
      ),
    );

    const logConfig = this.app.getConfig('log').transports;

    function IsConstructor(f) {
      try {
        Reflect.construct(String, [], f);
      } catch (e) {
        return false;
      }
      return true;
    }
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
          // eslint-disable-next-line global-require, import/no-dynamic-require
          let Tr = require(log.transport);
          if (!IsConstructor(Tr) && Tr.default) {
            Tr = Tr.default;
          } else {
            // eslint-disable-next-line no-console
            console.error(
              `${log.transport} not a constructor. Please check it`,
            );
            // eslint-disable-next-line no-continue
            continue;
          }

          transports.push(new Tr(log.transportOptions));
        }
      }
    }

    const logger = winston.createLogger({
      format: winston.format.errors({ stack: true }),
      level: 'silly',
      transports,
    });
    return logger;
  }

  async getFilesPathWithInheritance(internalFolder, externalFolder) {
    async function rreaddir(dir, allFiles = []) {
      const files = (await fs.readdir(dir)).map((f) => join(dir, f));
      allFiles.push(...files);
      await Promise.all(
        files.map(async (f) => {
          if ((await fs.stat(f)).isDirectory()) {
            allFiles.pop();
            return rreaddir(f, allFiles);
          }
          return null;
        }),
      );
      return allFiles.map((file) => file.replace(`${normalize(dir)}/`, ''));
    }

    let [internalFiles, externalFiles] = await Promise.all([
      rreaddir(internalFolder),
      rreaddir(externalFolder),
    ]);

    const filterIndexFile = (fileName) => {
      const fileArray = fileName.split('/');
      const file = fileArray[fileArray.length - 1];
      return (
        file[0] === file[0].toUpperCase() && // Start with capital
        file[0] !== '.' && // not start with dot
        !file.includes('.test.js') // not test files
      );
    };

    internalFiles = internalFiles.filter(filterIndexFile);
    externalFiles = externalFiles.filter(filterIndexFile);

    const filesToLoad = [];
    for (const file of internalFiles) {
      if (externalFiles.includes(file)) {
        this.logger.verbose(
          `Skipping register INTERNAL file ${file} as it override by EXTERNAL ONE`,
        );
      } else {
        filesToLoad.push({
          path: `${internalFolder}/${file}`,
          file,
        });
      }
    }

    for (const file of externalFiles) {
      filesToLoad.push({
        path: `${externalFolder}/${file}`,
        file,
      });
    }
    return filesToLoad;
  }

  /**
   * Return logger group. Just to have all logs groupped logically
   */
  static get loggerGroup() {
    return 'Base_please_overwrite_';
  }
}

module.exports = Base;
