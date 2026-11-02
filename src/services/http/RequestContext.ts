import { parseCookie, stringifySetCookie } from 'cookie';
import type { HttpResponse } from './responses.ts';
import type { AppInfoExtensions, BaseAppInfo } from './types.ts';

/**
 * Continue with the rest of the chain. Resolves to the response the rest
 * produced; rejects with the error it threw. Call it at most once, while your
 * middleware runs.
 */
export type Next = () => Promise<HttpResponse>;

/** How a response ended on the server side (not proof the client received it). */
export interface FinishResult {
  outcome: 'finished' | 'aborted' | 'failed';
  /** The status that was sent, when one was sent. */
  status?: number;
  /** Why it failed, for `failed`. */
  error?: unknown;
  /** Milliseconds since the request entered the framework. */
  durationMs: number;
}

export type FinishCallback = (result: FinishResult) => void;

/**
 * What an HTTP adapter gives a request context. Read lazily: an adapter can
 * back these with getters over its own request object.
 *
 * @internal Adapters and test helpers create contexts; applications read them.
 */
export interface RequestSource {
  readonly method: string;
  /** Path and query as received, e.g. `/users/42?page=2`. */
  readonly url: string;
  /** `protocol://host` the client used, honouring trusted proxies. */
  readonly origin: string;
  /** Decoded path without the query, e.g. `/files/my report`. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Matched route template, e.g. `/users/:id`; `undefined` when unmatched. */
  readonly route: string | undefined;
  /** @internal Methods the matched route has handlers for (upper case). */
  readonly routeMethods?: readonly string[] | undefined;
  /** @internal Address of the connection's peer (a proxy, or the client). */
  readonly peerAddress?: string | undefined;
  /** @internal The Node request stream, for the framework's body parser. */
  readonly incoming?: NodeJS.ReadableStream | undefined;
  /** @internal Bytes captured on a `bodyParsing: 'raw'` route (`rawBody` reads them). */
  readonly rawBody?: Buffer | undefined;
  /** @internal Store the parsed body (`body` reads it back). */
  setBody?(body: unknown): void;
  /** @internal Store the captured bytes of a `bodyParsing: 'raw'` route. */
  setRawBody?(bytes: Buffer): void;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
  /** Aborts when the client goes away. */
  readonly signal: AbortSignal;
}

/** @internal Options an adapter passes with the source. */
export interface RequestContextOptions {
  /** Told when an `onFinish` callback throws; the other callbacks still run. */
  reportError?: (message: string, error: unknown) => void;
  /** Runs each `onFinish` callback in the request's framework context. */
  runInScope?: <T>(ctx: RequestContext<object>, fn: () => T) => T;
}

/**
 * Options for `ctx.response.setCookie()`. Defaults: `path: '/'`,
 * `httpOnly: true`, `sameSite: 'lax'`, and `secure: true` — except outside
 * production for plain HTTP requests to `localhost` / loopback addresses.
 */
export interface CookieOptions {
  /** Lifetime in seconds (`Max-Age`). Without it (and `expires`) the cookie ends with the browser session. */
  maxAge?: number;
  expires?: Date;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  partitioned?: boolean;
  priority?: 'low' | 'medium' | 'high';
}

/** The request's cookies, parsed from the `Cookie` header on first read. */
export class RequestCookies {
  readonly #header: string | undefined;

  #parsed: Record<string, string | undefined> | undefined;

  constructor(header: string | undefined) {
    this.#header = header;
  }

  /** A cookie's value (URL-decoded), or `undefined` when the client sent none. */
  get(name: string): string | undefined {
    this.#parsed ??= this.#header ? parseCookie(this.#header) : {};
    return Object.hasOwn(this.#parsed, name) ? this.#parsed[name] : undefined;
  }
}

/**
 * Headers and cookies staged before any response exists. They are applied to
 * whatever response is sent — the handler's, an early stop, or an error
 * response. Staging after the response has started throws.
 */
export class ResponseStaging {
  // Created on first use: most requests stage nothing.
  #headers: Map<string, string[]> | undefined;

  /** `Set-Cookie` values by cookie identity (name, domain, path). */
  #cookies: Map<string, string> | undefined;

  readonly #secureByDefault: () => boolean;

  #sealed = false;

  /** @internal Created by the request context. */
  constructor(secureByDefault: () => boolean = () => true) {
    this.#secureByDefault = secureByDefault;
  }

  /** Set a header, replacing earlier staged values of the same name. */
  setHeader(name: string, value: string): void {
    this.#assertOpen(name);
    this.#headers ??= new Map();
    this.#headers.set(name.toLowerCase(), [value]);
  }

  /** Add a value to a header, keeping earlier staged values. */
  appendHeader(name: string, value: string): void {
    this.#assertOpen(name);
    const key = name.toLowerCase();
    this.#headers ??= new Map();
    const values = this.#headers.get(key);
    if (values) {
      values.push(value);
    } else {
      this.#headers.set(key, [value]);
    }
  }

