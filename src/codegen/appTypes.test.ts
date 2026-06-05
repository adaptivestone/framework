import { describe, expect, it } from 'vitest';
import { getTemplate } from './appTypes.ts';

/**
 * The config branch of `getTemplate` emits a TypeScript type derived from each
 * config value's *shape* — value types (`string`, `number`), never the literal
 * values. These tests pin that contract: no secret leak, structure-preserving
 * (arrays stay tuples so `Object.values(item)` keeps precise types), and inline
 * (no `import()` to resolve). `modelPaths` is empty so nothing is imported.
 */
describe('appTypes — config type emission (shape-derived)', () => {
  const get = (name: string, value: unknown) =>
    getTemplate(new Map<string, unknown>([[name, value]]), []);

  it('emits value TYPES, never literal values', async () => {
    const out = await get('http', {
      hostname: '0.0.0.0',
      port: 3300,
      cors: true,
    });
    expect(out).toContain(
      `getConfig(configName: 'http'): { "hostname": string; "port": number; "cors": boolean };`,
    );
    // no leaked literal value
    expect(out).not.toContain('0.0.0.0');
    expect(out).not.toContain('3300');
  });

  it('keeps arrays as tuples so per-element types survive (the siteMap regression)', async () => {
    const out = await get('siteMap', {
      domains: [
        { 'insailing.com': 'en' },
        { 'insailing.ru': 'ru' },
        { 'insailing.de': 'de' },
      ],
    });
    expect(out).toContain(
      `getConfig(configName: 'siteMap'): { "domains": [{ "insailing.com": string }, { "insailing.ru": string }, { "insailing.de": string }] };`,
    );
    expect(out).not.toContain("'en'");
    expect(out).not.toContain(': "en"');
  });

  it('drops keys whose value is undefined at gen time', async () => {
    const out = await get('mongo', { connectionString: undefined, pool: 5 });
    expect(out).toContain(
      `getConfig(configName: 'mongo'): { "pool": number };`,
    );
  });

  it('emits no import() — the type is fully inline (compiler-robust)', async () => {
    const out = await get('auth', { secret: 'shh', salt: 10 });
    expect(out).not.toContain('import(');
    expect(out).not.toContain('shh');
  });

  it('handles empty objects / arrays and exotic values', async () => {
    const out = await get('misc', { empty: {}, list: [], when: new Date() });
    expect(out).toContain(
      `getConfig(configName: 'misc'): { "empty": {}; "list": unknown[]; "when": unknown };`,
    );
  });
});
