import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import { createTestContext } from '../../../tests/createTestContext.ts';
import { HttpResponse } from '../responses.ts';
import type { BaseAppInfo } from '../types.ts';
import PrepareAppInfo from './PrepareAppInfo.ts';

const next = async () => HttpResponse.empty(204);

describe('prepareAppInfo methods', () => {
  it('have description fields', async () => {
    assert.notStrictEqual(PrepareAppInfo.description, undefined);
  });

  it('fills appInfo and keeps what is already there', async () => {
    const middleware = new PrepareAppInfo(appInstance);
    let isCalled = false;
    const ctx = createTestContext<Partial<BaseAppInfo> & { test?: number }>();
    await middleware.middleware(ctx, async () => {
      isCalled = true;
      return HttpResponse.empty(204);
    });

    assert.ok(isCalled);
    assert.strictEqual(ctx.appInfo.app, appInstance);

    ctx.appInfo.test = 5;
    const request = ctx.appInfo.request;
    await middleware.middleware(ctx, next);

    assert.strictEqual(ctx.appInfo.test, 5);
    assert.strictEqual(ctx.appInfo.request, request);
  });

  it('initializes request, query and params to {} so schema-less routes can read them', async () => {
    // The declared `appInfo.request`/`.query` types are non-optional, but a
    // route without schemas never has them assigned by the validation wrapper.
    // `PrepareAppInfo` must seed them so a handler reading them can't crash.
    const ctx = createTestContext<Partial<BaseAppInfo>>();
    await new PrepareAppInfo(appInstance).middleware(ctx, next);

    assert.deepStrictEqual(ctx.appInfo.request, {});
    assert.deepStrictEqual(ctx.appInfo.query, {});
    assert.deepStrictEqual(ctx.appInfo.params, {});
  });
});
