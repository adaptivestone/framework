import Base from './Base.ts';

class AbstractConnector extends Base {
  static get loggerGroup() {
    return 'connector';
  }
}

export default AbstractConnector;
