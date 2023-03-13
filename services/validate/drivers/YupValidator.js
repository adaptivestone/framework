const yup = require('yup');
const AbstractValidator = require('./AbstractValidator');

class YupValidator extends AbstractValidator {
  get fieldsInJsonFormat() {
    return this.constructor.convertFieldsToJson(this.body);
  }

  static convertFieldsToJson(fields) {
    const convertedFields = {};
    const entries = Object.entries(fields.describe().fields);

    if (!entries?.length) {
      return convertedFields;
    }
    const requiredFields = [];

    for (const [field, fieldProp] of entries) {
      const isRequired = fieldProp?.tests?.find(
        (prop) => prop.name === 'required',
      );
      if (isRequired) {
        requiredFields.push(field);
      }
    }

    entries.forEach(([key, value]) => {
      if (!convertedFields[key]) {
        convertedFields[key] = {};
      }

      convertedFields[key] = {
        type: value.type,
        required: requiredFields?.includes(key),
      };
    });

    return convertedFields;
  }

  async validateFields(data, { query, body, appInfo }) {
    const yupSchema = this.body;
    const { controllerValidationAbortEarly } = this.app.getConfig('validate');
    if (yupSchema) {
      if (typeof yupSchema.validate !== 'function') {
        this.logger.error('request.validate should be a function');
      }
    }

    try {
      await yupSchema.validate(data, {
        abortEarly: controllerValidationAbortEarly,
        req: { query, body },
      });
    } catch (e) {
      let { errors } = e;
      // translate it
      if (appInfo.i18n && errors) {
        errors = errors.map((err) => appInfo.i18n.t(err, err));
      }
      this.logger.error(
        `Request validation failed with message: ${e.message}. errors: ${errors}`,
      );

      const errorAnswer = {};
      if (!e.inner || !e.inner.length) {
        errorAnswer[e.path] = errors;
      } else {
        e.inner.forEach((err) => {
          errorAnswer[err.path] = err.errors;
          if (appInfo.i18n && err.errors) {
            errorAnswer[err.path] = err.errors.map((err1) =>
              appInfo.i18n.t(err1, err1),
            );
          }
        });
      }

      throw new yup.ValidationError({
        ...errorAnswer,
      });
    }
  }

  async castFields(data, { query, body }) {
    const yupSchema = this.body;
    if (yupSchema) {
      if (typeof yupSchema.cast !== 'function') {
        this.logger.error('request.cast should be a function');
      }
    }

    return yupSchema.cast(data, {
      stripUnknown: true,
      req: { query, body },
    });
  }

  static get loggerGroup() {
    return 'YupValidator_';
  }
}
module.exports = YupValidator;
