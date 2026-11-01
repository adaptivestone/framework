import {
  type FinishResult,
  RequestContext,
  type RequestSource,
} from '../services/http/RequestContext.ts';
import { runInRequestScope } from '../services/http/requestScope.ts';
import type { AppInfoExtensions, BaseAppInfo } from '../services/http/types.ts';

export interface TestContextInit<AppInfo extends object> {
  method?: string;
  /** Path and query, e.g. `/users/42?page=2`. Default `/`. */
  url?: string;
  /** Default `http://localhost`. */
  origin?: string;
  headers?: Record<string, string | string[] | undefined>;
  route?: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Only the fields the test needs; extra keys are allowed. */
  appInfo?: NoInfer<Partial<AppInfo>> & Record<string, unknown>;
  /** Abort it to simulate a client that went away. */
  signal?: AbortSignal;
  /** Address the connection came from (a proxy, or the client). Default `127.0.0.1`. */
  peerAddress?: string;
}

/**
 * Build a `RequestContext` for a unit test of a middleware or handler,
 * without a server. Use this instead of hand-built objects: the context can
 * gain members in minor releases.
 *
 *   const ctx = createTestContext({ headers: { authorization: 'Bearer x' } });
 *   const response = await new Auth(app).middleware(ctx, async () => HttpResponse.empty(204));
 */
export function createTestContext<
  AppInfo extends object = BaseAppInfo & AppInfoExtensions,
>(init: TestContextInit<AppInfo> = {}): RequestContext<AppInfo> {
  const url = init.url ?? '/';
  const lowerHeaders: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    lowerHeaders[name.toLowerCase()] = value;
  }
  const rawPath = url.split('?')[0] ?? '/';
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // keep the raw path when it is not valid percent-encoding
  }
  const source: RequestSource = {
    method: (init.method ?? 'GET').toUpperCase(),
    url,
    origin: init.origin ?? 'http://localhost',
    path,
    headers: lowerHeaders,
    route: init.route,
    params: init.params ?? {},
    query:
      init.query ??
      Object.fromEntries(new URL(url, 'http://localhost').searchParams),
    body: init.body,
    signal: init.signal ?? new AbortController().signal,
    peerAddress: init.peerAddress ?? '127.0.0.1',
  };
  return new RequestContext<AppInfo>(source, (init.appInfo ?? {}) as AppInfo, {
    runInScope: runInRequestScope,
  });
}

/** End a test context's response, as an adapter would; runs its `onFinish` callbacks. */
export function finishTestContext(
  ctx: RequestContext<object>,
  result: Omit<FinishResult, 'durationMs'> = {
    outcome: 'finished',
    status: 200,
  },
): void {
  RequestContext.finish(ctx, result);
}
