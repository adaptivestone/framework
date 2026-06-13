# @adaptivestone/framework

A TypeScript-first, ESM Node.js framework: convention-based controllers and
Mongoose models, a tree-based router with per-controller generated route/handler
types, and batteries-included auth, rate limiting, i18n, and caching.

📖 **Full documentation → https://framework.adaptivestone.com/**

## Requirements

- **Node ≥ 24** (ESM-only, runs `.ts` sources natively)
- **MongoDB** — required; boot fails fast without `MONGO_DSN`
- **`AUTH_SALT`** — required; generate one with `npm run cli generateRandomBytes`

## Install

```sh
npm install @adaptivestone/framework
```

Then follow the [Getting Started guide](https://framework.adaptivestone.com/) to
create your `Server`, controllers, and config.

## Generated types

Run `npm run gen` to (re)generate `genTypes.d.ts` and per-controller
`*.routes.gen.ts` files. They are gitignored — regenerate after pulling. A fresh
checkout is red in the editor until the first generation.

In CI, guard against stale/missing generated types:

```sh
node cliCommand.ts generatetypes --check
```

It writes nothing and exits non-zero if any generated file is out of date.

## Public API & stability

Only the subpaths listed under `exports` in `package.json` are importable as
`@adaptivestone/framework/<path>`; internal modules are intentionally not
exported. Exported paths follow semver in two tiers:

- **Tier 1 — stable:** `server.js`, `Cli.js`, `types.js`, `folderConfig.js`,
  `modules/*`, `models/*`, `controllers/*`, `tests/*`, `migrations/*`.
- **Tier 2 — extension surface:** `helpers/*` and `services/*` — may change in a
  minor (with a deprecation cycle); pin to a minor if you import them directly.

## License

MIT
