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
 * Headers (and, later, cookies) staged before any response exists. They are
 * applied to whatever response is sent — the handler's, an early stop, or an
 * error response. Staging after the response has started throws.
 */
export class ResponseStaging {
  readonly #headers = new Map<string, string[]>();

  #sealed = false;

  /** Set a header, replacing earlier staged values of the same name. */
  setHeader(name: string, value: string): void {
    this.#assertOpen(name);
    this.#headers.set(name.toLowerCase(), [value]);
  }

  /** Add a value to a header, keeping earlier staged values. */
  appendHeader(name: string, value: string): void {
    this.#assertOpen(name);
    const key = name.toLowerCase();
    const values = this.#headers.get(key);
    if (values) {
      values.push(value);
    } else {
      this.#headers.set(key, [value]);
    }
  }

  /** @internal The staged headers as lower-case `[name, value]` pairs. */
  entries(): Array<readonly [string, string]> {
    const pairs: Array<readonly [string, string]> = [];
    for (const [name, values] of this.#headers) {
      for (const value of values) {
        pairs.push([name, value]);
      }
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

  /** Headers to apply to whatever response is sent, errors included. */
  readonly response = new ResponseStaging();

  readonly #source: RequestSource;

  readonly #options: RequestContextOptions;

  readonly #startedAt = performance.now();

  #url: URL | undefined;

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
