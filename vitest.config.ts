// eslint-disable-next-line import-x/no-unresolved, import-x/extensions
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './src/tests/globalSetupVitest.js',
    setupFiles: './src/tests/setupVitest.js',
    testTimeout: 10000,
    outputFile: './coverage/junit.rspec.xml',
    reporters: ['default', 'junit'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html', 'clover', 'json'],
    },
  },
});
