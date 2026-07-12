import type { Response } from 'express';
import { object, string } from 'yup';
import type {
  RouteParams,
  TMiddleware,
} from '../../../modules/AbstractController.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';
import type { StandardSchemaV1 } from '../../../services/validate/types.ts';

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

// A value no `ValidatorDriver` matches (no `~standard`, keys are not media
// types): `new ValidateService(app, schema)` throws its developer-facing "No
// ValidatorDriver matches…" message at construction — a server-side config bug.
const noDriverSchema = { notASchema: true } as unknown as StandardSchemaV1;

class ValidationLeakController extends AbstractController {
  get routes(): RouteParams {
    return {
      post: {
        '/throwingValidator': {
          handler: this.ok,
          request: throwingSchema,
        },
        '/noDriver': {
          handler: this.ok,
          request: noDriverSchema,
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
