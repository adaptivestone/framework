import { PersistentFile } from 'formidable';

/**
 * An uploaded file, saved to a temporary file on disk.
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
 * `File` is both a value, for `instanceof`, and the type of an upload.
 */
export interface File {
  /** Path of the temporary file that holds the upload. */
  filepath: string;
  /** File name the client sent, if any. */
  originalFilename: string | null | undefined;
  /** Media type the client sent, if any. */
  mimetype: string | null;
  /** Size in bytes. */
  size: number;
}

export const File = PersistentFile as unknown as abstract new () => File;
