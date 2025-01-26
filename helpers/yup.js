import { Schema } from 'yup';
import { PersistentFile } from 'formidable';

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
      check: (value) => value.every((item) => item instanceof PersistentFile),
    });
  }
}

export { YupFile };
