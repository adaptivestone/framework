const AbstractMiddleware = require('../AbstractMiddleware');

class isAdmin extends AbstractMiddleware {
  constructor(app, params) {
    super(app);
    this.params = params;
  }

  async middleware(req, res, next) {
    const { user } = req.body;

    if (!this.params.roles.includes(user.role)) {
      return res.status(403).json({ message: 'You do not have access' });
    }
    return next();
  }
}

module.exports = isAdmin;
