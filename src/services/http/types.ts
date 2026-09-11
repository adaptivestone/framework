/**
 * HTTP type contracts. Pure type-only — no runtime, no behavior.
 *
 * Per-controller `<File>.routes.gen.ts` files (hand-written today, codegen-emitted
 * later) compose these primitives into per-route `Request<M, P>` helpers.
 */

import type { IApp } from '../../server.ts';
import type { TI18n } from '../i18n/types.ts';
import type { StandardSchemaV1 } from '../validate/types.ts';
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
  i18n: TI18n;
  request: Record<string, unknown>;
  query: Record<string, unknown>;
  /**
   * Validated, coerced path params — populated only when the route declares a
   * `params:` schema; `{}` otherwise. Raw Express strings stay on `req.params`.
   */
  params: Record<string, unknown>;
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

type MiddlewareClass<T> = T extends readonly [infer C, unknown] ? C : T;
type Member<T, K extends PropertyKey> = K extends keyof T ? T[K] : never;

/** A widened StandardSchema has no output information (including the base
 * middleware's nullable defaults). An explicitly non-nullable schema whose
 * output is `unknown` is still a real singleton output; retaining it avoids
 * promising the object-shaped base fallback. */
type KnownSchema<S> = [Extract<S, StandardSchemaV1>] extends [never]
  ? never
  : unknown extends StandardSchemaV1.InferOutput<Extract<S, StandardSchemaV1>>
    ? [Extract<S, null | undefined>] extends [never]
      ? S
      : never
    : S;

type SchemaMetadata<S> = [KnownSchema<S>] extends [never] ? never : S;

type StaticSchemas<M> = {
  request: SchemaMetadata<Member<M, 'relatedRequestParameters'>>;
  query: SchemaMetadata<Member<M, 'relatedQueryParameters'>>;
};

type InstanceSchemas<M> = M extends { prototype: infer I }
  ? {
      request: SchemaMetadata<Member<I, 'relatedRequestParameters'>>;
      query: SchemaMetadata<Member<I, 'relatedQueryParameters'>>;
    }
  : { request: never; query: never };

type DefiniteSchema<S> = [S] extends [never]
  ? never
  : null extends S
    ? never
    : undefined extends S
      ? never
      : S;

type StaticSchemaSlots<M> =
  | StaticSchemas<M>['request']
  | StaticSchemas<M>['query'];

/** Instance metadata is the deprecated runtime fallback only when neither
 * static slot contributes a schema. Reading its type never constructs it. */
type MiddlewareSchemas<M> = [
  | DefiniteSchema<StaticSchemas<M>['request']>
  | DefiniteSchema<StaticSchemas<M>['query']>,
] extends [never]
  ? [StaticSchemaSlots<M>] extends [never]
    ? InstanceSchemas<M>
    : StaticSchemas<M> | InstanceSchemas<M>
  : StaticSchemas<M>;

type MiddlewareOutputs<
  MWs extends readonly unknown[],
  Slot extends 'request' | 'query',
> = MWs extends readonly [infer Head, ...infer Tail]
  ? AppendMiddlewareOutput<
      MiddlewareSchemas<MiddlewareClass<Head>>,
      Slot,
      MiddlewareOutputs<Tail, Slot>
    >
  : [];

/** Distribute over metadata branches before indexing a slot: a `never` slot
 * means no schema in that branch, and must not disappear from the union. */
type AppendMiddlewareOutput<
  Metadata,
  Slot extends PropertyKey,
  Tail extends unknown[],
> = Metadata extends { [K in Slot]: infer S }
  ? [S] extends [never]
    ? Tail
    : S extends StandardSchemaV1
      ? [StandardSchemaV1.InferOutput<S>, ...Tail]
      : Tail
  : Tail;

type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

type MergedValue<L, R, K extends PropertyKey> = K extends keyof R
  ? K extends RequiredKeys<R>
    ? R[K]
    : K extends keyof L
      ? L[K] | R[K]
      : R[K]
  : K extends keyof L
    ? L[K]
    : never;

/** Ordered shallow assignment. Optional later keys may be absent, so an
 * earlier value remains possible; a present undefined still overwrites it. */
type MergeValidationObjects<L, R> = {
  [K in RequiredKeys<L> | RequiredKeys<R>]: MergedValue<L, R, K>;
} & {
  [K in Exclude<
    keyof L | keyof R,
    RequiredKeys<L> | RequiredKeys<R>
  >]?: MergedValue<L, R, K>;
};

type MergeValidationOutputs<L, R> = L extends readonly unknown[]
  ? never
  : R extends readonly unknown[]
    ? never
    : L extends object
      ? R extends object
        ? MergeValidationObjects<L, R>
        : never
      : never;

type ReduceValidationOutputs<
  Parts extends unknown[],
  Fallback,
> = Parts extends [infer L, infer R, ...infer Tail]
  ? ReduceValidationOutputs<[MergeValidationOutputs<L, R>, ...Tail], Fallback>
  : Parts extends [infer Only]
    ? Only
    : Fallback;

type ValidatedSlot<
  MWs extends readonly unknown[],
  Outputs,
  Slot extends 'request' | 'query',
  Fallback,
> = ReduceValidationOutputs<
  [
    ...(Slot extends keyof Outputs ? [Outputs[Slot]] : []),
    ...MiddlewareOutputs<MWs, Slot>,
  ],
  Fallback
>;

type WithContentType<T, ContentType extends string> = [ContentType] extends [
  never,
]
  ? T
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? Omit<T, 'contentType'> & { contentType: ContentType }
      : never;

type ProvidedAppInfo<MWs extends readonly unknown[]> =
  BaseRequestContext['appInfo'] & UnionAppInfoProvides<MWs>;

/** Handler context after validation: route output first, then middleware
 * outputs in chain order. Validated slots replace the base record types so
 * arrays, primitives and nullable schema outputs retain their actual shape. */
export type ValidatedRequest<
  MWs extends readonly unknown[],
  Outputs = Record<never, never>,
  ContentType extends string = never,
> = Omit<BaseRequestContext, 'appInfo'> & {
  appInfo: Omit<ProvidedAppInfo<MWs>, 'request' | 'query' | keyof Outputs> & {
    request: WithContentType<
      ValidatedSlot<MWs, Outputs, 'request', ProvidedAppInfo<MWs>['request']>,
      ContentType
    >;
    query: ValidatedSlot<MWs, Outputs, 'query', ProvidedAppInfo<MWs>['query']>;
  } & Pick<Outputs, Exclude<keyof Outputs, 'request' | 'query'>>;
};
