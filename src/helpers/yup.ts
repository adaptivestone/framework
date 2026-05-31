import { PersistentFile } from 'formidable';
import { Schema } from 'yup';

// Emit the runtime deprecation notice at most once per process. Use Node's
// DeprecationWarning channel so consumers can silence it (`--no-deprecation`),
// trace it (`--trace-deprecation`), or escalate it to a thrown error
// (`--throw-deprecation`) without us hard-breaking anyone before v6.
let deprecationWarned = false;

/**
 * Validator for an uploaded file (yup-specific).
 *
 * @deprecated Since 5.0.0-beta.51 — `YupFile` will be removed in v6. Validate
 * files with the framework's vendor-neutral `File` type and your validator's
 * `instanceof` idiom instead (no yup required):
 *
 *   import { File } from '@adaptivestone/framework/types.js';
 *   // zod:     z.instanceof(File)
 *   // valibot: v.instance(File)
 *   // yup:     mixed().test('file', 'not a file', (v) => v instanceof File)
 *
 * @example
 * request: yup.object().shape({
 *          someFile: new YupFile().required(),
 * })
 */
class YupFile extends Schema {
  constructor() {
    super({
      type: 'file',
      check: (value: unknown) =>
        Array.isArray(value) &&
        value.every((item) => item instanceof PersistentFile),
    });
    if (!deprecationWarned) {
      deprecationWarned = true;
      process.emitWarning(
        'YupFile is deprecated and will be removed in v6. Validate uploaded files with the `File` export from "@adaptivestone/framework/types.js" and your validator\'s instanceof idiom (e.g. z.instanceof(File)).',
        { type: 'DeprecationWarning', code: 'ASF_DEP_YUPFILE' },
      );
    }
  }
}

export { YupFile };
