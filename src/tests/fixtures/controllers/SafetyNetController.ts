import type { Response } from 'express';
import mongoose from 'mongoose';
import { object, string } from 'yup';
import type {
  RouteParams,
  TMiddleware,
} from '../../../modules/AbstractController.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';

// A bare Mongoose model (not a framework `BaseModel`) whose constraints the
// route schemas below deliberately DON'T mirror, so `save()` throws a Mongoose
// `ValidationError` that escapes into the wrapped-handler catch:
//   - `name`     — public field name (a route input key) → matched path
//   - `userName` — renamed target the client never sends under that name
//   - `secret`   — internal required field the client never sees
const safetyNetSchema = new mongoose.Schema({
  name: { type: String, maxlength: 5 },
  userName: { type: String, maxlength: 5 },
  secret: { type: String, required: true },
});
const SafetyNetModel =
  mongoose.models.SafetyNetFixture ??
  mongoose.model('SafetyNetFixture', safetyNetSchema);

class SafetyNetController extends AbstractController {
  get routes(): RouteParams {
    return {
      post: {
        // `name` fails maxlength; its path IS a route input key → 400.
        '/matched': {
          handler: this.saveName,
          request: object().shape({ name: string() }),
        },
        // Same failing value, but stored under model path `userName` — not a
        // route input key → stays 500.
        '/renamed': {
          handler: this.saveRenamed,
          request: object().shape({ name: string() }),
        },
        // Internal required `secret` omitted (`name` valid) → path `secret` is
        // not a route input key → stays 500.
        '/internal': {
          handler: this.saveInternal,
          request: object().shape({ name: string() }),
        },
        // `name` fails (matched) AND `secret` missing (unmatched) → mixed → 500.
        '/mixed': {
          handler: this.saveMixed,
          request: object().shape({ name: string() }),
        },
        // No request/query schema → no input keys → nothing matches → 500.
        '/noSchema': {
          handler: this.saveTooLong,
        },
        // Failing path `name` matches a route input key sourced from `query`
        // (the request ∪ query union) → 400.
        '/queryMatched': {
          handler: this.saveNameFromQuery,
          query: object().shape({ name: string() }),
        },
        // Responds 200 first, then `save()` throws — the `headersSent` guard
        // must win over the safety net; the client keeps its 200.
        '/afterSend': {
          handler: this.saveAfterSend,
          request: object().shape({ name: string() }),
        },
        // Route-level (framework) `ValidationError` — handled by the
        // pre-handler 400 path; never reaches the handler catch.
        '/routeValidation': {
          handler: this.saveTooLong,
          request: object().shape({ mustHave: string().required() }),
        },
      },
    };
  }

  async saveName(req: FrameworkRequest, res: Response) {
    const doc = new SafetyNetModel({
      name: String(req.appInfo.request.name),
      secret: 'ok',
    });
    await doc.save();
    return res.status(200).json({ data: { saved: true } });
  }

  async saveRenamed(req: FrameworkRequest, res: Response) {
    const doc = new SafetyNetModel({
      userName: String(req.appInfo.request.name),
      secret: 'ok',
    });
    await doc.save();
    return res.status(200).json({ data: { saved: true } });
  }

  async saveInternal(_req: FrameworkRequest, res: Response) {
    const doc = new SafetyNetModel({ name: 'ok' }); // `secret` (required) omitted
    await doc.save();
    return res.status(200).json({ data: { saved: true } });
  }

  async saveMixed(req: FrameworkRequest, res: Response) {
    const doc = new SafetyNetModel({ name: String(req.appInfo.request.name) }); // + `secret` omitted
    await doc.save();
    return res.status(200).json({ data: { saved: true } });
  }

  async saveTooLong(_req: FrameworkRequest, res: Response) {
    const doc = new SafetyNetModel({ name: 'way-too-long', secret: 'ok' });
    await doc.save();
    return res.status(200).json({ data: { saved: true } });
  }

  async saveNameFromQuery(req: FrameworkRequest, res: Response) {
    const doc = new SafetyNetModel({
      name: String(req.appInfo.query.name),
      secret: 'ok',
    });
    await doc.save();
    return res.status(200).json({ data: { saved: true } });
  }

  async saveAfterSend(req: FrameworkRequest, res: Response) {
    res.status(200).json({ data: { saved: 'already' } });
    const doc = new SafetyNetModel({
      name: String(req.appInfo.request.name),
      secret: 'ok',
    });
    await doc.save(); // throws AFTER the response headers are sent
  }

  // These routes exercise the error path only — no auth. Override the inherited
  // default `[GetUserByToken, Auth]` (which would 401 every request) with an
  // empty Map.
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

export default SafetyNetController;
