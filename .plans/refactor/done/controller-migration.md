# P1d — Migrate `Home` and `SomeController`

**Status**: ✅ shipped (2026-05-10)
**Depends on**: P1b (ships the registry-walking codegen that supersedes P1a-codegen's MVP)
**Unblocks**: nothing (terminal initial-scope task)

## What shipped (2026-05-10)

- Both `Home` and `SomeController` translate cleanly through the new `RouteRegistry`.
- `SomeController.ts` PUT `/putInfo` route uncommented — previously relied on Express's middleware-only-route quirk (a registered middleware without a handler), which doesn't fit the tree model. Test intent preserved by adding the handler.
- Codegen runs against both via the registry; gen files (`Auth.routes.gen.ts`, `Home.routes.gen.ts`) are gitignored — regenerated locally on `npm run gen`. `SomeController` is a test fixture; it doesn't need a gen file.
**Time**: ~½ day

## Goal

Bring the other two existing controllers onto the new typed-codegen pattern. After this phase, the framework's own controllers all use `<MethodName>Request` annotations and zero manual handler-side type duplication.

## Files touched

- `src/controllers/Home.ts` — keep the existing `getHttpPath() { return '/'; }` override (no change). Migrate handler signatures to `<MethodName>Request` aliases (if any inline types remain).
- `src/controllers/Home.routes.gen.d.ts` (new, AUTOGEN).
- `src/controllers/test/SomeController.ts` — migrate handler signatures. The `static get middleware()` Map at lines 163-167 stays as-is — the new codegen reads from the `RouteRegistry` (middleware already composed by `translateController` at boot), so the Map's path/method scoping is handled before codegen ever sees it.
- `src/controllers/test/SomeController.routes.gen.d.ts` (new, AUTOGEN).

## API change

```ts
// Home.ts (unchanged)
class Home extends AbstractController {
  get routes() { return { get: { '/': this.getHome } }; }
  getHttpPath() { return '/'; }
}
```

Handler signatures move from manual intersections to per-handler aliases:

```ts
// Before
async getSomething(req: FrameworkRequest & { appInfo: { request: { ... } } }, res: Response) { ... }

// After
import type { GetSomethingRequest } from './SomeController.routes.gen.js';
async getSomething(req: GetSomethingRequest, res: Response) { ... }
```

## Test plan

- ☐ `npm run gen` regenerates without errors.
- ☐ `npm run test` green — `Home.test.ts` and `SomeController.test.ts` pass.
- ☐ The emitted `SomeController.routes.gen.d.ts` shows path/method-scoped middlewares correctly resolved per route (e.g. routes that match `'PATCH/userAvatar'` carry `[GetUserByToken, AuthMiddleware]`; routes that match `'PUT/{*splat}'` carry `[[RoleMiddleware, { roles: ['client'] }]]`).
- ☐ `Home.ts` runtime URL is `/` (not `/home`) — verified by hitting `GET /` in the dev server.

## Out of scope

- Adding new routes / new behavior.
- Refactoring controller method bodies (annotation-only migration).

## Done when

All three controllers (`Auth`, `Home`, `SomeController`) use codegen-driven types. `getHttpPath()` overrides stay as-is.

## Notes

- This phase exists separately from P1a-codegen because P1a-codegen targets *one* controller (`Auth`) as the proof; P1d shows the migration scales without surprises. Splitting them lets P1a-codegen finish faster and lets `Home`/`SomeController` slip if needed.
- P1d now depends on P1b's codegen rewrite shipping first — the original P1a-codegen MVP's parser-based approach was replaced by registry-walking in P1b. Gen file extension is `.gen.d.ts`, not `.gen.ts`.
