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
    return this.app.logger.child({ label });
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
