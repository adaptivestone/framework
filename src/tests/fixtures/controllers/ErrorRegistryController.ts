import type { Response } from 'express';
import type {
  RouteParams,
  TMiddleware,
} from '../../../modules/AbstractController.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';
import { HttpError, NotFoundError } from '../../../services/http/httpErrors.ts';

/** An "unowned" third-party-style error; the test registers a handler for it. */
export class FakeDriverError extends Error {
  code: number;

  constructor(code: number) {
    super(`driver failed with code ${code}`);
    this.name = 'FakeDriverError';
    this.code = code;
  }
}

/** Registered with a handler that itself throws — the crash-safety case. */
export class HandlerCrashError extends Error {}

class ErrorRegistryController extends AbstractController {
  get routes(): RouteParams {
    return {
      get: {
        '/notFound': { handler: this.throwNotFound },
        '/customBase': { handler: this.throwCustomBase },
        '/unowned': { handler: this.throwUnowned },
        '/unownedPass': { handler: this.throwUnownedPass },
        '/handlerCrash': { handler: this.throwHandlerCrash },
        '/plain': { handler: this.throwPlain },
      },
    };
  }

  async throwNotFound(_req: FrameworkRequest, _res: Response) {
    throw new NotFoundError('Boat not found');
  }

  async throwCustomBase(_req: FrameworkRequest, _res: Response) {
    throw new HttpError(422, 'Unprocessable', {
      errors: { csv: 'row 17 malformed' },
    });
  }

  async throwUnowned(_req: FrameworkRequest, _res: Response) {
    throw new FakeDriverError(11000);
  }

  async throwUnownedPass(_req: FrameworkRequest, _res: Response) {
    // The registered handler returns null for this code → falls through to 500.
    throw new FakeDriverError(42);
  }

  async throwHandlerCrash(_req: FrameworkRequest, _res: Response) {
    throw new HandlerCrashError('boom');
  }

  async throwPlain(_req: FrameworkRequest, _res: Response) {
    throw new Error('unmapped plain error');
  }

  // Error-path fixture — no auth (the inherited default [GetUserByToken, Auth]
  // would 401 every request).
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

export default ErrorRegistryController;
