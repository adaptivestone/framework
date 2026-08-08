import type { Response } from 'express';
import mongoose from 'mongoose';
import { number, object, string } from 'yup';
import type {
  RouteParams,
  TMiddleware,
} from '../../../modules/AbstractController.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';

// A bare Mongoose model whose `ref` path is an ObjectId, so an uncastable
// string reaching it throws a `CastError` (NOT a `ValidationError`) straight
// out of the query — the exact shape a `:id` route produces without a schema.
const paramCastSchema = new mongoose.Schema({
  ref: { type: mongoose.Schema.Types.ObjectId },
});
const ParamCastModel =
  mongoose.models.ParamCastFixture ??
  mongoose.model('ParamCastFixture', paramCastSchema);

/** A server-side constant the client can never have sent. */
export const SERVER_SIDE_BAD_ID = 'server-side-not-an-id';

/**
 * Exercises the route-level `params:` schema (validation, coercion, and the
 * untouched raw `req.params` contract) plus the standalone-`CastError` floor
 * for routes that declare no schema. Every echo route returns both surfaces so
 * a test can assert the validated output and the raw strings independently.
 */
class ParamsController extends AbstractController {
  get routes(): RouteParams {
    return {
      get: {
        // The canonical id case — a 24-hex guard replacing the in-handler
        // regex the docs recipe used to prescribe.
        '/id/:id': {
          handler: this.echoParams,
          params: object().shape({
            id: string()
              .matches(/^[0-9a-fA-F]{24}$/, 'must be a valid id')
              .required(),
          }),
        },
        // Coercion: the raw segment is a string, the validated output a number.
        '/count/:n': {
          handler: this.echoParams,
          params: object().shape({ n: number().required() }),
        },
        // No `params:` declared — `appInfo.params` must still be readable.
        '/bare/:id': { handler: this.echoParams },
        // No `params:` schema — the raw string goes straight to Mongoose and
        // cast-fails. The value IS client-supplied, so the floor must turn it
        // into a 400 naming the param.
        '/cast/:id': { handler: this.castFromParam },
        // The uncastable value is a server-side constant the client never sent
        // — a genuine server defect that must stay an honest 500.
        '/castInternal/:id': { handler: this.castFromServer },
        // Two params, so a failure has to name the right one.
        '/multi/:group/:slug': {
          handler: this.echoParams,
          params: object().shape({
            group: string().oneOf(['a', 'b']).required(),
            slug: string().min(3).required(),
          }),
        },
      },
    };
  }

  async echoParams(req: FrameworkRequest, res: Response) {
    const validated = req.appInfo.params;
    return res.status(200).json({
      data: {
        params: validated,
        rawParams: req.params,
        types: Object.fromEntries(
          Object.entries(validated ?? {}).map(([k, v]) => [k, typeof v]),
        ),
      },
    });
  }

  async castFromParam(req: FrameworkRequest, res: Response) {
    const doc = await ParamCastModel.findOne({ ref: req.params.id });
    return res.status(200).json({ data: { found: !!doc } });
  }

  async castFromServer(_req: FrameworkRequest, res: Response) {
    const doc = await ParamCastModel.findOne({ ref: SERVER_SIDE_BAD_ID });
    return res.status(200).json({ data: { found: !!doc } });
  }

  // Error-path routes only — drop the inherited `[GetUserByToken, Auth]` that
  // would 401 every request.
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

export default ParamsController;
