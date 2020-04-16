const Base = require('./Base');

class AbstractConnector extends Base {
  static get loggerGroup() {
    return 'connector';
  }
}

module.exports = AbstractConnector;
