import type { NextFunction, Response } from 'express';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';
import AbstractMiddleware from '../../../services/http/middleware/AbstractMiddleware.ts';

/**
 * NAMED-export (no default) middleware — the codegen gen file must import it as
 * `import type { NamedGuard }`. A default-import form is a `TS2613` (module has
 * no default export), so the golden tsc gate catches a regression.
 */
export class NamedGuard extends AbstractMiddleware {
  static get provides() {
    return {} as { tenant: string };
  }

  async middleware(_req: FrameworkRequest, _res: Response, next: NextFunction) {
    return next();
  }
}

/** A second named export the controller imports under an ALIAS, so the gen file
 * must emit `import type { RoleGuard as Guard }`. */
export class RoleGuard extends AbstractMiddleware {
  static get provides() {
    return {} as { role: string };
  }

  async middleware(_req: FrameworkRequest, _res: Response, next: NextFunction) {
    return next();
  }
}
