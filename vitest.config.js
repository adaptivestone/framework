import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: './tests/setupVitest.js',
    testTimeout: 10000,
  },
});
