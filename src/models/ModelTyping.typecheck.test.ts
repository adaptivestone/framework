/**
 * tsc-gate for the model-typing guarantees that keep a consuming project's
 * call sites cast-free.
 *
 * Vitest strips types (never type-checks), and `check:types` excludes
 * `*.test.ts` — so a type-level guarantee can only be enforced by shelling out
 * to a real `tsc`. This compiles the whole `__fixtures__` dir, each file
 * pinning one fix:
 *  - `customUserModel.ts`  — `User` auth statics/methods reused on *customized*
 *    models (additive `extends` + divergent compose) with no `this` casts,
 *    including Mongoose 9.8.1's typed `Model.schema` surface;
 *  - `tsTypeOverride.ts`   — per-field `__tsType` overrides for plugin-reshaped
 *    fields applied at every depth;
 *  - `instanceMethodThis.ts` — instance methods with an authored narrow `this`
 *    callable as `doc.method(...)` (caller-facing `this` stripped);
 *  - `populatedRefOverride.ts` — the documented populate-ref pattern: a ref
 *    marked `TsTypeOverride<ObjectId | PopulatedDoc>` resolves to that union and
 *    narrows without a cast;
 *  - `modelSurface.ts` — the full model surface (find/findOne/findById/lean/
 *    create shapes, custom statics, virtuals as a clean getter return, instance
 *    methods, and array + complex field types: enum, ref arrays, subdoc arrays,
 *    Map, nested);
 *  - `liteModelType.ts` — the reduced schema-derived authoring model as a
 *    `this:` context in statics / instance methods / `initHooks`, including
 *    native Mongoose read/write/aggregate/populate operations and custom schema
 *    options;
 *  - `schemaLevelLean.ts` — literal and object-form schema-level lean defaults
 *    return plain objects from both model helpers, while `{ lean: false }`
 *    restores hydrated documents;
 *  - `readonlySchemaInference.ts` — `as const` schemas keep required-message
 *    tuples and ordinary arrays non-null while explicit optional/default-null
 *    paths remain optional;
 *  - `schemaInstance.ts` — a pre-built mongoose `Schema` instance reused as a
 *    (sub-)doc def (`field: Sub` / `[Sub]`) stays opaque to the override scan
 *    (rc.8 regression: it triggered a TS2615 circular mapped type).
 *  - `nestedWorkflowModelPatterns.ts` — required-message paths, nested
 *    generated-id documents, projections, `$locals`, model recovery, and
 *    document/query hooks;
 *  - `tenantScopedModelPatterns.ts` — schema fragments, query/aggregate
 *    scoping, nested `type` fields, validation hooks, Mixed values, and
 *    created-only timestamps;
 *  - `pluginExtendedModelPatterns.ts` — nested type overrides and refs,
 *    virtual/doc bridges, aggregate facets, preload maps, `$locals`, and typed
 *    `$model<T>()`.
 *
 * They must compile cleanly. A regression in the structural contracts re-pins a
 * helper or re-surfaces a narrow `this`, those calls fail with TS2684, and this
 * test goes red — guarding the migration's most-repeated casts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const fixturesTsconfig = path.join(here, '__fixtures__', 'tsconfig.json');

describe('Model typing — compile-time fixture gate', () => {
  it('type-checks schema-derived and class-derived model contracts', () => {
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
