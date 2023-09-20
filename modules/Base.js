const fs = require('node:fs').promises;
const { join } = require('node:path');

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
    return this.app.logger.child({ label });
  }

  async getFilesPathWithInheritance(internalFolder, externalFolder) {
    let [internalFiles, externalFiles] = await Promise.all([
      fs.readdir(internalFolder, { recursive: true, withFileTypes: true }),
      fs.readdir(externalFolder, { recursive: true, withFileTypes: true }),
    ]);

    const filterIndexFile = (fileDirent) => {
      if (!fileDirent.isFile()) {
        return false;
      }
      const fileArray = fileDirent.name.split('/');
      const file = fileArray[fileArray.length - 1];
      return (
        // file[0] === file[0].toUpperCase() && // Start with capital
        file[0] !== '.' && // not start with dot
        !file.endsWith('.test.js') // not test files
      );
    };

    internalFiles = internalFiles
      .filter(filterIndexFile)
      .map((fileDirent) =>
        join(fileDirent.path, fileDirent.name).replace(
          `${internalFolder}/`,
          '',
        ),
      );
    externalFiles = externalFiles
      .filter(filterIndexFile)
      .map((fileDirent) =>
        join(fileDirent.path, fileDirent.name).replace(
          `${externalFolder}/`,
          '',
        ),
      );

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
    console.log(filesToLoad);
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
