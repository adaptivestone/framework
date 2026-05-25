# Side — Replace vitest with `node:test`

**Status**: ⏸ deferred (live decision; technical blockers resolved as of Node 25/26)
**Depends on**: P1d (initial scope green and stable)
**Unblocks**: nothing
**Schedule**: after P1d, alongside or just before P2a — when there's a natural lull and no other phase is mid-flight

## Goal

Drop `vitest` + `@vitest/coverage-v8` in favor of Node's built-in `node:test` runner and native test coverage.

## Why now (vs. earlier in 2026)

The argument for waiting was:
- `mock.module()` was experimental — needed for the `whenReady` parity test in P1a-runtime and the `ValidationError` parity test in P1b.
- Native TypeScript type-stripping was still being refined.

Both shipped stable in Node 25/26. The remaining trade-offs are no longer technical:
- Migration cost is mechanical (~20-30 test files).
- `node:assert/strict` vs vitest `expect()` is a DX preference, not a capability gap.
- Watch mode polish and `vitest --ui` are real losses, but dev-only.

## What you gain

- **−2 devDeps** (`vitest`, `@vitest/coverage-v8`) — ~5 MB in `node_modules`, ~1-3 s less CI cold-start.
- **Native TypeScript** — `node --test src/**/*.test.ts` runs without `tsx` or a transpiler. No `vitest.config.ts` to maintain.
- **Runtime alignment** — tests run on exactly the runtime the framework targets. Catches Node-version-specific issues that vitest's bundled environment can mask.
- **Philosophical fit** — the refactor's whole direction is "fewer deps, native runtime, no magic." `node:test` is the same ethos.

## What you lose

- **`expect()` ergonomics** — `toMatchObject`, `toHaveBeenCalledWith`, etc. Tests get more verbose with `assert.deepStrictEqual` / `assert.match`.
- **Mocking conventions** — `vi.mock`, `vi.spyOn`, `vi.fn` → `mock.module`, `mock.method`, `mock.fn`. API is comparable but call sites change.
- **Watch-mode polish** — vitest's smart re-run (only affected tests) is better than `node --watch --test`'s "re-run everything on change."
- **`vitest --ui`** for interactive debugging.
- **Snapshot testing** — Node has it (since v22) but the API is bare-bones vs. vitest's resolver / inline snapshots. We don't currently use snapshots, but the codegen golden-fixture pattern in P1a-codegen could benefit.
- **Type-level tests** — for `tests/types/*.test-d.ts` (P0), `@vitest/expect-type` becomes irrelevant. Use `tsd` as a separate runner; one extra tool but it works fine.

## Files touched

- `package.json` — remove `vitest`, `@vitest/coverage-v8`; add `tsd` if needed for type tests; replace `"test": "vitest run"` with `"test": "node --test --experimental-test-coverage 'src/**/*.test.ts'"`; update `"t"` script accordingly.
- `vitest.config.ts` — delete.
- All `*.test.ts` and `*.test.js` files (~20-30) — convert imports and assertions.
- `.gitignore` — remove `.vitest`/coverage cache patterns; add `coverage/` if it isn't there.
- CI workflow files (if `vitest run` is referenced).
- `lefthook.yml` — update test hook command.

## Migration sketch (per file)

```ts
// Before
import { describe, expect, it } from 'vitest';
describe('Cache', () => {
  it('caches values', async () => {
    expect(await cache.get('k')).toBe('v');
    expect(spy).toHaveBeenCalledWith('k');
  });
});

// After
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
describe('Cache', () => {
  it('caches values', async () => {
    assert.equal(await cache.get('k'), 'v');
    assert.equal(spy.mock.calls.length, 1);
    assert.deepEqual(spy.mock.calls[0].arguments, ['k']);
  });
});
```

Module mocking:
```ts
// Before
import { vi } from 'vitest';
vi.mock('yup', () => ({ ...realYup, /* spies */ }));

// After
import { mock } from 'node:test';
mock.module('yup', { defaultExport: yupStub /* etc. */ });
```

## Migration order

1. **Convert one self-contained file as proof** — `Cache.test.ts` is small, has clear assertions, no module mocking. Validates the pattern.
2. **Delete `vitest.config.ts`** and verify `node --test` against the converted file works without it.
3. **Convert remaining files in batches** — group by area (services/, controllers/, models/) so review is easier.
4. **Convert `whenReady` and `ValidationError` parity tests using `mock.module`** — these are the trickier conversions; do them last when the pattern is settled.
5. **Drop devDeps**, update CI, update `lefthook.yml`.
6. **Bump engines** if Node 26 is LTS by then (October 2026): `package.json:6` `>=24.0.0` → `>=26.0.0`.

## Test plan

- ☐ Single converted file passes under `node --test`.
- ☐ Coverage report (`--experimental-test-coverage`) produces output comparable to `@vitest/coverage-v8` (line/branch percentages within 5% of pre-migration).
- ☐ All converted files green; full `npm test` passes.
- ☐ CI cold-start time measurably reduced (compare against `bench/baseline.json`-style snapshot).
- ☐ `lefthook.yml` pre-commit test step fires correctly.
- ☐ `npm uninstall vitest @vitest/coverage-v8` followed by `npm test` works (no leftover vitest references).

## Out of scope until activated

- Anything in the initial-scope refactor (P−1 → P1d).
- Type-level test framework choice — separate decision; `tsd` is the natural pick for native, but defer until type tests actually exist (P0 introduces them).
- Test-app integration (`createTestApp` from P2a) — must be runner-agnostic; design it that way regardless of which runner wins.

## Done when

`grep -r "from 'vitest'"` in the repo returns zero matches; `vitest` and `@vitest/coverage-v8` are out of `package.json`; `npm test` passes; CI green; coverage delta within 5% of pre-migration.

## Notes

- Verify `mock.module()` is fully stable (no `--experimental-vm-modules` or similar flag) at the time of kickoff. The plan assumes Node 25+ has stabilized it; check release notes before committing the migration PR.
- vitest's `--ui` flag is irreplaceable in `node:test`. If anyone on the team relies on it heavily, consider keeping vitest as a dev-only transitive (it can coexist for one release while people get used to native).
- `mongodb-memory-server` is runner-agnostic — no integration changes needed.
- The framework's published `bin` (the `framework gen` CLI from P1a-codegen) is independent of test runner — no impact.
