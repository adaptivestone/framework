import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { StandardSchemaV1 } from '../../validate/types.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import Pagination, { type PaginationMiddlewareAppInfo } from './Pagination.ts';

/**
 * Pagination derives `{ page, limit, skip }` from `?page`/`?limit` against a
 * per-mount `{ limit, maxLimit }`. The critical invariant: a bad/zero/negative
 * limit falls back to the default and is clamped to `maxLimit` — never 0, which
 * Mongoose reads as "no limit" and would defeat `maxLimit`.
 */

const validateQuery = async (value: unknown) => {
  const schema = Pagination.relatedQueryParameters as StandardSchemaV1<
    unknown,
    { page?: number; limit?: number }
  >;
  return schema['~standard'].validate(value);
};

const runMiddleware = async (
  params: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const mw = new Pagination(appInstance, params);
  const req = { query, appInfo: {} } as unknown as FrameworkRequest &
    PaginationMiddlewareAppInfo;
  const next = vi.fn();
  await mw.middleware(req, {} as Response, next);
  expect(next).toHaveBeenCalledOnce();
  return req.appInfo.pagination;
};

describe('Pagination — relatedQueryParameters schema', () => {
  it('coerces numeric strings to numbers', async () => {
    expect(await validateQuery({ page: '2', limit: '25' })).toEqual({
      value: { page: 2, limit: 25 },
    });
  });

  it('skips empty/undefined/null params', async () => {
    expect(await validateQuery({ page: '', limit: undefined })).toEqual({
      value: {},
    });
    expect(await validateQuery(undefined)).toEqual({ value: {} });
  });

  it('reports an issue for a non-numeric value', async () => {
    const res = await validateQuery({ limit: 'abc' });
    expect(res).toEqual({
      issues: [{ message: 'limit must be a number', path: ['limit'] }],
    });
  });
});

describe('Pagination — middleware clamping', () => {
  it('uses the configured default when no query is given', async () => {
    expect(await runMiddleware({ limit: 10, maxLimit: 100 }, {})).toEqual({
      page: 1,
      limit: 10,
      skip: 0,
    });
  });

  it('honors a valid ?limit within maxLimit', async () => {
    expect(
      await runMiddleware({ limit: 10, maxLimit: 100 }, { limit: '20' }),
    ).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('clamps ?limit above maxLimit down to maxLimit', async () => {
    const p = await runMiddleware(
      { limit: 10, maxLimit: 50 },
      { limit: '9999' },
    );
    expect(p.limit).toBe(50);
  });

  it('falls back to default (never 0) for a zero/negative/NaN limit', async () => {
    for (const bad of ['0', '-5', 'abc']) {
      const p = await runMiddleware(
        { limit: 10, maxLimit: 100 },
        { limit: bad },
      );
      expect(p.limit).toBe(10); // default, NOT 0 — the Mongoose "no limit" footgun
    }
  });

  it('computes skip from page and limit, defaulting page to 1', async () => {
    expect(
      await runMiddleware(
        { limit: 10, maxLimit: 100 },
        { page: '3', limit: '10' },
      ),
    ).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it('clamps a non-positive page to 1', async () => {
    const p = await runMiddleware({ limit: 10, maxLimit: 100 }, { page: '0' });
    expect(p.page).toBe(1);
    expect(p.skip).toBe(0);
  });

  it('accepts string-typed params (parseInt path) and applies their defaults', async () => {
    // limit/maxLimit arrive as strings (e.g. from a route Map); a too-large
    // request clamps to the string maxLimit once parsed.
    const p = await runMiddleware(
      { limit: '5', maxLimit: '40' },
      { limit: '999' },
    );
    expect(p.limit).toBe(40);
  });
});
