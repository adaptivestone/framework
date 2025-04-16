import AbstractMiddleware from '../AbstractMiddleware.js';

class CheckFlag extends AbstractMiddleware {
  // eslint-disable-next-line class-methods-use-this
  async middleware(req, res, next) {
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
