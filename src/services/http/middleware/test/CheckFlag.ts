import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../../HttpServer.ts';
import AbstractMiddleware from '../AbstractMiddleware.ts';

class CheckFlag extends AbstractMiddleware {
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
