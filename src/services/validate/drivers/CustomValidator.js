import { ValidationError } from 'yup';
import AbstractValidator from './AbstractValidator.js';

class CustomValidator extends AbstractValidator {
  async validateFields(data, { query, body, appInfo }) {
    if (this.body) {
      if (typeof this.body.validate !== 'function') {
        this.logger.error('request.validate should be a function');
      }
    }
    try {
      await this.body.validate(data, {
        req: {
          query,
          body,
          appInfo,
        },
      });
    } catch (e) {
      this.logger.warn(`CustomValidator validateFields ${e}`);
      if (e.path) {
        throw new ValidationError({
          [e.path]: e.message,
        });
      }
      throw new Error(e);
    }
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

export default CustomValidator;
