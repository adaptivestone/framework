import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDiagnostics } from './__fixtures__/parseDiagnostics.ts';
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

  it('drops keys whose value is undefined at gen time (no source given)', async () => {
    const out = await get('mongo', { connectionString: undefined, pool: 5 });
    expect(out).toContain(
      `getConfig(configName: 'mongo'): { "pool": number };`,
    );
  });

  it('recovers env-only keys from source when config paths are supplied', async () => {
    // `saltSecret: process.env.AUTH_SALT` is `undefined` at gen time, so the
    // value pass drops it — but the source says it's an env read, so codegen
    // recovers it as `string | undefined` instead of forcing an `as` cast.
    const authSrc = fileURLToPath(
      new URL('../config/auth.ts', import.meta.url),
    );
    const out = await getTemplate(
      new Map<string, unknown>([
        ['auth', { hashRounds: 64, saltSecret: undefined }],
      ]),
      [],
      new Map<string, string[]>([['auth', [authSrc]]]),
    );
    expect(out).toContain('"saltSecret": string | undefined');
    expect(out).toContain('"hashRounds": number');
    // still a type, never the value
    expect(out).not.toContain('AUTH_SALT');
  });

  it('types an env-only key deterministically even when set at gen time', async () => {
    // The whole point of source-based recovery: a bare `process.env.X` is
    // `string | undefined` regardless of whether the var happened to be set
    // when codegen ran — otherwise the emitted type (and `--check`) would drift
    // between machines. So even with a concrete value present, the source wins.
    const authSrc = fileURLToPath(
      new URL('../config/auth.ts', import.meta.url),
    );
    const out = await getTemplate(
      new Map<string, unknown>([
        ['auth', { hashRounds: 64, saltSecret: 'super-secret-from-env' }],
      ]),
      [],
      new Map<string, string[]>([['auth', [authSrc]]]),
    );
    expect(out).toContain('"saltSecret": string | undefined');
    // the concrete secret value is never serialized into the type
    expect(out).not.toContain('super-secret-from-env');
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

  it('renders the remaining scalar value kinds (null, bigint, function)', async () => {
    const out = await get('kinds', {
      n: null,
      big: 10n,
      fn: () => 1,
    });
    expect(out).toContain(
      `getConfig(configName: 'kinds'): { "n": null; "big": bigint; "fn": ((...args: any[]) => any) };`,
    );
  });

  it('keeps an `undefined` element inside a tuple (arrays are not filtered)', async () => {
    const out = await get('tuple', { list: ['a', undefined, 1] });
    expect(out).toContain(
      `getConfig(configName: 'tuple'): { "list": [string, undefined, number] };`,
    );
  });
});

/**
 * `appInfo.user` must follow the project's `User` model (not the framework's)
 * when it's replaced — so codegen emits an `AppModels` augmentation binding
 * `User` to the project model, mirroring how it types `getModel('User')`.
 */
describe('appTypes — appInfo.user binding', () => {
  const userModelPath = fileURLToPath(
    new URL('../models/User.ts', import.meta.url),
  );

  it('emits an AppModels augmentation binding User to the project model', async () => {
    const out = await getTemplate(new Map(), [
      { file: 'User', path: userModelPath },
    ]);
    expect(out).toContain(
      "declare module '@adaptivestone/framework/models/User.js'",
    );
    expect(out).toContain('export interface AppModels {');
    // `appInfo.user` is the hydrated DOCUMENT, so the binding must be wrapped in
    // `InstanceType<…>` — emitting the bare Model class (as `getModel('User')`
    // returns) inverts the type so `user.id` / `user.email` stop type-checking.
    expect(out).toMatch(
      /User: InstanceType<GetModelTypeFromClass<typeof import\('[^']*User[^']*'\)\.default>>/,
    );
  });

  it('emits no AppModels augmentation when there is no User model', async () => {
    const out = await getTemplate(new Map(), []);
    expect(out).not.toContain(
      "declare module '@adaptivestone/framework/models/User.js'",
    );
  });
});

/**
 * Config names, model names, and model relPaths are interpolated into
 * single-quoted TS string literals in the emitted `genTypes.d.ts`. A name or
 * path containing `'` or `\` (both legal in a filename on macOS/Linux) must be
 * escaped — otherwise the literal is unterminated and the consumer's whole
 * typecheck breaks with a confusing parse error (finding #20).
 */
describe('appTypes — name escaping in emitted string literals (finding #20)', () => {
  it('escapes a config name containing an apostrophe or backslash', async () => {
    const out = await getTemplate(
      new Map<string, unknown>([
        ["us'er", { port: 3300 }],
        ['back\\slash', { port: 3300 }],
      ]),
      [],
    );
    expect(out).toContain("getConfig(configName: 'us\\'er')");
    expect(out).toContain("getConfig(configName: 'back\\\\slash')");
    // The emitted module still parses — an unescaped `'` leaves it unterminated.
    expect(parseDiagnostics(out)).toEqual([]);
  });

  it('escapes a model name and relPath containing an apostrophe or backslash', async () => {
    // A path that fails to read (→ non-BaseModel branch) but sits inside cwd so
    // its relative specifier is emitted, carrying both an apostrophe and a
    // backslash into the `import('…')` string literal.
    const weird = path.join(process.cwd(), "src/models/wei'rd\\Model.ts");
    const out = await getTemplate(new Map(), [{ file: "Mo'del", path: weird }]);
    expect(out).toContain("getModel(modelName: 'Mo\\'del')");
    expect(out).toContain("wei\\'rd\\\\Model.ts");
    expect(parseDiagnostics(out)).toEqual([]);
  });
});
