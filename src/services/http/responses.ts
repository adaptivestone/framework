/**
 * Typed response values. A route handler returns one instead of writing to
 * Express `res`; the framework renders it. Descriptors are immutable data:
 * build them with the `HttpResponse` factories, never by hand.
 *
 * @example
 * async create(req: CreateUserRequest): Promise<JsonResponse<201, UserDto>> {
 *   const user = await this.app.getModel('User').create(req.appInfo.request);
 *   return HttpResponse.json(201, user);
 * }
 */

/** Registered, not module-private, so two installed copies of the framework recognize each other's responses. */
const BRAND: unique symbol = Symbol.for(
  '@adaptivestone/framework/HttpResponse',
);

/** Statuses that never carry a body; only `HttpResponse.empty` accepts them. */
export type NoBodyStatus = 204 | 205 | 304;

/** Statuses accepted by `HttpResponse.redirect`. */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

/** A literal status a body response cannot use (1xx, 204/205/304, 206) becomes `never`. */
type BodyStatus<S extends number> = S extends NoBodyStatus | 206
  ? never
  : `${S}` extends `1${string}`
    ? never
    : S;

/** A literal status `HttpResponse.empty` cannot use (1xx, 206) becomes `never`. */
type EmptyStatus<S extends number> = S extends 206
  ? never
  : `${S}` extends `1${string}`
    ? never
    : S;

/** Response headers: lower-case names, one entry per `set-cookie` value. */
export type ResponseHeaders = ReadonlyArray<
  readonly [name: string, value: string]
>;

/** Anything the Web `Headers` constructor accepts, including a descriptor's `headers`. */
export type ResponseHeadersInit =
  | Headers
  | Record<string, string>
  | ReadonlyArray<readonly [string, string]>;

/** A byte source for `HttpResponse.stream`; a Node `Readable` is an async iterable too. */
export type ByteStream = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface ResponseOptions {
  headers?: ResponseHeadersInit;
}

export interface BodyResponseOptions<M extends string> extends ResponseOptions {
  /** Media type; set it here, not as a `content-type` header. */
  contentType?: M;
}

interface ResponseBase<K extends string, S extends number> {
  readonly [BRAND]: true;
  readonly kind: K;
  readonly status: S;
  readonly headers: ResponseHeaders;
}

export interface JsonResponse<
  S extends number = number,
  B = unknown,
  M extends string = 'application/json',
> extends ResponseBase<'json', S> {
  readonly contentType: M;
  readonly body: B;
}

export interface TextResponse<
  S extends number = number,
  M extends string = 'text/plain',
> extends ResponseBase<'text', S> {
  readonly contentType: M;
  readonly body: string;
}

export interface BytesResponse<
  S extends number = number,
  M extends string = 'application/octet-stream',
> extends ResponseBase<'bytes', S> {
  readonly contentType: M;
  readonly body: Uint8Array;
}

export interface StreamResponse<
  S extends number = number,
  M extends string = 'application/octet-stream',
> extends ResponseBase<'stream', S> {
  readonly contentType: M;
  readonly body: ByteStream;
}

export interface RedirectResponse<S extends RedirectStatus = RedirectStatus>
  extends ResponseBase<'redirect', S> {
  readonly location: string;
}

export interface EmptyResponse<S extends number = number>
  extends ResponseBase<'empty', S> {}

/** A Web `Response` passed through as-is; its status and body types are not tracked. */
export interface NativeResponse extends ResponseBase<'native', number> {
  readonly response: Response;
}

const NO_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);
const NO_HEADERS: ResponseHeaders = Object.freeze([]);

function assertFinalStatus(factory: string, status: number): void {
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new RangeError(
      `HttpResponse.${factory}: status must be an integer from 200 to 599, got ${status}`,
    );
  }
}

function assertBodyStatus(factory: string, status: number): void {
  assertFinalStatus(factory, status);
  if (NO_BODY_STATUSES.has(status)) {
    throw new RangeError(
      `HttpResponse.${factory}: status ${status} never carries a body; use HttpResponse.empty(${status})`,
    );
  }
  if (status === 206) {
    throw new RangeError(
      `HttpResponse.${factory}: status 206 is reserved for range-aware file responses`,
    );
  }
}

/** Normalize through Web `Headers` (validates names and values) into frozen pairs. */
function toHeaders(
  factory: string,
  init: ResponseHeadersInit | undefined,
  owned: string | null,
): ResponseHeaders {
  if (init === undefined) {
    return NO_HEADERS;
  }
  // Headers accepts any sequence of pairs; its type only lists mutable ones.
  const headers = new Headers(init as ConstructorParameters<typeof Headers>[0]);
  if (owned && headers.has(owned)) {
    throw new TypeError(
      owned === 'location'
        ? `HttpResponse.${factory}: pass the location as the second argument, not as a location header`
        : `HttpResponse.${factory}: pass the media type as options.contentType, not as a content-type header`,
    );
  }
  return Object.freeze(
    [...headers].map(([name, value]) => Object.freeze([name, value] as const)),
  );
}

