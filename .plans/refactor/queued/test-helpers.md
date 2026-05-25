# P1i — Runner-agnostic test helpers (support `node:test` for consumers)

**Status**: ⏸ deferred to v5.1
**Depends on**: nothing critical — can ship anytime
**Time**: ~½ day
**Origin**: framework currently ships test helpers (`getTestServerURL`, `serverInstance`, etc.) that lean on vitest's globals and lifecycle hooks. Consumers who'd rather use Node's built-in `node:test` (smaller dep tree, native TypeScript, runtime alignment) can't use them directly. Different scope from [`side-test-runner.md`](./side-test-runner.md), which is about migrating the framework's *own* tests.

## Goal

Make the framework's test surface usable from both `vitest` and `node:test`. The helpers themselves carry no runner dependency; setup glue is documented separately for each runner.

## Files touched

- `src/tests/setupVitest.ts` — split: the *vitest-specific* parts (`beforeAll`, `afterEach`) stay here; the *framework setup* (server bootstrap, mongo memory-server lifecycle) moves to a runner-agnostic module.
- New `src/tests/setupFramework.ts` (or similar) — exports `startTestServer()`, `stopTestServer()`, `resetDatabaseBetweenTests()` as plain async functions. No vitest imports.
- New `src/tests/setupNodeTest.ts` — node:test glue that wraps the framework setup with `before`/`after` hooks from `node:test`. Mirrors what `setupVitest.ts` does.
- `src/tests/testHelpers.ts` — already runner-agnostic (`getTestServerURL`, etc.); confirm no implicit vitest dependency.
- `docs/09-testsing.md` — split into two subsections: "Using with vitest" (existing) and "Using with node:test" (new). Sample test file for each.
- `package.json` — `peerDependenciesMeta` so vitest stays optional for consumers using node:test.

## API change

Today (vitest-only consumer):
```ts
// tests/setup.ts
import '@adaptivestone/framework/tests/setupVitest';
```

After (consumer picks one):
```ts
// vitest consumer (unchanged)
import '@adaptivestone/framework/tests/setupVitest';

// node:test consumer (new)
import '@adaptivestone/framework/tests/setupNodeTest';

// programmatic, runner-agnostic (new)
import { startTestServer, stopTestServer } from '@adaptivestone/framework/tests/setupFramework';
```

## Out of scope

- Migrating the framework's own tests — that's [`side-test-runner.md`](./side-test-runner.md), a separate decision.
- Building a custom test runner.
- `expect()` polyfill for node:test. Users adapt to `node:assert/strict`; we don't paper over the difference.

## Done when

- A sample project using `node:test` runs framework-backed integration tests using `setupNodeTest`.
- `setupVitest.ts` consumers see no regression — same tests pass.
- Docs include a copy-paste sample test file for each runner.
- `npm i @adaptivestone/framework` doesn't pull vitest as a transitive (peer-optional).

## Trade-offs

- Two setup files to maintain in lockstep. Mitigation: keep the framework-specific glue in `setupFramework.ts` so the runner files are thin (just `before`/`beforeAll` wrappers).
- Slight surface-area growth for the docs chapter.
