import AbstractController from '../../../modules/AbstractController.ts';
import Pagination from '../../../services/http/middleware/Pagination.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';
import type { StandardSchemaV1 } from '../../../services/validate/types.ts';
import {
  FinalOutput,
  LegacyOutput,
  NullableOutput,
  OptionalOutput,
  RequiredOutput,
  StaticRequestInstanceQuery,
  UnknownOutput,
} from '../middleware/ValidationOutputs.ts';
import type {
  ArrayBodyRequest,
  ContentBodyRequest,
  LegacyQueryRequest,
  MiddlewareBodyRequest,
  NullableBodyRequest,
  NullableMiddlewareRequest,
  OptionalBodyRequest,
  OrderedBodyRequest,
  QueryRequest,
  ScalarBodyRequest,
  ScalarQueryRequest,
  StaticRequestInstanceQueryRequest,
  UnknownMiddlewareRequest,
} from './ValidationComposition.routes.gen.ts';

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export default class ValidationComposition extends AbstractController {
  static get middleware() {
    return new Map();
  }

  get routes() {
    return {
      post: {
        '/array': {
          handler: this.arrayBody,
          request: defineSchema<string[]>(() => ({ value: ['a'] })),
        },
        '/scalar': {
          handler: this.scalarBody,
          request: defineSchema<number>(() => ({ value: 42 })),
        },
        '/nullable': {
          handler: this.nullableBody,
          request: defineSchema<{ value: string } | null>(() => ({
            value: null,
          })),
        },
        '/optional': {
          handler: this.optionalBody,
          request: defineSchema<{ value: string; kept: boolean }>(() => ({
            value: { value: 'original', kept: true },
          })),
          middleware: [OptionalOutput],
        },
        '/nullable-middleware': {
          handler: this.nullableMiddleware,
          request: defineSchema<{ value: string }>(() => ({
            value: { value: 'original' },
          })),
          middleware: [NullableOutput],
        },
        '/static-request-instance-query': {
          handler: this.staticRequestInstanceQuery,
          request: defineSchema<{ staticValue: string }>(() => ({
            value: { staticValue: 'original' },
          })),
          middleware: [StaticRequestInstanceQuery],
        },
        '/unknown-middleware': {
          handler: this.unknownMiddleware,
          middleware: [UnknownOutput],
        },
        '/ordered': {
          handler: this.orderedBody,
          request: defineSchema<{ value: string }>(() => ({
            value: { value: 'original' },
          })),
          middleware: [RequiredOutput, FinalOutput],
        },
        '/middleware': {
          handler: this.middlewareBody,
          middleware: [RequiredOutput],
        },
        '/content': {
          handler: this.contentBody,
          request: {
            'application/json': defineSchema<{ value: string }>(() => ({
              value: { value: 'original' },
            })),
            'text/plain': defineSchema<{ value: string; text: true }>(() => ({
              value: { value: 'original', text: true },
            })),
          },
          middleware: [RequiredOutput],
        },
      },
      get: {
        '/scalar/:id': {
          handler: this.scalarQuery,
          query: defineSchema<number>(() => ({ value: 42 })),
          params: defineSchema<number>(() => ({ value: 7 })),
        },
        '/query': {
          handler: this.query,
          query: defineSchema<{ limit: string }>(() => ({
            value: { limit: '10' },
          })),
          middleware: [Pagination],
        },
        '/legacy': { handler: this.legacyQuery, middleware: [LegacyOutput] },
      },
    };
  }

  arrayBody(req: ArrayBodyRequest): void {
    const exact: Exact<typeof req.appInfo.request, string[]> = true;
    const result: string[] = req.appInfo.request.map((s) => s.toUpperCase());
    void [exact, result];
  }

  scalarBody(req: ScalarBodyRequest): void {
    const exact: Exact<typeof req.appInfo.request, number> = true;
    void exact;
  }

  scalarQuery(req: ScalarQueryRequest): void {
    const query: Exact<typeof req.appInfo.query, number> = true;
    const params: Exact<typeof req.appInfo.params, number> = true;
    const raw: string = req.params.id;
    void [query, params, raw];
  }

  nullableBody(req: NullableBodyRequest): void {
    const exact: Exact<typeof req.appInfo.request, { value: string } | null> =
      true;
    void exact;
  }

  optionalBody(req: OptionalBodyRequest): void {
    const value: Exact<
      typeof req.appInfo.request.value,
      string | number | undefined
    > = true;
    const kept: boolean = req.appInfo.request.kept;
    void [value, kept];
  }

  nullableMiddleware(req: NullableMiddlewareRequest): void {
    const value: Exact<typeof req.appInfo.request.value, string | number> =
      true;
    if ('nullableOnly' in req.appInfo.request) {
      const nullableOnly: true = req.appInfo.request.nullableOnly;
      void nullableOnly;
    }
    // @ts-expect-error the nullable middleware may contribute no output
    req.appInfo.request.nullableOnly;
    void value;
  }

  staticRequestInstanceQuery(req: StaticRequestInstanceQueryRequest): void {
    const value: Exact<typeof req.appInfo.request.staticValue, number> = true;
    // @ts-expect-error a static request schema suppresses the legacy instance query schema
    const legacyOnly: number = req.appInfo.query.legacyOnly;
    void [value, legacyOnly];
  }

  unknownMiddleware(req: UnknownMiddlewareRequest): void {
    const output: Exact<typeof req.appInfo.request, unknown> = true;
    void output;
  }

  orderedBody(req: OrderedBodyRequest): void {
    const value: Exact<typeof req.appInfo.request.value, boolean> = true;
    const audit: string = req.appInfo.audit;
    void [value, audit];
  }

  middlewareBody(req: MiddlewareBodyRequest): void {
    const value: Exact<typeof req.appInfo.request.value, number> = true;
    // @ts-expect-error known validation output has no arbitrary fields
    req.appInfo.request.missing;
    void value;
  }

  contentBody(req: ContentBodyRequest): void {
    const value: Exact<typeof req.appInfo.request.value, number> = true;
    if (req.appInfo.request.contentType === 'text/plain') {
      const text: true = req.appInfo.request.text;
      void text;
    }
    void value;
  }

  query(req: QueryRequest): void {
    const limit: Exact<
      typeof req.appInfo.query.limit,
      string | number | undefined
    > = true;
    const page: number | undefined = req.appInfo.query.page;
    const skip: number = req.appInfo.pagination.skip;
    void [limit, page, skip];
  }

  legacyQuery(req: LegacyQueryRequest): void {
    type LegacySchemaOutput = StandardSchemaV1.InferOutput<
      typeof LegacyOutput.prototype.relatedQueryParameters
    >;
    const schemaExact: Exact<LegacySchemaOutput, { legacy: number }> = true;
    const queryShape: { legacy: number } = req.appInfo.query;
    const legacy: Exact<typeof req.appInfo.query.legacy, number> = true;
    void [schemaExact, queryShape, legacy];
  }
}
