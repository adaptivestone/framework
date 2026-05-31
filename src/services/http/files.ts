/**
 * Uploaded-file type. Today it aliases formidable's `PersistentFile`; the
 * future transport-neutral parser swap (P3) re-points it at the web-standard
 * `File`. Import this instead of the concrete parser class so your file
 * validation survives that swap untouched.
 *
 * Validate uploads with your validator's idiomatic `instanceof` check:
 *
 *   import { File } from '@adaptivestone/framework/types.js';
 *   // zod:     z.instanceof(File)
 *   // valibot: v.instance(File)
 *   // arktype: type.instanceOf(File)
 *   // yup:     mixed().test('file', 'not a file', (v) => v instanceof File)
 *
 * `File` is both a value (for `instanceof`) and a type (for annotations),
 * because it is a class.
 */
export { PersistentFile as File } from 'formidable';
