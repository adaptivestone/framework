const { Schema } = require('yup');
const formidable = require('formidable');

/**
 * Validator for file
 * use as
 * @example
 * request: yup.object().shape({
 *          someFile: new YupFile().required(),
 * })
 */
class YupFile extends Schema {
  constructor() {
    super({
      type: 'file',
    });
  }

  // eslint-disable-next-line class-methods-use-this, no-underscore-dangle
  _typeCheck(value) {
    return value instanceof formidable.PersistentFile;
  }
}

module.exports = {
  // eslint-disable-next-line import/prefer-default-export
  YupFile,
};
