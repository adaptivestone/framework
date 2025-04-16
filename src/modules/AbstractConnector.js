import Base from './Base.js';

class AbstractConnector extends Base {
  static get loggerGroup() {
    return 'connector';
  }
}

export default AbstractConnector;
