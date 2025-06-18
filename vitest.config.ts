// eslint-disable-next-line import-x/extensions
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './src/tests/globalSetupVitest.ts',
    setupFiles: [
      './src/tests/setupVitest.ts',
      './src/tests/frameworkVitestSetup.ts',
    ],
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
