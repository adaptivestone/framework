# Routing semantics: cross-ecosystem research (2026-05-09)

Compiled to inform v5 defaults and v6 direction. Frameworks compared: Express 5, Fastify 5, Hono, Koa, Laravel, Symfony, Rails, Sinatra, Django, FastAPI, Spring Boot, Actix Web, Axum, ASP.NET Core, Gin, Echo, Chi.

See `decisions.md` → "Routing semantics (v5, resolved)" for the resulting v5 defaults and `decisions.md` → "Deferred to v6" for the v6 flips.

## 1. Trailing slash policy

| Framework | Default | How to Configure |
|---|---|---|
| Express 5 | `/users` == `/users/` (lenient; `strict: false`) | `app.enable('strict routing')` or `Router({ strict: true })` |
| Fastify 5 | `/users` != `/users/` (strict) | `fastify({ ignoreTrailingSlash: true })`; pair with `ignoreDuplicateSlashes` |
| Hono | Strict (different routes) | `trimTrailingSlash()` or `appendTrailingSlash()` middleware |
| Koa (@koa/router) | `/users` == `/users/` (`strict: false`) | `new Router({ strict: true })` |
| Laravel | `/users` == `/users/` | Default `.htaccess` strips trailing slash before routing |
| Symfony | Auto-redirects 301/308 between forms (GET/HEAD only) | `trailing_slash_on_root` import option |
| Rails | `/users` == `/users/` (matches both) | `default_url_options[:trailing_slash] = true` for generation |
| Sinatra | Strict (different routes) | `set :strict_paths, false` (Sinatra 2.0+); or `/foo/?` regex |
| Django | Auto-appends slash via 301 redirect | `APPEND_SLASH = True` (default); requires `CommonMiddleware` |
| FastAPI/Starlette | Auto-redirect (307) between forms | `FastAPI(redirect_slashes=False)` |
| Spring Boot 3+ | Strict (`/users/` returns 404) | `setUseTrailingSlashMatch(true)` (deprecated). Default flipped from `true` to `false` in Spring Framework 6 |
| Actix Web | Strict | `NormalizePath::trim()` middleware; `TrailingSlash::{Trim,Always,MergeOnly}` enum |
| Axum | Auto-redirects 308 between forms | `NormalizePathLayer::trim_trailing_slash`; `route_with_tsr` from axum-extra |
| ASP.NET Core | Lenient (matches both) | `RouteOptions.AppendTrailingSlash` for URL generation |
| Gin | Auto-redirect (301/307) | `engine.RedirectTrailingSlash = false` to disable |
| Echo | Strict | `e.Pre(middleware.RemoveTrailingSlash())` or `AddTrailingSlash()` |
| Chi | Strict | `middleware.RedirectSlashes` or `StripSlashes` |

## 2. Case sensitivity

| Framework | Default | How to Configure |
|---|---|---|
| Express 5 | Insensitive (`caseSensitive: false`) | `app.enable('case sensitive routing')` or `Router({ caseSensitive: true })` |
| Fastify 5 | Sensitive | `fastify({ caseSensitive: false })` — also lowercases captured params |
| Hono | Sensitive | No first-class option; URLPattern-style regex needed |
| Koa router | Insensitive (`sensitive: false`) | `new Router({ sensitive: true })` |
| Laravel | Sensitive | Custom route validator with `i` regex flag |
| Symfony | Sensitive | No built-in toggle; use `(?i)` in requirements |
| Rails | Sensitive | No built-in option; gems like `route_downcaser` |
| Sinatra | Sensitive | No built-in option |
| Django | Sensitive | Use `(?i)` regex prefix in URL pattern |
| FastAPI | Sensitive | No built-in option |
| Spring Boot | Sensitive | `PathPatternParser.setCaseSensitive(false)` |
| Actix Web | Sensitive | No built-in option |
| Axum | Sensitive | No built-in option (matchit is case-sensitive) |
| ASP.NET Core | Insensitive | Default; route arg names must still match controller param case |
| Gin | Sensitive | `engine.RedirectFixedPath = true` for case-insensitive redirect lookup |
| Echo | Sensitive | No built-in option |
| Chi | Sensitive | No built-in option |

