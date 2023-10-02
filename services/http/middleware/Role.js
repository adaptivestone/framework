const AbstractMiddleware = require('./AbstractMiddleware');

class RoleMiddleware extends AbstractMiddleware {
  static get description() {
    return 'Check user role (user.roles property). If the user has no role then stop request and return error. OR logic (any role will pass user)';
  }

  async middleware(req, res, next) {
    const { user } = req.appInfo;

    if (!user) {
      return res.status(401).json({ message: 'User should be provided' });
    }

    let hasRole = false;
    user.roles.forEach((role) => {
      if (this.params.roles.includes(role)) {
        hasRole = true;
      }
    });

    if (!hasRole) {
      return res.status(403).json({ message: 'You do not have access' });
    }
    return next();
  }
}

module.exports = RoleMiddleware;
