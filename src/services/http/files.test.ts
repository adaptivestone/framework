import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PersistentFile } from 'formidable';
import { z } from 'zod';
import { File } from '../../types.ts';

describe('File', () => {
  const upload = () =>
    new File({
      filepath: '/tmp/upload-1',
      newFilename: 'upload-1',
      originalFilename: 'avatar.png',
      mimetype: 'image/png',
      hashAlgorithm: false,
    } as ConstructorParameters<typeof File>[0]);

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
