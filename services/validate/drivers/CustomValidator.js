const AbstractValidator = require('./AbstractValidator');

class CustomValidator extends AbstractValidator {
  async validateFields(data, { req }) {
    if (this.body) {
      if (typeof this.body.validate !== 'function') {
        this.logger.error('request.validate should be a function');
      }
    }
    return this.body.validate(data, { req });
  }

  async castFields(data, { req }) {
    if (this.body) {
      if (typeof this.body.cast !== 'function') {
        this.logger.error('request.validate should be a function');
      }
    }
    return this.body.cast(data, { req });
  }

  static get loggerGroup() {
    return 'CustomValidator_';
  }
}
module.exports = CustomValidator;
