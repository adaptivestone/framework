// eslint-disable-next-line import-x/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './tests/globalSetupVitest.js',
    setupFiles: './tests/setupVitest.js',
    testTimeout: 10000,
    outputFile: './coverage/rspec.xml',
    reporters: ['default', 'junit'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html', 'clover', 'json', 'cobertura'],
    },
  },
});