  /**
   * Set a cookie on the response. Setting the same name (with the same
   * `domain` and `path`) again replaces it. Invalid names, values, domains or
   * paths throw.
   */
  setCookie(name: string, value: string, options: CookieOptions = {}): void {
    this.#assertOpen('set-cookie');
    const path = options.path ?? '/';
    const header = stringifySetCookie({
      name,
      value,
      path,
      httpOnly: options.httpOnly ?? true,
      secure: options.secure ?? this.#secureByDefault(),
      sameSite: options.sameSite ?? 'lax',
      ...(options.domain === undefined ? {} : { domain: options.domain }),
      ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
      ...(options.expires === undefined ? {} : { expires: options.expires }),
      ...(options.partitioned ? { partitioned: true } : {}),
      ...(options.priority === undefined ? {} : { priority: options.priority }),
    });
    this.#cookies ??= new Map();
    this.#cookies.set(`${name};${options.domain ?? ''};${path}`, header);
  }

  /**
   * Tell the client to remove a cookie. Pass the `domain` and `path` it was
   * set with (the path defaults to `/`, like `setCookie`).
   */
  deleteCookie(
    name: string,
    options: Omit<CookieOptions, 'maxAge' | 'expires'> = {},
  ): void {
    this.setCookie(name, '', { ...options, maxAge: 0, expires: new Date(0) });
  }

  /** @internal The staged headers as lower-case `[name, value]` pairs, cookies last. */
  entries(): Array<readonly [string, string]> {
    const pairs: Array<readonly [string, string]> = [];
    for (const [name, values] of this.#headers ?? []) {
      for (const value of values) {
        pairs.push([name, value]);
      }
    }
    for (const value of this.#cookies?.values() ?? []) {
      pairs.push(['set-cookie', value]);
    }
    return pairs;
  }

  /** @internal Called when the response starts; later staging throws. */
  seal(): void {
    this.#sealed = true;
  }

  #assertOpen(name: string): void {
    if (this.#sealed) {
      throw new Error(
        `Cannot stage response header "${name}": the response has already started`,
      );
    }
  }
}

/**
 * Everything a middleware or handler needs about one request. Created by the
 * framework for each request — applications read it and never build one
 * (tests use `createTestContext()`), so new members can be added in minor
 * releases.
 */
export class RequestContext<
  AppInfo extends object = BaseAppInfo & AppInfoExtensions,
