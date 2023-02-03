const Base = require('../../../modules/Base');

class AbstractValidator extends Base {
  constructor(app, body) {
    super(app);
    this.body = body;
  }

  // eslint-disable-next-line no-unused-vars
  static convertFieldsToSwaggerFormat(fields) {
    console.log('IMPLENT ME Abstract convertFieldsToSwaggerFormat');
    return [];
  }

  // eslint-disable-next-line class-methods-use-this
  get fieldsInSwaggerFormat() {
    console.log('IMPLENT ME Abstract fieldsInSwaggerFormat');
    return [];
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
