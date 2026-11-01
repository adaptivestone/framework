import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after, before, describe, it } from 'node:test';
import { createTestContext } from '../../tests/createTestContext.ts';
import {
  composeChain,
  type Handler,
  handleRequest,
  type Layer,
} from './pipeline.ts';
import type { Next, RequestContext } from './RequestContext.ts';
import { requestContext } from './requestScope.ts';
import { HttpResponse } from './responses.ts';

type Ctx = RequestContext<{ user?: string; seen?: unknown[] }>;

const OK = HttpResponse.json(200, { ok: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(1 + Math.floor(Math.random() * 4));
const layer = (
  name: string,
  run: (ctx: Ctx, next: Next) => HttpResponse | Promise<HttpResponse>,
): Layer<Ctx> => ({ name, run });
const ctxFor = (appInfo: Ctx['appInfo'] = {}) =>
  createTestContext<Ctx['appInfo']>({ appInfo });
const outcome = async (p: Promise<HttpResponse>) => {
  try {
    return { value: await p, error: undefined as unknown };
  } catch (error) {
    return { value: undefined, error };
  }
};

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
before(() => {
  process.on('unhandledRejection', onUnhandled);
});
after(() => {
  process.off('unhandledRejection', onUnhandled);
});

for (const diagnostics of [false, true]) {
  const mode = diagnostics ? 'with diagnostics' : 'production';
  const chain = (layers: Layer<Ctx>[], handler: Handler<Ctx>) =>
    composeChain(layers, handler, { diagnostics });

  describe(`pipeline (${mode}) — contract`, () => {
    it('return next() continues; the handler response comes back', async () => {
      const order: string[] = [];
      const run = chain(
        [
          layer('A', async (_ctx, next) => {
            order.push('a');
            await jitter();
            return next();
          }),
          layer('B', (_ctx, next) => {
            order.push('b');
            return next();
          }),
        ],
        () => {
          order.push('handler');
          return OK;
        },
      );
      assert.strictEqual(await run(ctxFor()), OK);
      assert.deepStrictEqual(order, ['a', 'b', 'handler']);
    });

    it('a returned response stops the chain', async () => {
      let handlerRuns = 0;
      const run = chain(
        [layer('Role', () => HttpResponse.json(403, { error: 'NO_ACCESS' }))],
        () => {
          handlerRuns += 1;
          return OK;
        },
      );
      const response = await run(ctxFor());
      assert.strictEqual(response.status, 403);
      assert.strictEqual(handlerRuns, 0);
    });

    it('code after await next() sees and can replace the response', async () => {
      const run = chain(
        [
          layer('Wrap', async (_ctx, next) => {
            const response = await next();
            return HttpResponse.json(response.status, { wrapped: true });
          }),
        ],
        () => OK,
      );
      const response = await run(ctxFor());
      assert.strictEqual(response.kind, 'json');
      assert.deepStrictEqual(response.kind === 'json' && response.body, {
        wrapped: true,
      });
    });

    it('the original error travels up unchanged (also a non-Error), wrappers roll back', async () => {
      const tx = { commit: 0, rollback: 0, open: 0 };
      const transaction = layer('Transaction', async (_ctx, next) => {
        tx.open += 1;
        try {
          const response = await next();
          tx.commit += 1;
          return response;
        } catch (error) {
          tx.rollback += 1;
          throw error;
        } finally {
          tx.open -= 1;
        }
      });
      const boom = new Error('boom');
      const failing = await outcome(
        chain([transaction], async () => {
          await jitter();
          throw boom;
        })(ctxFor()),
      );
      assert.strictEqual(failing.error, boom);
      const plain = await outcome(
        chain([transaction], () => {
          throw 'plain string';
        })(ctxFor()),
      );
      assert.strictEqual(plain.error, 'plain string');
      assert.deepStrictEqual(tx, { commit: 0, rollback: 2, open: 0 });
    });

    it("a middleware's own AsyncLocalStorage store reaches later middleware, the handler and deep code", async () => {
      const userStore = new AsyncLocalStorage<string>();
      const service = async () => {
        await jitter();
        return userStore.getStore();
      };
      const run = chain(
        [
          layer('UserScope', (ctx, next) =>
            userStore.run(ctx.appInfo.user ?? '', next),
          ),
          layer('Later', async (ctx, next) => {
            await jitter();
            ctx.appInfo.seen = [userStore.getStore()];
            return next();
          }),
        ],
        async (ctx) => {
          ctx.appInfo.seen?.push(userStore.getStore(), await service());
          return OK;
        },
      );
      const ctxs = Array.from({ length: 40 }, (_, i) =>
        ctxFor({ user: `user-${i}` }),
      );
      await Promise.all(ctxs.map((c) => run(c)));
      for (const c of ctxs) {
        const u = c.appInfo.user;
        assert.deepStrictEqual(c.appInfo.seen, [u, u, u]);
      }
    });

    it('next() returns a Promise for a synchronous early response and a synchronous throw', async () => {
      const consume = layer('Consumer', (_ctx, next) => next().then((r) => r));
      const early = await chain(
        [consume, layer('Deny', () => HttpResponse.json(403, {}))],
        () => OK,
      )(ctxFor());
      assert.strictEqual(early.status, 403);
      const failed = await outcome(
        chain(
          [
            consume,
            layer('Fail', () => {
              throw new Error('sync failure');
            }),
          ],
          () => OK,
        )(ctxFor()),
      );
      assert.strictEqual((failed.error as Error).message, 'sync failure');
    });

    it('a client abort stops the chain before the next layer', async () => {
      const controller = new AbortController();
      let handlerRuns = 0;
      const run = chain(
        [
          layer('Aborts', (_ctx, next) => {
            controller.abort(new Error('client gone'));
            return next();
          }),
        ],
        () => {
          handlerRuns += 1;
          return OK;
        },
      );
      const result = await outcome(
        run(createTestContext({ signal: controller.signal })),
      );
      assert.strictEqual((result.error as Error).message, 'client gone');
      assert.strictEqual(handlerRuns, 0);
    });
  });

  describe(`pipeline (${mode}) — guards`, () => {
    it('next() called twice fails the request; the handler runs once', async () => {
      let runs = 0;
      const result = await outcome(
        chain(
          [
            layer('Twice', async (_ctx, next) => {
              const first = next();
              next();
              return first;
            }),
          ],
          async () => {
            runs += 1;
            await jitter();
            return OK;
          },
        )(ctxFor()),
      );
      assert.match(
        (result.error as Error).message,
        /Twice: next\(\) called twice/,
      );
      assert.strictEqual(runs, 1);
    });

    it('next() not awaited, another response returned: the handler finishes first, no unhandled rejection', async () => {
      const before = unhandled.length;
      let handlerDone = false;
      let doneAtAnswer: boolean | undefined;
      const result = await outcome(
        chain(
          [
            layer('Early', async (_ctx, next) => {
              next();
              return HttpResponse.json(202, {});
            }),
          ],
          async () => {
            await sleep(10);
            handlerDone = true;
            throw new Error('late failure');
          },
        )(ctxFor()).then((v) => {
          doneAtAnswer = handlerDone;
          return v;
        }),
      );
      await sleep(20);
      assert.strictEqual(result.value?.status, 202);
      assert.strictEqual(doneAtAnswer, true);
      assert.strictEqual(unhandled.length, before);
    });

    it('a stored next() called after the response was chosen is refused; the handler never runs', async () => {
      let runs = 0;
      let lateError = '';
      await chain(
        [
          layer('Late', (_ctx, next) => {
            setTimeout(() => {
              next().catch((e: Error) => {
                lateError = e.message;
              });
            }, 5);
            return HttpResponse.json(200, {});
          }),
        ],
        () => {
          runs += 1;
          return OK;
        },
      )(ctxFor());
      await sleep(25);
      assert.strictEqual(runs, 0);
      assert.match(lateError, /after its middleware finished/);
    });

    it('a finished middleware cannot start its discarded suffix; the chosen 403 stays', async () => {
      let saved: Next | undefined;
      let runs = 0;
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const pending = outcome(
        chain(
          [
            layer('Outer', async (_ctx, next) => {
              const response = await next();
              await gate;
              return response;
            }),
            layer('Short', (_ctx, next) => {
              saved = next;
              return HttpResponse.json(403, {});
            }),
          ],
          () => {
            runs += 1;
            return OK;
          },
        )(ctxFor()),
      );
      await sleep(5);
      await assert.rejects(
        () => (saved as Next)(),
        /after its middleware finished/,
      );
      release();
      const result = await pending;
      assert.strictEqual(result.value?.status, 403);
      assert.strictEqual(runs, 0);
    });

    it('a late call after a forwarding middleware finished keeps the chosen response', async () => {
      let saved: Next | undefined;
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const pending = outcome(
        chain(
          [
            layer('Outer', async (_ctx, next) => {
              const response = await next();
              await gate;
              return response;
            }),
            layer('Forward', (_ctx, next) => {
              saved = next;
              return next();
            }),
          ],
          () => OK,
        )(ctxFor()),
      );
      await sleep(5);
      await assert.rejects(
        () => (saved as Next)(),
        /after its middleware finished/,
      );
      release();
      assert.strictEqual((await pending).value, OK);
    });

    it('waits for started downstream cleanup before answering', async () => {
      let release: () => void = () => {};
      const cleanup = new Promise<void>((r) => {
        release = r;
      });
      let cleaned = false;
      let answered = false;
      const pending = chain(
        [
          layer('Drop', (_ctx, next) => {
            next();
            return HttpResponse.json(202, {});
          }),
          layer('Cleanup', async (_ctx, next) => {
            try {
              return await next();
            } finally {
              await cleanup;
              cleaned = true;
            }
          }),
        ],
        () => OK,
      )(ctxFor()).then((v) => {
        answered = true;
        return v;
      });
      await sleep(5);
      assert.strictEqual(answered, false);
      release();
      assert.strictEqual((await pending).status, 202);
      assert.strictEqual(cleaned, true);
    });

    it('throw after an un-awaited next(): the error after the handler ends', async () => {
      let handlerDone = false;
      let doneAtAnswer: boolean | undefined;
      const result = await outcome(
        chain(
          [
            layer('Thrower', async (_ctx, next) => {
              next();
              throw new Error('middleware failed');
            }),
          ],
          async () => {
            await sleep(10);
            handlerDone = true;
            return OK;
          },
        )(ctxFor()).finally(() => {
          doneAtAnswer = handlerDone;
        }),
      );
      assert.strictEqual((result.error as Error).message, 'middleware failed');
      assert.strictEqual(doneAtAnswer, true);
    });

    it('a delayed outer middleware leaves no unhandled rejection', async () => {
      const before = unhandled.length;
      const result = await outcome(
        chain(
          [
            layer('Outer', async (_ctx, next) => {
              next();
              await sleep(30);
              return HttpResponse.json(202, {});
            }),
            layer('Forward', async (_ctx, next) => next()),
          ],
          async () => {
            throw new Error('handler failed early');
          },
        )(ctxFor()),
      );
      await sleep(20);
      assert.strictEqual(result.value?.status, 202);
      assert.strictEqual(unhandled.length, before);
    });

    it('a forgotten return is a TypeError', async () => {
      const result = await outcome(
        chain(
          [
            // Simulates JavaScript code; TypeScript rejects this signature.
            layer('Forgot', (async (_ctx: Ctx, next: Next) => {
              await next();
            }) as unknown as Layer<Ctx>['run']),
          ],
          () => OK,
        )(ctxFor()),
      );
      assert.ok(result.error instanceof TypeError);
      if (diagnostics) {
        assert.match(result.error.message, /Forgot must return a response/);
      }
    });
  });
}

describe('handleRequest', () => {
  it('turns an error that reached the top into a response once, keeping the original', async () => {
    const boom = new Error('boom');
    let resolved = 0;
    const ctx = ctxFor();
    const response = await handleRequest(
      ctx,
      composeChain<Ctx>([], () => {
        throw boom;
      }),
      (error) => {
        resolved += 1;
        assert.strictEqual(error, boom);
        return HttpResponse.json(500, { error: 'SERVER_ERROR' });
      },
    );
    assert.strictEqual(response.status, 500);
    assert.strictEqual(resolved, 1);
    assert.strictEqual(ctx.error, boom);
    assert.strictEqual(ctx.failed, true);
  });

  it('requestContext() returns the request from anywhere in its async work', async () => {
    const deep = async () => {
      await jitter();
      return requestContext();
    };
    const ctxs = Array.from({ length: 20 }, () => ctxFor());
    const seen = await Promise.all(
      ctxs.map(async (ctx) => {
        let found: unknown;
        await handleRequest(
          ctx,
          composeChain<Ctx>([], async () => {
            found = await deep();
            return OK;
          }),
          () => OK,
        );
        return found;
      }),
    );
    seen.forEach((found, i) => {
      assert.strictEqual(found, ctxs[i]);
    });
    assert.strictEqual(requestContext(), undefined);
  });
});