> {
  /** Per-request state that middleware add for later code. */
  readonly appInfo: AppInfo;

  /** Headers and cookies to apply to whatever response is sent, errors included. */
  readonly response = new ResponseStaging(() => !this.#isLocalDevelopment());

  readonly #source: RequestSource;

  readonly #options: RequestContextOptions;

  readonly #startedAt = performance.now();

  #url: URL | undefined;

  #cookies: RequestCookies | undefined;

  #bodyStream: ReadableStream<Uint8Array> | undefined;

  /** Set once the framework has parsed or captured the body. */
  #bodyTaken = false;

  #id: string | undefined;

  #finish: FinishCallback[] | undefined;

  #finished = false;

  #error: unknown;

  #hasError = false;

  constructor(
    source: RequestSource,
    appInfo: AppInfo,
    options: RequestContextOptions = {},
  ) {
    this.#source = source;
    this.appInfo = appInfo;
    this.#options = options;
  }

  get method(): string {
    return this.#source.method;
  }

  /** Decoded path without the query. */
  get path(): string {
    return this.#source.path;
  }

  /** The full request URL (host and protocol honour trusted proxies). */
  get url(): URL {
    this.#url ??= new URL(this.#source.url, this.#source.origin);
    return this.#url;
  }

  /** Matched route template, e.g. `/users/:id`; `undefined` when unmatched. */
  get route(): string | undefined {
    return this.#source.route;
  }

  get headers(): Readonly<Record<string, string | string[] | undefined>> {
    return this.#source.headers;
  }

  /** A request header by case-insensitive name; repeated values are joined with `, `. */
  header(name: string): string | undefined {
    const value = this.#source.headers[name.toLowerCase()];
    return Array.isArray(value) ? value.join(', ') : value;
  }

  /** The request's cookies: `ctx.cookies.get(name)`. */
  get cookies(): RequestCookies {
    if (!this.#cookies) {
      const raw = this.#source.headers.cookie;
      // HTTP/2 may send several `cookie` headers; they join with `; `.
      this.#cookies = new RequestCookies(
        Array.isArray(raw) ? raw.join('; ') : raw,
      );
    }
    return this.#cookies;
  }

  /** Raw path params; validated ones are on `appInfo.params`. */
  get params(): Readonly<Record<string, string>> {
    return this.#source.params;
  }

  /** Raw query; the validated query is on `appInfo.query`. */
  get query(): Readonly<Record<string, unknown>> {
    return this.#source.query;
  }

  /** Parsed body; the validated body is on `appInfo.request`. */
  get body(): unknown {
    return this.#source.body;
  }

  /**
   * The exact request bytes on a `bodyParsing: 'raw'` route — set on every
   * such route (empty when the request has no body), bounded by
   * `requestParser.maxFieldsSize`. `undefined` on other routes.
   */
  get rawBody(): Buffer | undefined {
    return this.#source.rawBody;
  }

  /**
   * The unread request body as a standard `ReadableStream`, on a
   * `bodyParsing: 'none'` route. Every read returns the same stream, so it can
   * be consumed once (`await new Response(ctx.bodyStream).text()` for the
   * Fetch helpers); the framework puts no size limit on it — the handler owns
   * that. `undefined` when there is no request stream, or once the framework
   * has parsed or captured the body.
   */
  get bodyStream(): ReadableStream<Uint8Array> | undefined {
    if (this.#bodyTaken) {
      return undefined;
    }
    const incoming = this.#source.incoming;
    if (!incoming) {
      return undefined;
    }
    if (!this.#bodyStream) {
      const chunks = incoming[Symbol.asyncIterator]();
      this.#bodyStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { value, done } = await chunks.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(
              typeof value === 'string' ? Buffer.from(value) : value,
            );
          }
        },
        async cancel() {
          await chunks.return?.();
        },
      });
    }
    return this.#bodyStream;
  }

  /** Client address from the framework's IP detection (trusted-proxy aware). */
  get ip(): string | undefined {
    return (this.appInfo as { ip?: string }).ip;
  }

  /** `X-Request-Id` when the client sent one, otherwise a generated id. */
  get id(): string {
    this.#id ??= this.header('x-request-id') ?? crypto.randomUUID();
    return this.#id;
  }

  /** Aborts when the client goes away. */
  get signal(): AbortSignal {
    return this.#source.signal;
  }

  /** The original error when the response came from the error registry. */
  get error(): unknown {
    return this.#error;
  }

  /** Whether the response came from the error registry. */
  get failed(): boolean {
    return this.#hasError;
  }

  /**
   * Run `callback` once the response has ended: `finished` (the last byte was
   * handed to the operating system), `aborted` (the client went away) or
   * `failed`. Callbacks run newest first, exactly once; one that throws is
   * reported and the others still run.
   */
  onFinish(callback: FinishCallback): void {
    if (this.#finished) {
      throw new Error('onFinish: the response has already ended');
    }
    this.#finish ??= [];
    this.#finish.push(callback);
  }

  /**
   * Plain HTTP to `localhost` outside production: cookies default to not
   * `Secure` there. In production they are always `Secure` by default — a
   * proxy that forwards `Host: localhost` must not weaken them.
   */
  #isLocalDevelopment(): boolean {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    try {
      return isLocalHttp(new URL(this.#source.origin));
    } catch {
      return false;
    }
  }

  /**
   * @internal Methods the matched route has handlers for, when the adapter
   * knows them — framework code that must tell an implicit HEAD (served by
   * the GET handler) from an explicit one.
   */
  static routeMethods(
    ctx: RequestContext<object>,
  ): readonly string[] | undefined {
    return ctx.#source.routeMethods;
  }

  /**
   * @internal Address of the connection's peer — the client, or the proxy in
   * front of it. Framework IP detection reads it; applications read `ip`.
   */
  static peerAddress(ctx: RequestContext<object>): string | undefined {
    return ctx.#source.peerAddress;
  }

  /** @internal The Node request stream (the framework's body parser reads it). */
  static incoming(
    ctx: RequestContext<object>,
  ): NodeJS.ReadableStream | undefined {
    return ctx.#source.incoming;
  }

  /** @internal Store the parsed body. */
  static setBody(ctx: RequestContext<object>, body: unknown): void {
    ctx.#bodyTaken = true;
    ctx.#source.setBody?.(body);
  }

  /** @internal Store the captured bytes of a `bodyParsing: 'raw'` route. */
  static setRawBody(ctx: RequestContext<object>, bytes: Buffer): void {
    ctx.#bodyTaken = true;
    ctx.#source.setRawBody?.(bytes);
  }

  /** @internal Record the error the registry turned into the response. */
  static recordError(ctx: RequestContext<object>, error: unknown): void {
    ctx.#error = error;
    ctx.#hasError = true;
  }

  /** @internal Deliver the end of the response to `onFinish`, exactly once. */
  static finish(
    ctx: RequestContext<object>,
    result: Omit<FinishResult, 'durationMs'>,
  ): void {
    if (ctx.#finished) {
      return;
    }
    ctx.#finished = true;
    ctx.response.seal();
    const callbacks = ctx.#finish;
    ctx.#finish = undefined;
    if (!callbacks) {
      return;
    }
    const full: FinishResult = {
      ...result,
      durationMs: performance.now() - ctx.#startedAt,
    };
    const report =
      ctx.#options.reportError ??
      ((message: string, error: unknown) => console.error(message, error));
    const runAll = () => {
      for (let i = callbacks.length - 1; i >= 0; i -= 1) {
        try {
          callbacks[i]?.(full);
        } catch (err) {
          report('An onFinish callback threw', err);
        }
      }
    };
    const run = ctx.#options.runInScope;
    if (run) {
      run(ctx, runAll);
    } else {
      runAll();
    }
  }
}

/** Plain HTTP to `localhost` or a loopback address, where some clients drop `Secure` cookies. */
function isLocalHttp(url: URL): boolean {
  if (url.protocol !== 'http:') {
    return false;
  }
  const host = url.hostname;
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}
