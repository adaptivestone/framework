import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tscPath = fileURLToPath(
  new URL('./bin/tsc', import.meta.resolve('typescript/package.json')),
);

/** Syntactic-only parse gate using the stable TypeScript 7 compiler CLI. */
export function parseDiagnostics(code: string): string[] {
  const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'framework-ts-parse-'));
  const sourcePath = path.join(scratchDir, 'generated.ts');

  try {
    writeFileSync(sourcePath, code);
    const result = spawnSync(
      process.execPath,
      [tscPath, '--ignoreConfig', '--noEmit', '--noCheck', sourcePath],
      { encoding: 'utf8' },
    );

    if (result.error) {
      throw result.error;
    }

    return `${result.stdout}${result.stderr}`
      .trim()
      .split('\n')
      .filter(Boolean);
  } finally {
    rmSync(scratchDir, { recursive: true });
  }
}
