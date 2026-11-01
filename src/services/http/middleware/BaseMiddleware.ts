import Base from '../../../modules/Base.ts';
import type { IApp } from '../../../server.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';

/**
 * One security scheme a middleware contributes to the OpenAPI document
 * (`components.securitySchemes`). Mirrors the OpenAPI Security Scheme Object:
 * `type: 'apiKey'` uses `name` + `in`; `type: 'http'` uses `scheme`.
 */
export interface AuthParameter {
  name: string;
  type: string;
  in?: string;
  scheme?: string;
  description: string;
}

/**
 * Static metadata and construction shared by both middleware contracts:
 * `AbstractMiddleware` (`(req, res, next)`) and `Middleware` (`(ctx, next)`).
 * Extend one of those, not this class.
 */
class BaseMiddleware extends Base {
  params?: Record<string, unknown>;

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app);
    this.params = params;
  }

  static get description() {
    return 'Middleware description. Please provide own';
  }

  /**
   * How requests send the credentials this middleware reads (a bearer token,
   * an API-key header, …), as OpenAPI security schemes. Declared
   * **statically** so the generator reads them off the class with zero
   * instantiation. Default `[]`. Reading alone documents auth as optional;
   * see {@link requiresAuth}.
   */
  static get authSchemes(): AuthParameter[] {
    return [];
  }

  /**
   * Whether this middleware rejects requests without an authenticated user
   * (`Auth`, `Role`). One such middleware anywhere in a route's chain makes
   * the route's OpenAPI security required; without one it is optional.
   */
  static get requiresAuth(): boolean {
    return false;
  }

  /**
   * Schema describing query parameters this middleware consumes. Declared
   * **statically** so the framework (and codegen) can read it without
   * instantiating the middleware. Override with any Standard Schema-conformant
   * schema (Zod, Valibot, ArkType, yup ≥1.7, `defineSchema`). Default `null`.
   *
   * Example:
   *   static get relatedQueryParameters() {
   *     return z.object({ page: z.number(), limit: z.number() });
   *   }
   */
  static get relatedQueryParameters(): StandardSchemaV1 | null {
    return null;
  }

  /**
   * Schema describing request-body parameters this middleware consumes. Static;
   * same rules as `relatedQueryParameters`.
   */
  static get relatedRequestParameters(): StandardSchemaV1 | null {
    return null;
  }

  static get loggerGroup() {
    return 'middleware';
  }
}

export default BaseMiddleware;
