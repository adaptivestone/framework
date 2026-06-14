# @adaptivestone/framework

A TypeScript-first, ESM Node.js framework: convention-based controllers and
Mongoose models, a tree-based router with per-controller generated route/handler
types, and batteries-included auth, rate limiting, i18n, and caching.

📖 **Full documentation → https://framework.adaptivestone.com/**

🤖 **LLM-ready docs (whole site as one file) → https://framework.adaptivestone.com/llm-context.md**

## Requirements

- **Node ≥ 24** (ESM-only, runs `.ts` sources natively)
- **MongoDB** — required; boot fails fast without `MONGO_DSN`
- **`AUTH_SALT`** — required; generate one with `node src/cli.ts generateRandomBytes`

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

They are gitignored — regenerate after pulling (a fresh checkout is red in the
editor until the first run). In CI, guard against stale types with
`node src/cli.ts generatetypes --check`, which writes nothing and exits non-zero
if anything is out of date. The template wires this into its `check:types` script.

## Public API & stability

Only the subpaths listed under `exports` in `package.json` are importable as
`@adaptivestone/framework/<path>`; internal modules are intentionally not
exported. Exported paths follow semver in two tiers:

- **Tier 1 — stable:** `server.js`, `Cli.js`, `types.js`, `folderConfig.js`,
  `modules/*`, `models/*`, `controllers/*`, `tests/*`, `migrations/*`.
- **Tier 2 — extension surface:** `config/*`, `helpers/*`, and `services/*` — may
  change in a minor (with a deprecation cycle); pin to a minor if you import them
  directly. `config/*` is what you import to extend the framework's default
  config (e.g. `import http from '@adaptivestone/framework/config/http.js'`, then
  re-export an edited copy from your own `src/config/http.ts`).

## License

MIT
