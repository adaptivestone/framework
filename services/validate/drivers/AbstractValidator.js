const Base = require('../../../modules/Base');

class AbstractValidator extends Base {
  constructor(app, body) {
    super(app);
    this.body = body;
  }

  // eslint-disable-next-line class-methods-use-this
  async validateFields() {
    console.log('IMPLENT ME Abstract validateFields');
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  async castFields() {
    console.log('IMPLENT ME Abstract castFields');
    return true;
  }

  static get loggerGroup() {
    return 'AbstractValidator_';
  }
}
module.exports = AbstractValidator;
