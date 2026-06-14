import { coverageConfigDefaults, defineConfig } from 'vitest/config';

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
      // `src/tests/**` is test scaffolding (fixtures, helpers, vitest setup),
      // not the framework under test — measuring it just adds noise (e.g. a
      // fixture middleware's unused `next()` looking like a real gap).
      exclude: [...coverageConfigDefaults.exclude, 'src/tests/**'],
    },
  },
});
