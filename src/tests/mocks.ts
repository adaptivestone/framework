import type { TI18n } from '../services/i18n/I18n.ts';

type AnyFunction = (...args: never[]) => unknown;

/**
 * Per-request i18n stub for middleware tests: resolves exactly the keys it is
 * given; anything else behaves like a miss and hands back the caller's
 * `defaultValue` (or the key, matching i18next).
 */
export const stubI18n = (resources: Record<string, string>) =>
  ({
    language: 'en',
    t: (key: string, options?: { defaultValue?: string }) =>
      resources[key] ?? options?.defaultValue ?? key,
  }) as unknown as TI18n;

type ConfigurableMock = {
  mock: {
    callCount(): number;
    mockImplementation(implementation: AnyFunction): void;
    mockImplementationOnce(implementation: AnyFunction, onCall?: number): void;
  };
};

const nextOnceCall = new WeakMap<object, number>();

function onceIndex(value: ConfigurableMock): number {
  const index = nextOnceCall.get(value) ?? value.mock.callCount();
  nextOnceCall.set(value, index + 1);
  return index;
}

export function mockImplementation<T extends ConfigurableMock>(
  value: T,
  implementation: AnyFunction,
): T {
  value.mock.mockImplementation(implementation);
  return value;
}

export function mockImplementationOnce<T extends ConfigurableMock>(
  value: T,
  implementation: AnyFunction,
): T {
  value.mock.mockImplementationOnce(implementation, onceIndex(value));
  return value;
}

export function mockReturnValue<T extends ConfigurableMock>(
  value: T,
  result: unknown,
): T {
  return mockImplementation(value, () => result);
}

export function mockReturnValueOnce<T extends ConfigurableMock>(
  value: T,
  result: unknown,
): T {
  return mockImplementationOnce(value, () => result);
}

export function mockResolvedValue<T extends ConfigurableMock>(
  value: T,
  result: unknown,
): T {
  return mockImplementation(value, () => Promise.resolve(result));
}

export function mockResolvedValueOnce<T extends ConfigurableMock>(
  value: T,
  result: unknown,
): T {
  return mockImplementationOnce(value, () => Promise.resolve(result));
}

export function mockRejectedValue<T extends ConfigurableMock>(
  value: T,
  error: unknown,
): T {
  return mockImplementation(value, () => Promise.reject(error));
}

export function mockRejectedValueOnce<T extends ConfigurableMock>(
  value: T,
  error: unknown,
): T {
  return mockImplementationOnce(value, () => Promise.reject(error));
}
