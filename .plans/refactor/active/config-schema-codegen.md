# P1l — Config codegen: type references, not value snapshots

**Status**: ✅ implemented (2026-06-01, beta — pending commit). Verified: 4 unit tests, `tsc` clean, real `npm run gen` emits type references, `server.ts` reads `getConfig('mongo').connectionString` (env-only) and compiles.
**Depends on**: nothing (self-contained appTypes change)
**Relates to**: [P1j](codegen-zero-init.md) Phase 3 (same file, `appTypes.ts`; model branch ↔ config branch)
**Time**: ~½ day
**Origin**: 2026-06-01 review of `appTypes.ts` — config types are emitted by serializing live runtime values; a design smell with two failure modes.

## Problem

`appTypes.ts` emits `getConfig()` overloads by `JSON.stringify`-ing the **resolved runtime value** of each config:

```ts
`getConfig(configName: '${name}'): ${JSON.stringify(value, null, 6)};`
```

`value` is the deep-merged live object (`server.ts` `#initConfigFiles` → `loadConfig`), every field already evaluated — including `process.env.*` reads. That produces three bugs:

| Config field | At gen time | Emitted type | Bug |
|---|---|---|---|
| `host: 'localhost'` | `'localhost'` | `"localhost"` | over-narrow **literal** (should be `string`) |
| `port: process.env.PORT \|\| 3000` | `3000` | `3000` | literal narrowing |
| `apiSecret: process.env.API_SECRET` | `undefined` | *(key dropped)* | **field silently vanishes** — `JSON.stringify` omits `undefined` keys |

And the only way to stop an env-only field vanishing is to populate the env var at gen time — which bakes the **secret value** into the committed `genTypes.d.ts`. Vanish or leak; no safe choice.

## Fix — mirror the model branch

The model branch of the same function already does the right thing: it references the module type (`typeof import('…').default`), never a value. Make config consistent.

```ts
// before: a value snapshot
getConfig(configName: 'http'): { "port": 3300, "hostname": "0.0.0.0", … };

// after: a type reference (shape, not values)
getConfig(configName: 'http'): typeof import('./src/config/http.ts').default
  & Partial<typeof import('./src/config/http.production.ts').default>;
```

This dissolves all three bugs:
- **No leak possible** — types only; zero values in the file.
- **Env fields stay** — TS types `process.env.X` as `string | undefined`, so the field is present and correctly optional.
- **No literal narrowing** — `process.env.PORT || 3000` infers `string | number`, not `3000`.

### The merge

Post-inheritance (`getFilesPathWithInheritance`) a project config file **wholesale-replaces** the framework one, so a config name resolves to **one base file + optional `NODE_ENV` layer(s)**. Emit the base as a required type-reference and every other layer as `& Partial<typeof import(layer).default>` — intersection over-approximates deepmerge but captures the shape faithfully, and is `NODE_ENV`-independent (all discovered layers included, not just the active one).

## Plumbing

Codegen currently only receives merged *values* (`cache.configs`); the loader discards the file *paths* after merging. To emit type references we cache the paths, mirroring `cache.modelPaths`:

| File | Change |
|---|---|
| `src/server.ts` | `AppCache.configPaths: Map<string, Record<string, string>>`; init in cache literal; populate from `configFiles` in `#initConfigFiles`. `cache.configs` (values) untouched — runtime `getConfig` still needs it. |
| `src/codegen/appTypes.ts` | `getTemplate` takes `configPaths` instead of `configs`; config branch emits `typeof import(base).default & Partial<…>` per layer; `generateAppTypes` passes `app.internalFilesCache.configPaths`. |
| `src/codegen/appTypes.test.ts` | NEW — unit test of the config branch (pure string templating; `modelPaths: []` so no model imports). Asserts type-reference output + `Partial<>` env layer; asserts no `JSON`-value snapshot. |
| `CHANGELOG.md` | entry under `[5.0.0-next]`. |

## Done when

- `getConfig('x')` returns the config module's **inferred type**, not a value snapshot.
- An env-only field (no `||` default) is present in the generated type (not dropped), and no secret value appears in `genTypes.d.ts`.
- `npx vitest run src/codegen/appTypes.test.ts` green; `tsc --noEmit` clean; full suite unchanged (minus pre-existing redis-env flakes).

## Out of scope

- Removing config-file `import()` at gen time entirely — `configPaths` is derivable from a pure directory scan (no module evaluation), which would feed [P1j](codegen-zero-init.md)'s zero-init goal. Left as a follow-up; this change is value-coupling removal only.
- Validating config against a declared schema at boot (a larger "config schema" feature). This is type-shape only.
