import { PersistentFile } from 'formidable';
import { describe, expect, it } from 'vitest';
import { YupFile } from './yup.ts';

describe('YupFile (deprecated)', () => {
  it('emits a DeprecationWarning once, regardless of how many are constructed', async () => {
    const captured: Array<{ name: string; code?: string }> = [];
    const handler = (warning: Error & { code?: string }) =>
      captured.push({ name: warning.name, code: warning.code });

    process.on('warning', handler);
    try {
      // Construct twice; the deprecation warning must still fire only once.
      const a = new YupFile();
      const b = new YupFile();
      expect(a).toBeInstanceOf(YupFile);
      expect(b).toBeInstanceOf(YupFile);
      // process.emitWarning fires on the next tick — let it flush.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', handler);
    }

    const yupFileWarnings = captured.filter(
      (w) => w.code === 'ASF_DEP_YUPFILE',
    );
    expect(yupFileWarnings).toHaveLength(1);
    expect(yupFileWarnings[0]?.name).toBe('DeprecationWarning');
  });

  // The only real logic: the value must be an array of formidable
  // `PersistentFile`s. Still shipped in v5, so guard it until v6 removes it.
  describe('type check', () => {
    // `instanceof PersistentFile` without invoking formidable's constructor.
    const fakeFile = () =>
      Object.create(PersistentFile.prototype) as PersistentFile;

    it('accepts an array of PersistentFile instances', () => {
      expect(new YupFile().isType([fakeFile(), fakeFile()])).toBe(true);
    });

    it('rejects an array containing a non-file', () => {
      expect(new YupFile().isType([fakeFile(), 'not a file'])).toBe(false);
    });

    it('rejects a value that is not an array', () => {
      expect(new YupFile().isType('nope')).toBe(false);
    });
  });
});
