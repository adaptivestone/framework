import formidable from 'formidable';
import AbstractMiddleware from './AbstractMiddleware.ts';

import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../HttpServer.ts';

class RequestParser extends AbstractMiddleware {
  static get description() {
    return 'Parses incoming request. Based on Formidable library';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const time = Date.now();
    this.logger?.verbose(`Parsing request`);
    // TODO update this to https://github.com/node-formidable/formidable/issues/412#issuecomment-1367914268 in node v20 (in 2023?)

    const form = formidable(this.params); // not in construstor as reuse formidable affects performance
    let fields;
    let files;
    try {
      [fields, files] = await form.parse(req);
    } catch (err) {
      this.logger?.error(`Parsing failed ${err}`);
      return res.status(400).json({
        message: `Error to parse your request. You provided invalid content type or content-length. Please check your request headers and content type.`,
      });
      // return next(err);
    }
    this.logger?.verbose(
      `Parsing multipart/formdata request DONE ${Date.now() - time}ms`,
    );

    req.body = {
      // todo avoid body in next versions
      ...(req.body || {}),
      ...fields,
      ...files,
    };
    return next();
  }
}

export default RequestParser;
