import { type File as ParsedFile, PersistentFile } from 'formidable';

/**
 * Uploaded-file type. Today it aliases formidable's `PersistentFile`; the
 * future transport-neutral parser swap (P3) re-points it at the web-standard
 * `File`. Import this instead of the concrete parser class so your file
 * validation survives that swap untouched.
 *
 * Validate uploads with an `instanceof` check. A file field always arrives as
 * an array; check the array as a whole, so an error stays under the field name
 * (a per-element check reports `avatar[0]`, not `avatar`):
 *
 *   import { File } from '@adaptivestone/framework/types.js';
 *   const files = (v: unknown) => Array.isArray(v) && v.every((f) => f instanceof File);
 *   // zod:     z.custom<File[]>(files, 'not a file')
 *   // valibot: v.custom<File[]>(files, 'not a file')
 *   // arktype: type('unknown').narrow((v, ctx) => files(v) || ctx.mustBe('an array of files'))
 *   // yup:     mixed<File[]>().test('file', 'not a file', files)
 *
 * A missing field fails these checks; for an optional one, let `files` also
 * accept `undefined`.
 *
 * `File` is both a value (the parser's class, for `instanceof`) and a type
 * (an upload with `filepath`, `mimetype`, `originalFilename`, `size`, …).
 */
export type File = InstanceType<typeof PersistentFile> & ParsedFile;

interface FileClass {
  new (...args: ConstructorParameters<typeof PersistentFile>): File;
  readonly prototype: File;
}

export const File = PersistentFile as unknown as FileClass;
