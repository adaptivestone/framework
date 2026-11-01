import AbstractController from '@adaptivestone/framework/modules/AbstractController.js';
import type { TransformResponseHook } from '@adaptivestone/framework/server.js';
import type HttpServer from '@adaptivestone/framework/services/http/HttpServer.js';
import AbstractMiddleware from '@adaptivestone/framework/services/http/middleware/AbstractMiddleware.js';
import Middleware from '@adaptivestone/framework/services/http/middleware/Middleware.js';
import type {
  Next,
  RequestContext,
} from '@adaptivestone/framework/services/http/RequestContext.js';
import { requestContext } from '@adaptivestone/framework/services/http/requestScope.js';
import { HttpResponse } from '@adaptivestone/framework/services/http/responses.js';
import {
  createTestContext,
  finishTestContext,
} from '@adaptivestone/framework/tests/createTestContext.js';
import type { NextFunction, Response } from 'express';

// The v2 middleware contract against the installed declarations.
class Session extends Middleware {
  static get description() {
    return 'Reads the session cookie';
  }

  async middleware(ctx: RequestContext, next: Next) {
    const sid: string | undefined = ctx.cookies.get('sid');
    ctx.response.setCookie('seen', '1', { maxAge: 60, sameSite: 'strict' });
    ctx.response.setHeader('x-session', sid ?? 'none');
    ctx.onFinish((result) => {
      const outcome: 'finished' | 'aborted' | 'failed' = result.outcome;
      void outcome;
    });
    return next();
  }
}

class Deny extends Middleware {
  middleware(): HttpResponse {
    return HttpResponse.json(403, { error: 'NO_ACCESS' });
  }
}

class ForgotReturn extends Middleware {
  // @ts-expect-error — resolves to void instead of a response
  async middleware(_ctx: RequestContext, next: Next) {
    await next();
  }
}

class Legacy extends AbstractMiddleware {
  async middleware(_req: unknown, _res: Response, next: NextFunction) {
    next();
  }
}

// Both middleware versions in real registration forms, and a v2 controller.
class Users extends AbstractController {
  static get contractVersion() {
    return 2 as const;
  }

  get routes() {
    return {
      get: {
        '/:id': { handler: this.getUser, middleware: [Session, Legacy] },
        '/denied': { handler: this.getUser, middleware: [Deny] },
      },
    };
  }

  async getUser(ctx: RequestContext) {
    const scoped = requestContext();
    void scoped;
    return HttpResponse.json(200, { id: ctx.params.id, path: ctx.path });
  }

  static get middleware() {
    return new Map([['/{*splat}', [Session, Legacy]]]);
  }
}

// Unit-testing a middleware without a server.
const ctx = createTestContext({ headers: { cookie: 'sid=abc' } });
const response: HttpResponse = await new Session(null as never).middleware(
  ctx,
  async () => HttpResponse.empty(204),
);
finishTestContext(ctx, { outcome: 'finished', status: response.status });
void [ForgotReturn, Users];

// The hooks hand portable code the context.
const transform: TransformResponseHook = (response, { ctx }) => {
  void ctx.route;
  return response;
};
declare const httpServer: HttpServer;
httpServer.registerErrorHandler(
  Error,
  (err, ctx) => {
    ctx.response.setHeader('x-failed', '1');
    return HttpResponse.json(500, { message: err.message, path: ctx.path });
  },
  { contractVersion: 2 },
);
void transform;
