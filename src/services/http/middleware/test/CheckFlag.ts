import AbstractMiddleware from '../AbstractMiddleware.ts';
import type { Response, NextFunction } from 'express';
import type { FrameworkRequest } from '../../HttpServer.ts';

class CheckFlag extends AbstractMiddleware {
  // eslint-disable-next-line class-methods-use-this
  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const { flag } = req.body || {};

    if (!flag) {
      return res.status(400).json({
        msg: `Flag is off`,
      });
    }

    return next();
  }
}

export default CheckFlag;
