// A response kind the framework might add in a minor, simulated by declaration
// merging. Compiled as its own program (the augmentation would leak into any
// other file of the same program): code written the supported way — narrow on
// the kinds you handle, pass the rest through — must keep compiling.
import type { TransformResponseHook } from '@adaptivestone/framework/server.js';
import Middleware from '@adaptivestone/framework/services/http/middleware/Middleware.js';
import type {
  Next,
  RequestContext,
} from '@adaptivestone/framework/services/http/RequestContext.js';
import {
  HttpResponse,
  type HttpResponseKind,
  type ResponseHeaders,
} from '@adaptivestone/framework/services/http/responses.js';

declare module '@adaptivestone/framework/services/http/responses.js' {
  interface SimulatedResponse {
    readonly kind: 'simulated';
    readonly status: number;
    readonly headers: ResponseHeaders;
    readonly payload: Uint8Array;
  }
  interface HttpResponseKinds {
    simulated: SimulatedResponse;
  }
}

// 1. transformResponse: reshape one kind, pass the rest through.
const envelope: TransformResponseHook = (response) =>
  response.kind === 'json'
    ? HttpResponse.json(
        response.status,
        { data: response.body },
        { headers: response.headers, contentType: response.contentType },
      )
    : response;

// 2. A switch with a pass-through default (the text body stays typed).
const byKind: TransformResponseHook = (response) => {
  switch (response.kind) {
    case 'text': {
      const body: string = response.body;
      void body;
      return response;
    }
    default:
      return response;
  }
};

// 3. A middleware inspecting what `await next()` returned.
class KindHeader extends Middleware {
  async middleware(ctx: RequestContext, next: Next) {
    const response = await next();
    if (response.kind === 'stream') {
      void response.body;
    }
    ctx.response.setHeader('x-kind', response.kind);
    return response;
  }
}

// 4. The kind union grew.
const added: HttpResponseKind = 'simulated';

// 5. Unsupported on purpose (documented): an exhaustive `never` check breaks.
function exhaustive(response: HttpResponse): number {
  switch (response.kind) {
    case 'json':
    case 'text':
    case 'bytes':
    case 'stream':
    case 'redirect':
    case 'empty':
    case 'native':
    case 'sent':
      return response.status;
    default: {
      // @ts-expect-error — a kind added in a minor breaks exhaustive checks; pass unknown kinds through
      const unreachable: never = response;
      return unreachable;
    }
  }
}

void [envelope, byKind, KindHeader, added, exhaustive];
