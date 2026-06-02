import { describe, expect, it } from 'vitest';
import { getTemplate } from './appTypes.ts';

/**
 * The config branch of `getTemplate` is pure string templating — it references
 * each config module's type via `import()`, it never imports or serializes the
 * config *values*. These tests pin that contract (no value snapshots → no
 * secret leak, no dropped env-only fields). `modelPaths` is empty so nothing is
 * imported; the config paths need not exist on disk.
 */
describe('appTypes — config type emission', () => {
  const dir = process.cwd();

  it('emits getConfig as a type reference, not a serialized value', async () => {
    const configPaths = new Map<string, Record<string, string>>([
      ['http', { default: `${dir}/src/config/http.ts` }],
    ]);
    const out = await getTemplate(configPaths, []);
    expect(out).toContain(
      "getConfig(configName: 'http'): typeof import('./src/config/http.ts').default;",
    );
  });

  it('intersects NODE_ENV layers as Partial<>', async () => {
    const configPaths = new Map<string, Record<string, string>>([
      [
        'mongo',
        {
          default: `${dir}/src/config/mongo.ts`,
          production: `${dir}/src/config/mongo.production.ts`,
        },
      ],
    ]);
    const out = await getTemplate(configPaths, []);
    expect(out).toContain(
      "getConfig(configName: 'mongo'): typeof import('./src/config/mongo.ts').default" +
        " & Partial<typeof import('./src/config/mongo.production.ts').default>;",
    );
  });

  it('never serializes config values (no inline object literal can leak)', async () => {
    // getTemplate receives paths, not values — a secret in a config object can
    // never be written into genTypes.d.ts. Guard against a regression back to
    // `getConfig(...): { ...value... }`.
    const configPaths = new Map<string, Record<string, string>>([
      ['auth', { default: `${dir}/src/config/auth.ts` }],
    ]);
    const out = await getTemplate(configPaths, []);
    expect(out).not.toMatch(/getConfig\([^)]*\):\s*\{/);
    expect(out).toContain("typeof import('./src/config/auth.ts').default");
  });

  it('falls back to the first layer when there is no default base file', async () => {
    const configPaths = new Map<string, Record<string, string>>([
      ['onlyEnv', { production: `${dir}/src/config/onlyEnv.production.ts` }],
    ]);
    const out = await getTemplate(configPaths, []);
    expect(out).toContain(
      "getConfig(configName: 'onlyEnv'): typeof import('./src/config/onlyEnv.production.ts').default;",
    );
  });
});
