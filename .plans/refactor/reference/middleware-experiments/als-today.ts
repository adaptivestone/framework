// biome-ignore-all lint: experiment script kept as it was run; see README.md
// Can a middleware put data into AsyncLocalStorage for the handler — with TODAY's framework code?
// Real ExpressAdapter + RouteRegistry + AbstractMiddleware, real Express server.
import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import AbstractMiddleware from '../../../../src/services/http/middleware/AbstractMiddleware.ts';
import { createExpressAdapter } from '../../../../src/services/http/routing/ExpressAdapter.ts';
import { RouteRegistry } from '../../../../src/services/http/routing/RouteRegistry.ts';

const als = new AsyncLocalStorage<{ user: string }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeApp = { getConfig: () => ({}), logger: console } as never;

// Deep service code that never sees req: reads the store.
async function service() {
  await sleep(1);
  return als.getStore()?.user ?? '(nothing)';
}

class RunAroundNext extends AbstractMiddleware {
  async middleware(_req: unknown, _res: unknown, next: () => void) {
    als.run({ user: 'alice' }, () => next());
  }
}
class EnterWithBeforeAwait extends AbstractMiddleware {
  async middleware(_req: unknown, _res: unknown, next: () => void) {
    als.enterWith({ user: 'alice' });
    await sleep(1); // e.g. a DB lookup
    next();
  }
}
class EnterWithAfterAwait extends AbstractMiddleware {
  async middleware(_req: unknown, _res: unknown, next: () => void) {
    await sleep(1); // e.g. a DB lookup — the user is known only after this
    als.enterWith({ user: 'alice' });
    next();
  }
}

const registry = new RouteRegistry();
const handler = async (_req: unknown, res: express.Response) =>
  res.json({ user: await service() });
registry.registerRoute('GET', '/run', {
  handler,
  middlewares: [{ Class: RunAroundNext as never }],
});
registry.registerRoute('GET', '/enter-before', {
  handler,
  middlewares: [{ Class: EnterWithBeforeAwait as never }],
});
registry.registerRoute('GET', '/enter-after', {
  handler,
  middlewares: [{ Class: EnterWithAfterAwait as never }],
});
registry.registerRoute('GET', '/express-level', { handler });

const app = express();
// An Express middleware mounted BEFORE the framework adapter (Express `next` is synchronous).
app.use((req, _res, next) => {
  if (req.path === '/express-level') als.run({ user: 'alice' }, next);
  else next();
});
app.use(createExpressAdapter(registry, fakeApp));

const server = http.createServer(app).listen(0, async () => {
  const { port } = server.address() as AddressInfo;
  const runtime =
    typeof Bun === 'undefined'
      ? `node ${process.version}`
      : `bun ${Bun.version}`;
  console.log(
    `TODAY's framework middleware (${runtime}) — handler sees the user?`,
  );
  for (const path of [
    '/run',
    '/enter-before',
    '/enter-after',
    '/express-level',
  ]) {
    const body = await (await fetch(`http://127.0.0.1:${port}${path}`)).json();
    console.log(`  ${path.padEnd(15)} → ${body.user}`);
  }
  server.close();
});
