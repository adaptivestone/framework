import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envShapeToType,
  extractConfigEnvShape,
  mergeEnvShapes,
} from './astConfig.ts';

/**
 * `astConfig` recovers config keys read straight from `process.env` with no
 * default — the value-based pass can't type them (they're `undefined` at gen
 * time). Bare reads → `string | undefined`; reads WITH a default are left to the
 * value pass (it already types them), so they must NOT appear here.
 */
describe('astConfig — env-only key extraction', () => {
  let dir: string;
  const write = async (name: string, src: string) => {
    const p = path.join(dir, name);
    await writeFile(p, src);
    return p;
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'astconfig-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('types a bare `process.env.X` as `string | undefined`', async () => {
    const p = await write(
      'a.ts',
      `export default { connectionString: process.env.MONGO_DSN };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({
      connectionString: 'string | undefined',
    });
  });

  it('handles `process.env["X"]` (computed access) too', async () => {
    const p = await write(
      'b.ts',
      `export default { apiKey: process.env['HUBSPOT_API_KEY'] };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({
      apiKey: 'string | undefined',
    });
  });

  it('leaves keys WITH a default to the value pass (not env-typed)', async () => {
    const p = await write(
      'c.ts',
      `export default {
        url: process.env.REDIS_URI || 'redis://localhost',
        port: Number(process.env.PORT),
        plain: 'hi',
        n: 5,
      };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({});
  });

  it('treats `process.env.X!` as asserted `string`', async () => {
    const p = await write('d.ts', `export default { s: process.env.SECRET! };`);
    expect(await extractConfigEnvShape(p)).toEqual({ s: 'string' });
  });

  it('recurses into nested objects, keeping only env keys', async () => {
    const p = await write(
      'e.ts',
      `export default {
        hubspot: { apiKey: process.env.HUBSPOT, base: 'https://api' },
        empty: { a: 1, b: 'x' },
      };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({
      hubspot: { apiKey: 'string | undefined' },
    });
  });

  it('resolves `export default <ident>` and `as const` wrappers', async () => {
    const p = await write(
      'f.ts',
      `const cfg = { token: process.env.TOK } as const;\nexport default cfg;`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({
      token: 'string | undefined',
    });
  });

  it('returns {} for an unreadable / unparsable file', async () => {
    expect(await extractConfigEnvShape(path.join(dir, 'nope.ts'))).toEqual({});
  });

  it('skips spread elements and methods, keeps sibling env reads', async () => {
    const p = await write(
      'g.ts',
      `export default {
        ...base,
        helper() { return 1; },
        apiKey: process.env.KEY,
      };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({
      apiKey: 'string | undefined',
    });
  });

  it('recognizes string-literal property keys', async () => {
    const p = await write(
      'h.ts',
      `export default { 'api-key': process.env.KEY };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({
      'api-key': 'string | undefined',
    });
  });

  it('skips computed (non-literal) keys', async () => {
    const p = await write(
      'i.ts',
      `const k = 'dynamic';\nexport default { [k]: process.env.KEY };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({});
  });

  it('returns {} when there is no default export', async () => {
    const p = await write(
      'j.ts',
      `export const config = { token: process.env.TOK };`,
    );
    expect(await extractConfigEnvShape(p)).toEqual({});
  });

  it('returns {} when the default export is not an object', async () => {
    // a function declaration default
    const fn = await write('k.ts', `export default function make() {};`);
    expect(await extractConfigEnvShape(fn)).toEqual({});
    // an identifier resolving to a non-object init
    const ident = await write(
      'l.ts',
      `const factory = () => ({ token: process.env.TOK });\nexport default factory;`,
    );
    expect(await extractConfigEnvShape(ident)).toEqual({});
    // an identifier that can't be resolved to a local var (imported)
    const imported = await write(
      'm.ts',
      `import cfg from './base.js';\nexport default cfg;`,
    );
    expect(await extractConfigEnvShape(imported)).toEqual({});
  });
});

describe('astConfig — merge + render helpers', () => {
  it('merges shapes with later sources winning, nested merged key-wise', () => {
    const merged = mergeEnvShapes([
      { a: 'string | undefined', nested: { x: 'string | undefined' } },
      { b: 'string', nested: { y: 'string' } },
    ]);
    expect(merged).toEqual({
      a: 'string | undefined',
      b: 'string',
      nested: { x: 'string | undefined', y: 'string' },
    });
  });

  it('renders a shape to a TS type literal', () => {
    expect(
      envShapeToType({ apiKey: 'string | undefined', nest: { t: 'string' } }),
    ).toBe(`{ "apiKey": string | undefined; "nest": { "t": string } }`);
  });
});
