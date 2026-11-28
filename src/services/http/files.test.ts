import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PersistentFile } from 'formidable';
import { z } from 'zod';
import { File } from '../../types.ts';

describe('File', () => {
  // An upload as the request parser creates it.
  const upload = () =>
    new PersistentFile({
      filepath: '/tmp/upload-1',
      newFilename: 'upload-1',
      originalFilename: 'avatar.png',
      mimetype: 'image/png',
      hashAlgorithm: false,
    } as ConstructorParameters<typeof PersistentFile>[0]) as unknown as File;

  it('is the parser file class, so instanceof matches an upload', () => {
    assert.strictEqual(File, PersistentFile);
    assert.ok(upload() instanceof File);
    assert.ok(z.array(z.instanceof(File)).safeParse([upload()]).success);
  });

  it('types the upload fields a handler reads', () => {
    // Type-level: these reads compile without a cast.
    const read = (file: File) => ({
      filepath: file.filepath,
      mimetype: file.mimetype,
      originalFilename: file.originalFilename,
      size: file.size,
    });

    assert.deepStrictEqual(read(upload()), {
      filepath: '/tmp/upload-1',
      mimetype: 'image/png',
      originalFilename: 'avatar.png',
      size: 0,
    });
  });
});
