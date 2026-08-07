import { describe, it, mock } from 'node:test';
import { assertCalledTimes, assertNthCalledWith } from '../tests/assertions.ts';
import { mockImplementation } from '../tests/mocks.ts';
import { makeOncePerClassWarner } from './deprecation.ts';

describe('makeOncePerClassWarner', () => {
  it('warns once per class while allowing a different class', () => {
    class First {}
    class Second {}
    const emitWarning = mockImplementation(
      mock.method(process, 'emitWarning'),
      () => {},
    );
    const warn = makeOncePerClassWarner(
      'TEST_DEPRECATION',
      (name, error) => `${name}: ${String(error)}`,
    );
    try {
      warn(First, 'reason');
      warn(First, 'ignored');
      warn(Second, 'other');

      assertCalledTimes(emitWarning, 2);
      assertNthCalledWith(emitWarning, 1, 'First: reason', {
        type: 'DeprecationWarning',
        code: 'TEST_DEPRECATION',
      });
      assertNthCalledWith(emitWarning, 2, 'Second: other', {
        type: 'DeprecationWarning',
        code: 'TEST_DEPRECATION',
      });
    } finally {
      emitWarning.mock.restore();
    }
  });
});
