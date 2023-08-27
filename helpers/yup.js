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
      check: (value) =>
        value.every((item) => item instanceof formidable.PersistentFile),
    });
  }
}

module.exports = {
  // eslint-disable-next-line import/prefer-default-export
  YupFile,
};
