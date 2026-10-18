import type { Response } from 'express';
import { object, string } from 'yup';
import type {
  RouteParams,
  TMiddleware,
} from '../../../modules/AbstractController.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';

/** The internal detail a leaking validation catch would echo to the client. */
export const LEAK_SECRET =
  'secret internal detail at mongodb://admin:s3cret@10.0.0.5/prod';

// A yup `.test` that throws a non-yup Error: `YupDriver` rethrows it raw (it is
// not a yup `ValidationError`), so it reaches the validation-phase catch as a
// generic server-side error — the info-leak path this fixture exercises.
const throwingSchema = object().shape({
  field: string().test('boom', 'boom', () => {
    throw new Error(LEAK_SECRET);
  }),
});

class ValidationLeakController extends AbstractController {
  get routes(): RouteParams {
    return {
      post: {
        '/throwingValidator': {
          handler: this.ok,
          request: throwingSchema,
        },
      },
    };
  }

  async ok(_req: FrameworkRequest, res: Response) {
    return res.status(200).json({ data: { ok: true } });
  }

  // Error-path fixture — no auth (the inherited default would 401 every request).
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

export default ValidationLeakController;
