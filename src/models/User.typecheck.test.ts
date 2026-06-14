/**
 * tsc-gate for the `User` auth helpers' structural typing.
 *
 * Vitest strips types (never type-checks), and `check:types` excludes
 * `*.test.ts` — so a type-level guarantee can only be enforced by shelling out
 * to a real `tsc`. This compiles `__fixtures__/customUserModel.ts`, which calls
 * the framework's `getUserByEmailAndPassword` / `generateToken` / `getPublic` /
 * … on *customized* `User` models (additive `extends` + divergent compose).
 *
 * It must compile cleanly. If `UserAuthDoc` / `UserAuthModel` ever re-pin the
 * helpers to the framework's own schema, those calls fail with TS2684 and this
 * test goes red — guarding the fix for the migration's most-repeated cast.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const fixturesTsconfig = path.join(here, '__fixtures__', 'tsconfig.json');

describe('User auth helpers — customized-model type gate', () => {
  it('type-checks reuse of the auth statics/methods on a customized User', () => {
    const tsc = path.join(repoRoot, 'node_modules/.bin/tsc');
    let ok = true;
    let output = '';
    try {
      execFileSync(tsc, ['--noEmit', '-p', fixturesTsconfig], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      output = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
      ok = false;
    }
    expect(output).toBe('');
    expect(ok).toBe(true);
    // Generous ceiling (CPU-bound, synchronous tsc contends with parallel
    // workers); a real regression fails fast with TS errors.
  }, 240_000);
});
