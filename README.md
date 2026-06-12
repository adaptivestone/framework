# Adaptive stone node js framework

[https://framework.adaptivestone.com/](https://framework.adaptivestone.com/)

A TypeScript-first Node.js framework: convention-based controllers and Mongoose
models, a tree-based router with per-controller generated route/handler types,
and batteries-included auth, rate limiting, i18n, and caching.

**Requirements:** Node ≥ 24, MongoDB, and an `AUTH_SALT` (boot fails fast without
them — see "Configuration & boot requirements" below). Run `npm run gen` before
typechecking; a fresh checkout is red in the editor until the first generation.
The full guide lives at the docs site linked above.

## Generated types

Run `npm run gen` to (re)generate `genTypes.d.ts` and per-controller
`*.routes.gen.ts` files. These are gitignored; regenerate them after pulling.

In CI, guard against stale/missing generated types with:

```sh
node cliCommand.ts generatetypes --check
```

It writes nothing and exits non-zero if any generated file is out of date.

## Configuration & boot requirements

The framework **requires Mongo** and an **`AUTH_SALT`**. Boot fails fast (rather
than limping into request-time 500s) when either is missing:

- No `MONGO_DSN` → boot throws "No Mongo connection configured".
- No `AUTH_SALT` → boot throws with a hint (`npm run cli generateRandomBytes`).

To **replace or disable** any built-in controller (auth or otherwise), shadow it
by filename: create a controller of the same filename in your controllers folder
(e.g. `controllers/Auth.js`) — your version wins. An empty class disables it.

## Public API & stability

Only the subpaths listed under `exports` in `package.json` are importable as
`@adaptivestone/framework/<path>`. Internal modules (`codegen/*`, `commands/*`,
`config/*`, `locales/*`, the top-level entry files) are intentionally **not**
exported and may be renamed without a major bump. The CLI loads commands and
migrations by filesystem path, so leaving `commands/*` unexported does not affect
`npm run cli`.

Exported paths follow semver, in two tiers:

- **Tier 1 — stable.** `server.js`, `Cli.js`, `types.js`, `folderConfig.js`,
  `modules/*`, `models/*`, `controllers/*`, `tests/*`, `migrations/*`. Breaking
  changes only on a major.
- **Tier 2 — extension surface.** `helpers/*` and `services/*` (including
  `services/http/routing/*` and the middleware classes). Exported so codegen and
  advanced extensions can reach them, but they **may change in a minor** with a
  deprecation cycle — pin to a minor if you import them directly.
