# Request-context survey (2026-10-31)

Input for [async-middleware D2](../queued/async-middleware.md): what the per-request context of
established frameworks contains, so the v2 middleware `ctx` behaves like a proper framework
context. Four research passes over current official docs (read from the projects' doc sources on
GitHub and their published types where doc hosts were blocked). `[u]` = not confirmed on a current
official page.

Versions checked: Hono 4.13 (5.0 rc), h3 2.0.8, Elysia 1.4 (2.0 rc), Cloudflare Workers
(workers-types 2026-10-31), Bun 1.4.4, Deno 2.9; Koa 3.2, Fastify 5.12, Express 5.3, NestJS 12.3,
AdonisJS 7.6, Encore.ts 1.58; SvelteKit 3.1, Astro 7.4, Next.js 16.4, React Router 8.5, Fresh 2.3,
TanStack Start 1.169; ASP.NET Core 10, Plug 1.19, Go 1.26, axum 0.8, Spring 7.0.

## Comparison

| Framework          | One object for middleware + handler                             | Request                                                          | Per-request state → typing                                                                   | Set headers/cookies before a response exists                             | Flow                                                                             | Extras on the context                                                                 |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Hono               | yes `c`                                                         | lazy wrapper over Web `Request` (`c.req.raw`), cached async body | `c.set/var` → generics / chained `.use()` (global augmentation exists, docs call it unsound) | yes `c.header/status`, merged                                            | onion; return `Response` = stop; `onError`                                       | cookies (signed), `env`, `executionCtx.waitUntil`, requestId mw, stream/SSE `onAbort` |
| h3 v2              | yes `event`                                                     | Web `Request` + srvx (`ip`, `waitUntil`), `event.url`            | `event.context` → `H3EventContext` interface                                                 | yes `event.res.headers/status`, **dropped on error except `errHeaders`** | **linear by default**: `undefined` = continue, any value = stop; optional `next` | `waitUntil`, `onDispose`, `req.signal`, sessions, early hints                         |
| Elysia             | yes (lifecycle hooks)                                           | destructured, body pre-parsed                                    | `derive/resolve/decorate` → builder inference + schemas                                      | yes `set.headers/status`, cookie `.value`                                | linear phases; return = stop                                                     | reactive cookies, `afterResponse`, SSE auto-cancel                                    |
| Cloudflare Workers | — (`fetch(request, env, ctx)`)                                  | Web `Request` + `cf`                                             | none; `env` bindings                                                                         | —                                                                        | return/throw                                                                     | `ctx.waitUntil`, `request.signal` (flag)                                              |
| Koa                | yes `ctx`                                                       | own wrapper over Node req, no body parser                        | `ctx.state` → @types generics / augmentation                                                 | yes — nothing written until the stack unwinds                            | onion; `ctx.throw`                                                               | signed cookies, accepts, `app.currentContext` (ALS)                                   |
| Fastify            | yes `request, reply`                                            | own wrapper, body parsed built-in                                | `decorateRequest` → module augmentation / `getDecorator<T>()`                                | yes `reply.header/code`; `onSend`                                        | linear named phases                                                              | **`request.id`, `request.log`, `request.signal` (lazy)**, hijack, early hints         |
| Express 5          | yes `req, res`                                                  | patched Node objects                                             | `res.locals` / `req.x` → augmentation                                                        | yes (imperative `res`)                                                   | linear `next`                                                                    | accepts/format                                                                        |
| NestJS             | no — decorated args; guards/interceptors get `ExecutionContext` | platform req behind `switchToHttp()`                             | `req.user`, request-scoped DI                                                                | `@Header`, passthrough `res`                                             | layered; interceptors are the onion                                              | DI, multi-transport context                                                           |
| AdonisJS           | yes `HttpContext`                                               | own classes                                                      | `ctx.x` → module augmentation (+ macros/getters)                                             | yes — response sent after unwind                                         | onion                                                                            | **`request.id()`, `ctx.logger` (tagged)**, `response.onFinish`, opt-in ALS            |
| Encore.ts          | no — typed params                                               | metadata + typed fields                                          | `req.data` (untyped)                                                                         | after `next()` only                                                      | onion                                                                            | tracing, log correlation                                                              |
| SvelteKit          | yes `RequestEvent`                                              | Web `Request` + `url/params/cookies/getClientAddress()`          | `locals` → `App.Locals` augmentation                                                         | **yes `setHeaders`, `cookies.set`**                                      | onion; `resolve` never throws                                                    | `getRequestEvent()` (ambient), tracing, `route.id`                                    |
| Astro              | yes `APIContext`                                                | Web `Request` + `clientAddress`, `routePattern`                  | `locals` → `App.Locals`                                                                      | cookies yes; headers only after `next()`                                 | onion                                                                            | session, csp, cache, logger                                                           |
| Next.js 16         | no (`proxy` vs route handler)                                   | `NextRequest`                                                    | **none** (headers/cookies only)                                                              | `NextResponse.next()`, `cookies()`                                       | linear, "last resort"                                                            | `waitUntil`, `after()`                                                                |
| React Router 8     | yes                                                             | Web `Request`, `pattern`                                         | **typed keys** `createContext<T>()`                                                          | after `next()` / `data()`                                                | onion; `next` never throws                                                       | `request.signal`; chose typed context over ALS (not on every runtime)                 |
| Fresh 2            | yes `ctx`                                                       | `ctx.req`, `info.remoteAddr`                                     | `ctx.state` → `App<State>` generics                                                          | after `next()` only                                                      | onion; `HttpError`                                                               | `upgrade()`                                                                           |
| TanStack Start     | similar                                                         | Web `Request` + ambient helpers                                  | inferred chain + `Register` augmentation                                                     | **yes** `setResponseHeader`, `setCookie`                                 | onion                                                                            | validator, AbortSignal                                                                |
| ASP.NET Core       | yes `HttpContext`                                               | own `Request`                                                    | `Items` (object keys), `Features` (by type)                                                  | `Response.OnStarting`                                                    | onion; endpoint filters return to stop                                           | **`RequestAborted`, `TraceIdentifier`**, scoped DI, session                           |
| Plug/Phoenix       | yes `conn`                                                      | own conn                                                         | `assigns` (untyped)                                                                          | `put_resp_header`, `register_before_send`                                | **linear + `halt`**                                                              | RequestId, session                                                                    |
| Go net/http        | yes `(w, r)`                                                    | own                                                              | `context.WithValue` + private key types                                                      | —                                                                        | onion by composition                                                             | `r.Context()` cancellation                                                            |
| axum               | no — extractors                                                 | extractors                                                       | `Extension<T>` by type, `State<S>` compile-time                                              | after `next.run()`                                                       | onion                                                                            | —                                                                                     |
| Spring WebFlux     | yes `ServerWebExchange`                                         | own                                                              | attributes (string keys)                                                                     | `beforeCommit`                                                           | onion                                                                            | principal, session                                                                    |

