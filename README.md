# @adaptivestone/framework

A TypeScript-first, ESM Node.js framework: convention-based controllers and
Mongoose models, a tree-based router with per-controller generated route/handler
types, and batteries-included auth, rate limiting, i18n, and caching.

📖 **Full documentation → https://framework.adaptivestone.com/**

🤖 **LLM-ready docs (whole site as one file) → https://framework.adaptivestone.com/llm-context.md**

## Requirements

- **Node ≥ 24** (ESM-only, runs `.ts` sources natively) — or **Bun ≥ 1.4.0**, see [Runtimes](#runtimes)
- **MongoDB** — required; boot fails fast without `MONGO_DSN`
- **`AUTH_SALT`** — required; generate one with `node src/cli.ts generateRandomBytes`

## Runtimes

Node is the primary runtime. **Bun ≥ 1.4.0** is supported as an additional one:
the same application code, the same Express adapter, running on Bun's Node
compatibility layer — there is no Bun-specific build, no `Bun.serve` path, and
no dependency pin or override needed. 1.4.0 is the floor because it is the first
stable Bun that imports the Mongoose/BSON graph the framework resolves.

Certified on every release, on both the floor and the latest stable Bun: the
framework test suite; and a consumer that installs the published tarball with
`bun install`, imports the public entry points, boots a `Server`, serves a
request, runs Mongoose create/read/update/delete against MongoDB and shuts down.

Node-only, as of Bun 1.4:

- **`cluster.js` / `runCluster`** — the multi-process production entry point. It
  imports fine under Bun, but only the Node path is tested; run single-process
  under Bun (or put the process manager outside the app).
- **Node's test-runner CLI.** Bun implements the `node:test` *API* but not
  `node --test`, so a Bun project runs its suite with `bun test` and the
  framework preloads rather than the flags the Node docs show. Four framework
  test files need `mock.module()` (Node's `--experimental-test-module-mocks`),
  which Bun does not implement ([oven-sh/bun#5090][bun-5090]), and are the only
  thing excluded from the Bun run: `cluster.test.ts`, `models/UserOld.test.ts`,
  `helpers/redis/redisConnection.failure.test.ts`,
  `services/i18n/I18n.missing.test.ts`. Everything else passes on both runtimes.
- **`assert.deepStrictEqual` against a Mongoose array.** Bun 1.4 reports any
  `Proxy` — which is what a Mongoose array is — as unequal. Spread it first
  (`[...doc.tags]`). This is a test-assertion quirk; the values themselves are
  correct.

[bun-5090]: https://github.com/oven-sh/bun/issues/5090

## Quickstart

The fastest way to start is to clone the example project and use it as a
template — it ships a working `Server`, controllers, config, tests, and a Docker
dev stack (MongoDB + Redis included):

```sh
git clone https://github.com/adaptivestone/framework-example-project.git my-app
cd my-app
docker compose up
```

Your app starts at `http://localhost:3300`. Provide an `AUTH_SALT` before first
boot (see Requirements and `.env.example`). Edit a controller under
`src/controllers/` and the dev server reloads automatically. Full walkthrough in
the [Getting Started guide](https://framework.adaptivestone.com/).

To add the framework to an existing project instead:

```sh
npm install @adaptivestone/framework
```

## Generated types

The framework generates `genTypes.d.ts` (typed `getConfig`/`getModel`) and
per-controller `*.routes.gen.ts` files (typed handler signatures). Regenerate
them with:

```sh
node src/cli.ts generatetypes
```

Code generation needs the **optional peer dependency `oxc-parser`** — install it
as a devDependency in your project:

```sh
npm i -D oxc-parser
```

It parses your controller sources and is never loaded at runtime, so it stays
out of production installs (`npm ci --omit=dev`).

They are gitignored — regenerate after pulling (a fresh checkout is red in the
editor until the first run). In CI, guard against stale types with
`node src/cli.ts generatetypes --check`, which writes nothing and exits non-zero
if anything is out of date. The template wires this into its `check:types` script.

Starting with v5.2.0, a fully parenthesized controller-folder segment is an
organizational route group: `src/controllers/(group)/Reports.ts` keeps the
default `/reports` URL, while its generated file remains beside the controller.
Ordinary folders still contribute their lowercased URL segments.

## OpenAPI

Generate an OpenAPI 3.1 document from the same controller routes and request
schemas used at runtime:

```sh
node src/cli.ts openapi --output openapi.json
```

Zod request schemas describe their input shape. An unsupported individual
schema produces a contextual warning and safe fallback without removing healthy
routes from the document. See the full [OpenAPI guide](https://framework.adaptivestone.com/docs/openapi).

## Public API & stability

Only the subpaths listed under `exports` in `package.json` are importable as
`@adaptivestone/framework/<path>`; internal modules are intentionally not
exported. Exported paths follow semver in two tiers:

- **Tier 1 — stable:** `server.js`, `Cli.js`, `cluster.js`, `types.js`,
  `folderConfig.js`, `modules/*`, `models/*`, `controllers/*`, `tests/*`,
  `migrations/*`.
- **Tier 2 — extension surface:** `config/*`, `helpers/*`, and `services/*` — may
  change in a minor (with a deprecation cycle); pin to a minor if you import them
  directly. `config/*` is what you import to extend the framework's default
  config (e.g. `import http from '@adaptivestone/framework/config/http.js'`, then
  re-export an edited copy from your own `src/config/http.ts`).

## License

MIT
