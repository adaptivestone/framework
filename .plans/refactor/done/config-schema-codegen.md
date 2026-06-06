# P1l — Config codegen: value-shape types, not literals or import-references

**Status**: ✅ implemented (shape-derived form, 2026-06-05). Verified: 5 unit tests, `tsc` clean, real `npm run gen` emits value-shape types, and the insailing regression (below) reproduced + fixed end-to-end in its Docker/CI container.
**Depends on**: nothing (self-contained `appTypes.ts` change)
**Relates to**: [P1j](codegen-zero-init.md) Phase 3 (same file)
**Time**: ~1 day (incl. a reverted first attempt)
**Origin**: 2026-06-01 review of `appTypes.ts` — config types were emitted by `JSON.stringify`-ing live runtime values; a design smell with three failure modes (below).

## Problem (original)

`appTypes.ts` emitted `getConfig()` overloads by `JSON.stringify`-ing the **resolved runtime value** — every field already evaluated, including `process.env.*`:

| Config field | At gen time | Emitted type | Bug |
|---|---|---|---|
| `host: 'localhost'` | `'localhost'` | `"localhost"` | over-narrow **literal** |
| `port: process.env.PORT \|\| 3000` | `3000` | `3000` | literal narrowing |
| `apiSecret: process.env.API_SECRET` | a real value | `"sk-live-…"` | **secret value baked into the file** |

## First attempt (REVERTED) — `typeof import()` references

Emitted `getConfig('http'): typeof import('./src/config/http.ts').default`. Solved the leak/narrowing, but **regressed a real consumer (insailing)** and was reverted:

- TS infers an array config value's element type as a **union with `?: undefined` keys** (`{ 'a': string; 'b'?: undefined } | …`). That breaks `Object.values(item)` → it widens to `any` (TS7053 downstream). The old value-snapshot kept clean per-element tuple types, so this worked before. → a genuine regression.
- The `import()` reference also depends on the consumer resolving `import('./config/foo.ts')` inside a `declare module` augmentation — fragile across module settings and **preview compilers** (older `tsgo` builds resolved it to `any`).
- It only surfaced on **CI**: insailing type-checks with `tsgo`, whose mac binary was broken locally (so `check:types` never ran locally), while GitHub Actions on Linux ran it and caught the error.

## Fix (shipped) — inline value-**shape** types

Walk the resolved config **value** and emit its structure with value *types* (`string`, `number`), never the literals, never an `import()`:

```ts
// value: { domains: [ { 'insailing.com': 'en' }, … ] }
getConfig(configName: 'siteMap'): { "domains": [{ "insailing.com": string }, { "insailing.ru": string }, { "insailing.de": string }] };
```

- **No leak** — value *types*, not values.
- **No literal narrowing** — `string`, not `"localhost"`.
- **Inline** — no module resolution, so it can't degrade to `any` on any compiler/preview.
- **Structure-preserving** — arrays stay **tuples**, so `Object.values(config.list[0])` keeps precise per-element types (the regression fix, validated in the container).

Trade-off carried over from the original: an `undefined`-valued key at gen time is **dropped** (no knowable type) — the long-standing behavior consumers already tolerated.

## Plumbing

| File | Change |
|---|---|
| `src/codegen/appTypes.ts` | `getTemplate(configs, modelPaths)` reads `cache.configs` (values); new `valueToTypeString(value)` recursively renders the value-shape type (objects → `{ "k": T }`, arrays → tuples, scalars → their type, exotic → `unknown`, `undefined` keys dropped). |
| `src/codegen/appTypes.test.ts` | 5 unit tests: value-types-not-literals, array-stays-tuple (the siteMap case), undefined-key dropped, no `import()`, exotic/empty handling. |
| `src/server.ts` | reverted the first attempt's `configPaths` cache field + population (unused again). |
| `CHANGELOG.md` | `[FIX]` entry (value-shape form). |

## Done when

- `getConfig('x')` returns a value-shape type — no literal values, no `import()`, arrays as tuples.
- `npx vitest run src/codegen/appTypes.test.ts` green; `tsc` clean; insailing `Object.values(domains[0])` resolves to `string` (not `any`).

## Out of scope

- Declared config schemas / runtime validation (a larger feature). This is type-shape only.
