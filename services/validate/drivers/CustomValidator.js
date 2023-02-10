const AbstractValidator = require('./AbstractValidator');

class CustomValidator extends AbstractValidator {
  async validateFields(data, { query, body, appInfo }) {
    if (this.body) {
      if (typeof this.body.validate !== 'function') {
        this.logger.error('request.validate should be a function');
      }
    }

    return this.body.validate(data, {
      req: {
        query,
        body,
        appInfo,
      },
    });
  }

  async castFields(data, { query, body, appInfo }) {
    if (this.body) {
      if (typeof this.body.cast !== 'function') {
        this.logger.error('request.validate should be a function');
      }
    }

    return this.body.cast(data, {
      req: {
        query,
        body,
        appInfo,
      },
    });
  }

  static get loggerGroup() {
    return 'CustomValidator_';
  }
}
module.exports = CustomValidator;