function json<S extends number, B, M extends string = 'application/json'>(
  status: BodyStatus<S>,
  body: B,
  options?: BodyResponseOptions<M>,
): JsonResponse<S, B, M> {
  assertBodyStatus('json', status);
  if (body === undefined) {
    throw new TypeError(
      'HttpResponse.json: body is undefined; use HttpResponse.empty(status) for a response without a body',
    );
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'json' as const,
    status: status as S,
    headers: toHeaders('json', options?.headers, 'content-type'),
    contentType: (options?.contentType ?? 'application/json') as M,
    body,
  });
}

function text<S extends number, M extends string = 'text/plain'>(
  status: BodyStatus<S>,
  body: string,
  options?: BodyResponseOptions<M>,
): TextResponse<S, M> {
  assertBodyStatus('text', status);
  if (typeof body !== 'string') {
    throw new TypeError('HttpResponse.text: body must be a string');
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'text' as const,
    status: status as S,
    headers: toHeaders('text', options?.headers, 'content-type'),
    contentType: (options?.contentType ?? 'text/plain') as M,
    body,
  });
}

function bytes<S extends number, M extends string = 'application/octet-stream'>(
  status: BodyStatus<S>,
  body: Uint8Array,
  options?: BodyResponseOptions<M>,
): BytesResponse<S, M> {
  assertBodyStatus('bytes', status);
  if (!(body instanceof Uint8Array)) {
    throw new TypeError('HttpResponse.bytes: body must be a Uint8Array');
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'bytes' as const,
    status: status as S,
    headers: toHeaders('bytes', options?.headers, 'content-type'),
    contentType: (options?.contentType ?? 'application/octet-stream') as M,
    body,
  });
}

/**
 * Stream bytes. The status and headers are sent with the first chunk, so an
 * error before it is answered like a thrown error; a later error aborts the
 * response. A client that disconnects stops the source (`return()` on the
 * iterator, `cancel()` on a `ReadableStream`).
 */
function stream<
  S extends number,
  M extends string = 'application/octet-stream',
>(
  status: BodyStatus<S>,
  body: ByteStream,
  options?: BodyResponseOptions<M>,
): StreamResponse<S, M> {
  assertBodyStatus('stream', status);
  if (
    typeof (body as { [Symbol.asyncIterator]?: unknown } | null)?.[
      Symbol.asyncIterator
    ] !== 'function'
  ) {
    throw new TypeError(
      'HttpResponse.stream: body must be a ReadableStream or an async iterable of bytes',
    );
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'stream' as const,
    status: status as S,
    headers: toHeaders('stream', options?.headers, 'content-type'),
    contentType: (options?.contentType ?? 'application/octet-stream') as M,
    body,
  });
}

function redirect<S extends RedirectStatus>(
  status: S,
  location: string | URL,
  options?: ResponseOptions,
): RedirectResponse<S> {
  if (!REDIRECT_STATUSES.has(status)) {
    throw new RangeError(
      `HttpResponse.redirect: status must be 301, 302, 303, 307 or 308, got ${status}`,
    );
  }
  const target = String(location);
  if (target === '') {
    throw new TypeError('HttpResponse.redirect: location must not be empty');
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'redirect' as const,
    status,
    headers: toHeaders('redirect', options?.headers, 'location'),
    location: target,
  });
}

function empty<S extends number>(
  status: EmptyStatus<S>,
  options?: ResponseOptions,
): EmptyResponse<S> {
  assertFinalStatus('empty', status);
  if (status === 206) {
    throw new RangeError(
      'HttpResponse.empty: status 206 is reserved for range-aware file responses',
    );
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'empty' as const,
    status: status as S,
    headers: toHeaders('empty', options?.headers, null),
  });
}

/**
 * Pass a Web `Response` through: its status, status text, headers and body
 * are sent as they are, except the framing headers the server sets itself
 * (`connection`, `transfer-encoding`, …). A `fetch()` response keeps the
 * upstream `content-encoding` and `content-length` although `fetch` already
 * decoded its body: remove them before returning it.
 */
function native(response: Response): NativeResponse {
  if (!(response instanceof Response)) {
    throw new TypeError('HttpResponse.native: expected a Web Response');
  }
  if (response.type === 'error') {
    throw new TypeError(
      'HttpResponse.native: a network-error Response (Response.error()) has no status to send',
    );
  }
  if (response.bodyUsed) {
    throw new TypeError(
      'HttpResponse.native: the Response body was already read',
    );
  }
  return Object.freeze({
    [BRAND]: true as const,
    kind: 'native' as const,
    status: response.status,
    headers: NO_HEADERS,
    response,
  });
}

/** Is `value` a response built by an `HttpResponse` factory? */
function is(value: unknown): value is HttpResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [BRAND]?: unknown })[BRAND] === true
  );
}

/**
 * Response factories. Status is always the first argument. Statuses a kind
 * cannot use fail to compile when written as literals and throw a
 * `RangeError` at runtime: 1xx everywhere; 204, 205 and 304 everywhere but
 * `empty`; 206 (reserved for range-aware file responses) everywhere.
 */
export const HttpResponse = Object.freeze({
  json,
  text,
  bytes,
  stream,
  redirect,
  empty,
  native,
  is,
});

/** Any response a handler can return. */
export type HttpResponse =
  | JsonResponse<number, unknown, string>
  | TextResponse<number, string>
  | BytesResponse<number, string>
  | StreamResponse<number, string>
  | RedirectResponse
  | EmptyResponse
  | NativeResponse;
