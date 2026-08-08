/**
 * Lazy, optional binding to `oxc-parser`.
 *
 * `oxc-parser` is a **native (napi) package used only by code generation** —
 * `astExtract` and `astConfig` are its sole importers, and both are reachable
 * only through the `generatetypes` CLI command. Keeping it an optional peer
 * keeps ~3 MB of platform binaries out of every consumer's production install,
 * where it is never loaded. Same treatment as `@redis/client` and `yup`; the
 * packaging smoke test asserts it stays absent.
 *
 * `createRequire` rather than `await import()`: the extractor entry point
 * (`extractController`) is synchronous and called from synchronous code, so an
 * async load would ripple a signature change through the whole codegen front
 * end to buy nothing. Node resolves `require()` of an ESM package from 22.12
 * onward, and the framework's floor is 24.
 */

import { createRequire } from 'node:module';

/**
 * The slice of oxc's result the codegen front end reads. Declared structurally
 * rather than imported from `oxc-parser`, so no generated `.d.ts` references a
 * package that may not be installed. Nothing is lost: the extractor already
 * walks the ESTree program untyped (`type Node = any`).
 */
export interface ParseResult {
  // biome-ignore lint/suspicious/noExplicitAny: untyped ESTree program from the parser
  program: any;
  errors: { message: string }[];
}

type ParseSync = (fileName: string, source: string) => ParseResult;

let parseSync: ParseSync | null = null;

/**
 * Parse a source file, loading the parser on first use.
 *
 * @throws when `oxc-parser` is not installed — with the install command, since
 * this is only ever reached from code generation and the fix is one line.
 */
export function parseSource(fileName: string, source: string): ParseResult {
  if (!parseSync) {
    const require = createRequire(import.meta.url);
    try {
      ({ parseSync } = require('oxc-parser') as { parseSync: ParseSync });
    } catch (cause) {
      throw new Error(
        'Code generation requires the optional peer dependency `oxc-parser`, which is not installed. ' +
          'Add it as a devDependency:\n\n  npm i -D oxc-parser\n\n' +
          'It is needed only to run `generatetypes`; the framework never loads it at runtime.',
        { cause },
      );
    }
  }
  return parseSync(fileName, source);
}
