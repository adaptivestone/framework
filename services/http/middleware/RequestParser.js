const formidable = require('formidable');

const AbstractMiddleware = require('./AbstractMiddleware');

class RequestParser extends AbstractMiddleware {
  static get description() {
    return 'Parses incoming request. Based on Formidable library';
  }

  async middleware(req, res, next) {
    const time = Date.now();
    this.logger.verbose(`Parsing request`);
    // TODO update this to https://github.com/node-formidable/formidable/issues/412#issuecomment-1367914268 in node v20 (in 2023?)

    const form = formidable(this.params); // not in construstor as reuse formidable affects performance
    form.parse(req, (err, fields, files) => {
      this.logger.verbose(
        `Parsing multipart/formdata request DONE ${Date.now() - time}ms`,
      );
      if (err) {
        this.logger.error(`Parsing failed ${err}`);
        return next(err);
      }

      req.body = {
        // todo avoid body in next versions
        ...req.body,
        ...fields,
        ...files,
      };
      return next();
    });
  }
}

module.exports = RequestParser;
