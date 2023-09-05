// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: './tests/setupVitest.js',
    testTimeout: 10000,
  },
});
