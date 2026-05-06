/**
 * HTTP type contracts. Pure type-only — no runtime, no behavior.
 *
 * Per-controller `<File>.routes.gen.ts` files (hand-written today, codegen-emitted
 * later) compose these primitives into per-route `Request<M, P>` helpers.
 */

import type { TFunction } from 'i18next';
import type { IApp } from '../../server.ts';
import type { FrameworkRequest } from './HttpServer.ts';

/**
 * Module-augmentation point for app-wide `appInfo` extensions. Users add:
 *
 *   declare module '@adaptivestone/framework' {
 *     interface AppInfoExtensions {
 *       requestId: string;
 *       sentryTransaction?: SentryTransaction;
 *     }
 *   }
 *
 * Per-route precision (e.g. `appInfo.user` from a route's middleware stack)
 * comes from the per-controller `Request<M, P>` helper, not from this interface.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation target — empty by design
export interface AppInfoExtensions {}

/**
 * `appInfo` shape populated by the framework's built-in middlewares before any
 * user middleware runs. Mirrors what `HttpServer`'s middleware chain sets per
 * request (`PrepareAppInfo`, `IpDetector`, `I18n`) plus the slots that the
 * route-level validation populates (`request`, `query`).
 *
 * `i18n` is required — `I18nMiddleware` is part of `HttpServer`'s default
 * chain (`HttpServer.ts:63`) and runs on every HTTP request before any
 * controller. If a user removes it, they should augment `BaseAppInfo` to
 * relax the field.
 */
export interface BaseAppInfo {
  app: IApp;
  ip?: string | undefined;
  i18n: { t: TFunction; language: string };
  request: Record<string, unknown>;
  query: Record<string, unknown>;
}

/**
 * Default request context handlers see when no per-route `Request<M, P>` is
 * imported. Equivalent to today's `FrameworkRequest` plus `AppInfoExtensions`.
 */
export type BaseRequestContext = FrameworkRequest & {
  appInfo: BaseAppInfo & AppInfoExtensions;
};

/**
 * Extract the static `provides` shape from a middleware class. Middlewares
 * declare what they add to `appInfo` via:
 *
 *   class GetUserByToken extends AbstractMiddleware {
 *     static get provides() {
 *       return {} as { user?: InstanceType<TUser> };
 *     }
 *   }
 *
 * `ProvidesOf<typeof GetUserByToken>` resolves to `{ user?: InstanceType<TUser> }`.
 * Returns `Record<never, never>` for middlewares without `provides`.
 */
export type ProvidesOf<T> = T extends { provides: infer P }
  ? P
  : Record<never, never>;

/**
 * Reduce a tuple of middleware classes (or `[Class, params]` tuples) to the
 * intersection of their `provides` shapes. Used by per-route `Request<M, P>`
 * to layer middleware-contributed `appInfo` fields onto the base context.
 */
export type UnionAppInfoProvides<MWs extends readonly unknown[]> =
  MWs extends readonly [infer Head, ...infer Tail extends readonly unknown[]]
    ? ProvidesOf<Head extends readonly [infer C, unknown] ? C : Head> &
        UnionAppInfoProvides<Tail>
    : Record<never, never>;
