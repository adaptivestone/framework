const fsPromises = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const mime = require('mime');

const AbstractMiddleware = require('./AbstractMiddleware');
/**
 * Middleware for static files
 */
class StaticFiles extends AbstractMiddleware {
  constructor(app, params) {
    super(app);
    this.params = params;
    if (!params || !params.folders || !params.folders.length) {
      throw new Error('StaticFiles inited without folders config');
    }
  }

  static get description() {
    return 'Static file server middleware. Host you static files from public foolder. Mostly for dev.';
  }

  async middleware(req, res, next) {
    if (req.method !== 'GET') {
      // only get supported
      return next();
    }
    const { folders } = this.params;

    const promises = [];

    for (const f of folders) {
      const filePath = path.join(f, req.url);
      promises.push(
        fsPromises
          .stat(filePath)
          .catch(() => {
            // nothing there, file just not exists
          })
          .then((stats) => ({ stats, file: filePath })),
      );
    }

    const fileStats = await Promise.all(promises);

    for (const fileStat of fileStats) {
      if (fileStat.stats && fileStat.stats.isFile()) {
        const contentType = mime.getType(fileStat.file);
        const fileStream = fs.createReadStream(fileStat.file);
        res.set('Content-Type', contentType);
        fileStream.pipe(res);
        return null;
      }
    }

    return next();
  }
}

module.exports = StaticFiles;
