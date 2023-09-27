// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: './tests/setupVitest.js',
    testTimeout: 10000,
    outputFile: './coverage/rspec.xml',
    reporters: ['default', 'junit'],
    coverage: {
      enabled: true,
      reporter: ['text', 'html', 'clover', 'json', 'cobertura'],
    },
  },
});
