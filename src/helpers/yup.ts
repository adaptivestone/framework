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
 * files with the framework's vendor-neutral `File` type and an `instanceof`
 * check instead (no yup required). A file field always arrives as an array;
 * check the array as a whole, as `YupFile` does, so an error stays under the
 * field name (a per-element check reports `avatar[0]`, not `avatar`):
 *
 *   import { File } from '@adaptivestone/framework/types.js';
 *   const files = (v: unknown) => Array.isArray(v) && v.every((f) => f instanceof File);
 *   // zod:     z.custom<File[]>(files, 'not a file')
 *   // valibot: v.custom<File[]>(files, 'not a file')
 *   // yup:     mixed<File[]>().test('file', 'not a file', files)
 *
 * A missing field fails these checks; for an optional one, let `files` also
 * accept `undefined`.
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
        "YupFile is deprecated and will be removed in v6. Validate uploaded files with the `File` export from \"@adaptivestone/framework/types.js\" and an instanceof check. A file field arrives as an array; check the array as a whole so errors stay under the field name (e.g. mixed().test('file', 'not a file', (v) => Array.isArray(v) && v.every((f) => f instanceof File))).",
        { type: 'DeprecationWarning', code: 'ASF_DEP_YUPFILE' },
      );
    }
  }
}

export { YupFile };