## What recurs

1. **One context object per request**, shared by middleware and handlers (Hono, h3, Koa,
   AdonisJS, SvelteKit, Astro, React Router, Fresh, ASP.NET, Plug, Spring). Splitting request and
   response (Express, Fastify) or injecting arguments (NestJS, Encore, axum) are the alternatives.
2. **Request data is read-only and portable**: method, URL/path, headers, params, query, body,
   cookies, client IP, the matched route pattern. Edge-first frameworks keep the Web `Request`
   reachable underneath (`c.req.raw`, `event.req`); Node-first ones wrap the Node request.
3. **A separate namespace for per-request state** (`state`, `locals`, `context`, `var`, `Items`,
   `assigns`), never ad-hoc fields on the request. Typing is the weak point everywhere: global
   augmentation (most) is unsound when a value is set only on some routes (AdonisJS and Hono say
   so); generics/builders (Hono, Elysia, Fresh) and typed keys (React Router, Go, ASP.NET) are the
   precise alternatives.
4. **Response staging**: middleware sets headers, cookies and status before any response exists,
   and they are merged into whatever response is sent (SvelteKit, Hono, h3, Elysia, Koa, AdonisJS,
   TanStack, ASP.NET `OnStarting`, Plug `register_before_send`). A linear model cannot write
   CORS, request-id or Set-Cookie middleware without it. h3 drops staged headers on error
   responses except an explicit `errHeaders` set.
5. **Return to stop, throw to the error handler** is universal; error classes carry status,
   headers and body.
6. **Onion is the majority** (`await next()` returns the response, code runs after the handler).
   Linear designs: h3 v2 (newest major — linear by default, optional `next`), Elysia and Fastify
   (named phases), Express, Next.js proxy, Plug. Linear designs pair with staging plus an
   after-response hook (`onDispose`, `afterResponse`, `onResponse`, `onFinish`).
7. **Newer designs put runtime abilities on the context**: request id, a logger tagged with it,
   an abort signal for client disconnect (Fastify, h3, ASP.NET, Go), an after-response hook,
   `waitUntil` where the platform has one, the matched route pattern, and an escape hatch to the
   raw transport.
8. **Ambient access** (AsyncLocalStorage: Koa 3, AdonisJS opt-in, SvelteKit, TanStack, Nest
   add-ons) is offered as a complement, never instead of the explicit context; React Router chose
   typed context over ALS for runtime portability.
9. **Laziness is the performance lever**: lazy getters for URL, headers, signal and body; stable
   object shapes (Fastify decorators declared up front).

## Sources

Per-framework notes with doc URLs and code snippets are in the four research reports summarized
above (kept outside the repository); the key doc pages: hono.dev/docs/api/context ·
h3.dev/guide/api/h3event · elysiajs.com/essential/life-cycle ·
developers.cloudflare.com/workers/runtime-apis/context · koajs.com · fastify.dev/docs/latest/Reference/Request ·
expressjs.com/en/5x/api.html · docs.nestjs.com/fundamentals/execution-context ·
docs.adonisjs.com/guides/basics/http-context · encore.dev/docs/ts/develop/middleware ·
svelte.dev/docs/kit/hooks · docs.astro.build/en/guides/middleware ·
nextjs.org/docs/app/api-reference/file-conventions/proxy · reactrouter.com/how-to/middleware ·
fresh.deno.dev/docs/concepts/context · tanstack.com/start/latest/docs/framework/react/guide/middleware ·
learn.microsoft.com/aspnet/core/fundamentals/use-http-context · hexdocs.pm/plug/Plug.Conn.html ·
pkg.go.dev/net/http · docs.rs/axum/latest/axum/middleware ·
docs.spring.io/spring-framework/reference/web/webflux.html
