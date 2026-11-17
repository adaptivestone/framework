import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { it } from 'node:test';
import type { Request, Response } from 'express';
import { ExpressResponseWriter } from './ExpressResponseWriter.ts';
import { HttpResponse } from './responses.ts';

/** Only the transport operations the writer needs for an unread body. */
function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    destroyed: false,
    headersSent: false,
    getHeaders: () => ({}),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader() {},
    end() {},
  });
}

it('HEAD closes an unread file stream, including a failed open', async (t) => {
  for (const path of [
    new URL('./ExpressResponseWriter.ts', import.meta.url),
    new URL('./nonexistent-stream-review-fixture', import.meta.url),
  ]) {
    const source = createReadStream(path);
    // No test error listener: an unhandled open error must fail this test.
    const closed = new Promise<void>((resolve) =>
      source.once('close', resolve),
    );
    t.after(() => source.destroy());
    await new ExpressResponseWriter().write(
      HttpResponse.stream(200, source),
      { method: 'HEAD' } as Request,
      response() as unknown as Response,
    );
    assert.ok(source.destroyed, 'HEAD destroys the unread source');
    await closed;
    assert.ok(source.closed);
    assert.ok('fd' in source);
    assert.strictEqual(source.fd, null);
  }
});

it('HEAD handles an error queued by an already destroyed Node stream', async () => {
  const source = new Readable({ read() {} });
  const closed = new Promise<void>((resolve) => source.once('close', resolve));
  source.destroy(new Error('queued source error'));
  await new ExpressResponseWriter().write(
    HttpResponse.stream(200, source),
    { method: 'HEAD' } as Request,
    response() as unknown as Response,
  );
  await closed;
  assert.ok(source.destroyed);
});

it('disconnect destroys a Node stream with a pending first read', async (t) => {
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const source = new Readable({ read: () => started() });
  t.after(() => source.destroy());
  const closed = new Promise<void>((resolve) => source.once('close', resolve));
  const res = response();
  const written = new ExpressResponseWriter().write(
    HttpResponse.stream(200, source),
    { method: 'GET' } as Request,
    res as unknown as Response,
  );
  await reading;
  res.destroyed = true;
  res.emit('close');
  await written;
  assert.ok(source.destroyed, 'disconnect destroys the pending source');
  await closed;
});

it('a transform replacing a Node file stream closes the unread file', async (t) => {
  const source = createReadStream(
    new URL('./ExpressResponseWriter.ts', import.meta.url),
  );
  t.after(() => source.destroy());
  const closed = new Promise<void>((resolve) => source.once('close', resolve));
  await new ExpressResponseWriter({
    transform: () => HttpResponse.empty(204),
  }).write(
    HttpResponse.stream(200, source),
    { method: 'GET' } as Request,
    response() as unknown as Response,
  );
  assert.ok(source.destroyed, 'replacement destroys the discarded source');
  await closed;
  assert.ok('fd' in source);
  assert.strictEqual(source.fd, null);
});
