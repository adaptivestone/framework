import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
const localesRoot = path.join(srcRoot, 'locales');

const readCatalog = (locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(path.join(localesRoot, locale, 'translation.json'), 'utf8'),
  );

// The framework namespaces, plus any top-level key a shipped catalog adds.
const NAMESPACES = new Set([
  'auth',
  'email',
  'health',
  'http',
  'middleware',
  'password',
  ...readdirSync(localesRoot).flatMap((locale) =>
    Object.keys(readCatalog(locale)),
  ),
]);

// Every single- or double-quoted literal in a framework namespace, in non-test
// source. Collected from the code, so a key added without translations fails below.
const KEY = new RegExp(
  `(['"])((?:${[...NAMESPACES].join('|')})(?:\\.\\w+)+)\\1`,
  'g',
);
// Comment lines are skipped: they name config paths and files such as
// `auth.scrypt`, `health.token` or `auth.ts`, which are not message keys.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
// Pre-5.4 spelling of `email.greeting`, read only as its fallback.
const DEPRECATED_KEYS = new Set(['email.greeating']);

const frameworkKeys = () => {
  const keys = new Set<string>();
  for (const file of readdirSync(srcRoot, {
    recursive: true,
    encoding: 'utf8',
  })) {
    if (!file.endsWith('.ts') || /\.(test|node-test)\.ts$/.test(file)) {
      continue;
    }
    const code = readFileSync(path.join(srcRoot, file), 'utf8')
      .split('\n')
      .filter((line) => !COMMENT_LINE.test(line))
      .join('\n');
    for (const [, , key] of code.matchAll(KEY)) {
      if (!DEPRECATED_KEYS.has(key)) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
};

const lookup = (catalog: unknown, key: string) =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      catalog,
    );

describe('shipped locale catalogs', () => {
  const keys = frameworkKeys();

  it('finds the framework keys in the source', () => {
    assert.ok(keys.includes('http.notFound'));
    assert.ok(keys.includes('middleware.rateLimiter.tooManyRequests'));
  });

  // `en` is skipped: the English text is the default value at each call site.
  const locales = readdirSync(localesRoot).filter((locale) => locale !== 'en');

  for (const locale of locales) {
    it(`${locale} translates every framework key`, () => {
      const catalog = readCatalog(locale);
      const missing = keys.filter((key) => {
        const text = lookup(catalog, key);
        return typeof text !== 'string' || !text.trim();
      });
      assert.deepStrictEqual(missing, []);
    });
  }
});
