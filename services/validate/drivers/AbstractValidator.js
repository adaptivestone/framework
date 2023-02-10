const Base = require('../../../modules/Base');

class AbstractValidator extends Base {
  constructor(app, body) {
    super(app);
    this.body = body;
  }

  // eslint-disable-next-line no-unused-vars
  static convertFieldsToJson(fields) {
    // IMPLENT;
    return {};
  }

  // eslint-disable-next-line class-methods-use-this
  get fieldsInJsonFormat() {
    // IMPLENT;
    return {};
  }

  // eslint-disable-next-line class-methods-use-this
  async validateFields() {
    // IMPLENT;
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  async castFields() {
    // IMPLENT;
    return true;
  }

  static get loggerGroup() {
    return 'AbstractValidator_';
  }
}
module.exports = AbstractValidator;