## 3. URL parameter / path decoding

| Framework | Auto-decode params? | Encoded slash (`%2F`) in segment |
|---|---|---|
| Express 5 | Yes (`decodeURIComponent` via path-to-regexp v8 `decode` option) | Decoded by Node URL parser before routing; `%2F` becomes `/` and is treated as separator |
| Fastify 5 | Not by router; URI must be pre-decoded | Default raw matching; `rewriteUrl: req => decodeURI(req.url)` workaround |
| Hono | Yes (params decoded) | `%2F` becomes `/`; need regex catchall `:id{.+}` to match |
| Koa router | Yes (path-to-regexp) | `%2F` decoded; same Express semantics |
| Laravel | Yes | `%2F` decoded by router; intended behavior — double-encode workaround |
| Symfony | Yes (segment-by-segment) | Default param regex `[^/]+` rejects `/`; require `.+` to allow |
| Rails | Yes | URL helpers escape; `id: /[^\/]+/` constraint to control |
| Sinatra | Yes | Standard Rack decoding |
| Django | Yes | `str` converter excludes `/`; `path` converter accepts; decoded before pattern match |
| FastAPI/Starlette | Yes (ASGI passes decoded path) | Routing operates on decoded path; use `{var:path}` converter |
| Spring Boot (PathPatternParser) | Yes, **per-segment** | Encoded `/` and `;` cannot alter path structure — decoded after segmentation |
| Actix Web | Yes | `%2F` decoded; encoded slash treated as separator unless escaped path used |
| Axum | Yes | Standard Tower/hyper decoding |
| ASP.NET Core | Mostly yes — **except `/`** | `%2F` deliberately NOT decoded in route values (preserved as `%2F`) |
| Gin | Yes (configurable) | `UseRawPath`, `UseEscapedPath`, `UnescapePathValues` flags |
| Echo | Yes | Uses `RawPath` if available; otherwise decoded `Path` |
| Chi | Yes | Standard `net/http` URL decoding |

## Cross-cutting synthesis

### Modern consensus

- **Trailing slash**: Three-way split. Lenient (Express, Koa, Rails, ASP.NET Core, Laravel). Strict-different (Fastify, Sinatra, Spring 6+, Actix, Echo, Chi, Hono). Auto-redirect to canonical (Symfony, Django, FastAPI, Axum, Gin). Newer/stricter frameworks trend strict-by-default with opt-in middleware.
- **Case sensitivity**: Strong consensus is **case-sensitive by default**. Outliers: Express, Koa router, ASP.NET Core. RFC 3986 specifies path is case-sensitive.
- **URL decoding**: Universal that params are auto-decoded. Spring's `PathPatternParser` (per-segment decoding) and ASP.NET Core (preserving `%2F`) are the safest models.

### Express 5 today (target for v5 backward compat)

- Trailing slash: lenient (`strict: false`)
- Case sensitivity: insensitive (`caseSensitive: false`)
- Decoding: `decodeURIComponent` per param via path-to-regexp v8

### Modern majority (target for v6 alignment)

- Trailing slash: strict-by-default with opt-in canonical-redirect middleware
- Case sensitivity: case-sensitive by default
- URL decoding: per-segment decode, preserving structural integrity for `%2F`

## Node.js native URL capabilities

