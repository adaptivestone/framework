/**
 * Shared path helpers for codegen. Extracted so the extends-walk (`astResolve`),
 * the model probe (`astModel`), and the emitter (`emit`) don't each carry their
 * own copy of the same path math (they had drifted).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/** A TS-style relative specifier from `fromDir` to `toFile` (forward slashes). */
export function relativeImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile);
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel.split(path.sep).join('/');
}

/** Probe `.ts` / `.js` / `index.*` for a relative specifier; `null` if none exist. */
export function resolveRelativeFile(
  fromDir: string,
  spec: string,
): string | null {
  const stripped = spec.replace(/\.[jt]s$/, '');
  const candidates = [
    ...['.ts', '.js'].map((ext) => path.resolve(fromDir, `${stripped}${ext}`)),
    ...['index.ts', 'index.js'].map((i) => path.resolve(fromDir, stripped, i)),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}
