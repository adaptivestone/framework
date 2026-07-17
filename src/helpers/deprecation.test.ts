import { describe, expect, it, vi } from 'vitest';
import { makeOncePerClassWarner } from './deprecation.ts';

describe('makeOncePerClassWarner', () => {
  it('warns once per class while allowing a different class', () => {
    class First {}
    class Second {}
    const emitWarning = vi
      .spyOn(process, 'emitWarning')
      .mockImplementation(() => {});
    const warn = makeOncePerClassWarner(
      'TEST_DEPRECATION',
      (name, error) => `${name}: ${String(error)}`,
    );
    try {
      warn(First, 'reason');
      warn(First, 'ignored');
      warn(Second, 'other');

      expect(emitWarning).toHaveBeenCalledTimes(2);
      expect(emitWarning).toHaveBeenNthCalledWith(1, 'First: reason', {
        type: 'DeprecationWarning',
        code: 'TEST_DEPRECATION',
      });
      expect(emitWarning).toHaveBeenNthCalledWith(2, 'Second: other', {
        type: 'DeprecationWarning',
        code: 'TEST_DEPRECATION',
      });
    } finally {
      emitWarning.mockRestore();
    }
  });
});