- **`URL` (WHATWG)**: parses pathname with reserved-character handling. `URL.pathname` does NOT decode `%XX` — must call `decodeURIComponent` explicitly. WHATWG defines four percent-encode sets; `/` is in the "path" set so it stays encoded inside `pathname`, enabling `%2F` preservation when processing segments before decoding.
- **`URLPattern`**: Available globally in Node 24 (since v23.8.0). Supports named groups, regex groups, optional case-insensitive matching. Reported regex-based and slower than purpose-built routers — fine for low-volume routing.
- **`decodeURIComponent` vs `decodeURI`**: `decodeURI` preserves URI-reserved characters (`;/?:@&=+$,#`), so `%2F` stays as `%2F`. `decodeURIComponent` decodes everything including `/`. For per-segment decoding (Spring's model), split on `/` first using the encoded path, then run `decodeURIComponent` on each segment. Both throw `URIError` on malformed sequences (e.g., lone `%`) — wrap in try/catch.
- **Limitation**: `decodeURIComponent` does not decode `+` to space (form-encoding, not URI-encoding). Query strings via `URLSearchParams` do this automatically.
- **Surprise**: Node's `URL` normalizes `..` and `.` segments and collapses `\` to `/` on Windows-like paths.

## Sources

- Express 5.x API Reference — https://expressjs.com/en/5x/api.html
- path-to-regexp npm — https://www.npmjs.com/package/path-to-regexp
- Fastify Routes Reference — https://fastify.dev/docs/latest/Reference/Routes/
- Fastify Server Reference — https://github.com/fastify/fastify/blob/HEAD/docs/Reference/Server.md
- Hono Trailing Slash Middleware — https://hono.dev/docs/middleware/builtin/trailing-slash
- Hono Routing Docs — https://hono.dev/docs/api/routing
- koajs/router GitHub — https://github.com/koajs/router
- Symfony Routing — https://symfony.com/doc/current/routing.html
- Symfony 4.1 Trailing Slash on Imported Routes — https://symfony.com/blog/new-in-symfony-4-1-configurable-trailing-slash-on-imported-routes
- Symfony slash in parameter — https://symfony.com/doc/2.x/routing/slash_in_parameter.html
- Laravel encoded slash issue #22125 — https://github.com/laravel/framework/issues/22125
- Rails Routing Guide — https://guides.rubyonrails.org/routing.html
- Sinatra FAQ — https://sinatrarb.com/faq.html
- Django URL dispatcher — https://docs.djangoproject.com/en/5.2/topics/http/urls/
- Django APPEND_SLASH (LearnDjango) — https://learndjango.com/tutorials/trailing-url-slashes-django
- FastAPI redirect_slashes PR #3432 — https://github.com/fastapi/fastapi/pull/3432
- Starlette encoded slash issue #826 — https://github.com/Kludex/starlette/issues/826
- Spring Framework #28552 deprecate trailing slash match — https://github.com/spring-projects/spring-framework/issues/28552
- Spring URL Matching with PathPattern — https://spring.io/blog/2020/06/30/url-matching-with-pathpattern-in-spring-mvc/
- PathPatternParser javadoc — https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/util/pattern/PathPatternParser.html
- Actix NormalizePath docs — https://docs.rs/actix-web/latest/actix_web/middleware/struct.NormalizePath.html
- Actix TrailingSlash enum — https://docs.rs/actix-web/latest/actix_web/middleware/enum.TrailingSlash.html
- Axum Router docs — https://docs.rs/axum/latest/axum/routing/struct.Router.html
- Axum trailing slash issue #1118 — https://github.com/tokio-rs/axum/issues/1118
- ASP.NET Core Routing — https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing
- ASP.NET Core %2F not decoded #23633 — https://github.com/dotnet/aspnetcore/issues/23633
- Gin pkg.go.dev — https://pkg.go.dev/github.com/gin-gonic/gin
- Gin wildcard URI decode #2047 — https://github.com/gin-gonic/gin/issues/2047
- Echo Trailing Slash Middleware — https://echo.labstack.com/docs/middleware/trailing-slash
- Echo URI decoding issue #561 — https://github.com/labstack/echo/issues/561
- Chi pkg.go.dev — https://pkg.go.dev/github.com/go-chi/chi
- Cloudflare URLPattern blog — https://blog.cloudflare.com/improving-web-standards-urlpattern/
- URLPattern on Chrome dev — https://developer.chrome.com/docs/web-platform/urlpattern
- Node.js URL docs — https://nodejs.org/api/url.html
- MDN decodeURIComponent — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/decodeURIComponent
