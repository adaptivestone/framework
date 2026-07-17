import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../appInstance.ts';

const mockedRedis = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const client = {
    connect: vi.fn(() => Promise.reject(new Error('connect down'))),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return client;
    }),
    quit: vi.fn(() => Promise.resolve()),
    isOpen: false,
  };
  return { client, handlers, createClient: vi.fn(() => client) };
});

vi.mock('@redis/client', () => ({
  createClient: mockedRedis.createClient,
}));

import { getRedisClient, getRedisClientSync } from './redisConnection.ts';

describe('redisConnection failure recovery', () => {
  it('clears a failed client, logs sync failures, and forwards client errors', async () => {
    const logError = vi
      .spyOn(appInstance.logger, 'error')
      .mockImplementation(() => appInstance.logger);
    try {
      await expect(getRedisClient()).rejects.toThrow('connect down');
      await Promise.resolve();

      await expect(getRedisClient()).rejects.toThrow('connect down');
      expect(mockedRedis.createClient).toHaveBeenCalledTimes(2);
      await Promise.resolve();

      expect(getRedisClientSync()).toBe(mockedRedis.client);
      await Promise.resolve();
      await Promise.resolve();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('Redis connect failed'),
      );

      mockedRedis.handlers.get('error')?.('socket down', 'extra-a', 'extra-b');
      expect(logError).toHaveBeenCalledWith(
        'Redis Client Error',
        'socket down',
        'extra-a',
        'extra-b',
      );
    } finally {
      logError.mockRestore();
    }
  });
});
