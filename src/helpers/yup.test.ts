import { describe, expect, it } from 'vitest';
import { YupFile } from './yup.ts';

describe('YupFile (deprecated)', () => {
  it('emits a DeprecationWarning once, regardless of how many are constructed', async () => {
    const captured: Array<{ name: string; code?: string }> = [];
    const handler = (warning: Error & { code?: string }) =>
      captured.push({ name: warning.name, code: warning.code });

    process.on('warning', handler);
    try {
      // biome-ignore lint/correctness/noUnusedVariables: constructed for the side effect
      const a = new YupFile();
      // biome-ignore lint/correctness/noUnusedVariables: constructed for the side effect
      const b = new YupFile();
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
});
