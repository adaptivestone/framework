import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const asymmetricMatcher = Symbol('asymmetricMatcher');

type Matcher = {
  [asymmetricMatcher]: (actual: unknown) => boolean;
  description: string;
};

type FunctionLike = ((...args: never[]) => unknown) & { readonly name: string };

function matcher(
  description: string,
  predicate: (actual: unknown) => boolean,
): Matcher {
  return { [asymmetricMatcher]: predicate, description };
}

function isMatcher(value: unknown): value is Matcher {
  return (
    typeof value === 'object' && value !== null && asymmetricMatcher in value
  );
}

function valueMatches(actual: unknown, expected: unknown): boolean {
  if (isMatcher(expected)) {
    return expected[asymmetricMatcher](actual);
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => valueMatches(actual[index], value))
    );
  }
  if (
    typeof expected === 'object' &&
    expected !== null &&
    typeof actual === 'object' &&
    actual !== null
  ) {
    const expectedRecord = expected as Record<PropertyKey, unknown>;
    const actualRecord = actual as Record<PropertyKey, unknown>;
    const expectedKeys = Reflect.ownKeys(expectedRecord);
    const actualKeys = Reflect.ownKeys(actualRecord);
    return (
      expectedKeys.length === actualKeys.length &&
      expectedKeys.every(
        (key) =>
          Object.hasOwn(actualRecord, key) &&
          valueMatches(actualRecord[key], expectedRecord[key]),
      )
    );
  }
  return isDeepStrictEqual(actual, expected);
}

function partialMatches(actual: unknown, expected: unknown): boolean {
  if (isMatcher(expected)) {
    return expected[asymmetricMatcher](actual);
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.every((value, index) => partialMatches(actual[index], value))
    );
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof actual !== 'object' || actual === null) {
      return false;
    }
    const expectedRecord = expected as Record<PropertyKey, unknown>;
    const actualRecord = actual as Record<PropertyKey, unknown>;
    return Reflect.ownKeys(expectedRecord).every(
      (key) =>
        Object.hasOwn(actualRecord, key) &&
        partialMatches(actualRecord[key], expectedRecord[key]),
    );
  }
  return isDeepStrictEqual(actual, expected);
}

function describeExpected(expected: unknown): string {
  return isMatcher(expected) ? expected.description : String(expected);
}

export const pattern = {
  any(type: FunctionLike): Matcher {
    return matcher(`any ${type.name}`, (actual) => {
      if (type === String) {
        return typeof actual === 'string';
      }
      if (type === Number) {
        return typeof actual === 'number';
      }
      if (type === Boolean) {
        return typeof actual === 'boolean';
      }
      if (type === BigInt) {
        return typeof actual === 'bigint';
      }
      if (type === Symbol) {
        return typeof actual === 'symbol';
      }
      return actual instanceof type;
    });
  },
  anything(): Matcher {
    return matcher(
      'anything except null or undefined',
      (actual) => actual != null,
    );
  },
  arrayContaining(expected: readonly unknown[]): Matcher {
    return matcher('an array containing the expected values', (actual) =>
      Array.isArray(actual)
        ? expected.every((value) =>
            actual.some((candidate) => valueMatches(candidate, value)),
          )
        : false,
    );
  },
  objectContaining(expected: Record<PropertyKey, unknown>): Matcher {
    return matcher('an object containing the expected properties', (actual) =>
      partialMatches(actual, expected),
    );
  },
  stringContaining(expected: string): Matcher {
    return matcher(`a string containing ${expected}`, (actual) =>
      typeof actual === 'string' ? actual.includes(expected) : false,
    );
  },
  stringMatching(expected: string | RegExp): Matcher {
    return matcher(`a string matching ${expected}`, (actual) =>
      typeof actual === 'string'
        ? typeof expected === 'string'
          ? actual.includes(expected)
          : expected.test(actual)
        : false,
    );
  },
};

export function assertMatches(actual: unknown, expected: unknown): void {
  assert.ok(
    valueMatches(actual, expected),
    `Expected value to match ${describeExpected(expected)}`,
  );
}

export function assertNotMatches(actual: unknown, expected: unknown): void {
  assert.ok(
    !valueMatches(actual, expected),
    `Expected value not to match ${describeExpected(expected)}`,
  );
}

export function assertMatchObject(actual: unknown, expected: unknown): void {
  assert.ok(
    partialMatches(actual, expected),
    'Expected object to contain shape',
  );
}

export function assertContainEqual(
  actual: readonly unknown[],
  expected: unknown,
): void {
  assert.ok(
    actual.some((candidate) => valueMatches(candidate, expected)),
    'Expected array to contain an equal value',
  );
}

export function assertTextMatch(
  actual: string,
  expected: string | RegExp,
  message?: string,
): void {
  if (typeof expected === 'string') {
    if (message) {
      assert.ok(actual.includes(expected), message);
    } else {
      assert.ok(actual.includes(expected));
    }
  } else {
    if (message) {
      assert.match(actual, expected, message);
    } else {
      assert.match(actual, expected);
    }
  }
}

export function assertTextNotMatch(
  actual: string,
  expected: string | RegExp,
): void {
  if (typeof expected === 'string') {
    assert.ok(!actual.includes(expected));
  } else {
    assert.doesNotMatch(actual, expected);
  }
}

export function assertHasProperty(
  actual: object,
  property: PropertyKey,
  expected?: unknown,
): void {
  assert.ok(property in actual);
  if (expected !== undefined) {
    assert.deepStrictEqual(
      (actual as Record<PropertyKey, unknown>)[property],
      expected,
    );
  }
}

export function assertThrowsLike(
  fn: () => unknown,
  expected?: string | RegExp | FunctionLike | Error,
): void {
  let didThrow = false;
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    didThrow = true;
    error = caught;
  }
  assert.ok(didThrow, 'Expected function to throw');
  assertErrorMatches(error, expected);
}

export async function assertRejectsLike(
  value: Promise<unknown> | (() => Promise<unknown>),
  expected?: string | RegExp | FunctionLike | Error,
): Promise<void> {
  let didReject = false;
  let error: unknown;
  try {
    await (typeof value === 'function' ? value() : value);
  } catch (caught) {
    didReject = true;
    error = caught;
  }
  assert.ok(didReject, 'Expected promise to reject');
  assertErrorMatches(error, expected);
}

export async function assertRejectsValue(
  value: Promise<unknown> | (() => Promise<unknown>),
  expected: unknown,
): Promise<void> {
  let didReject = false;
  let error: unknown;
  try {
    await (typeof value === 'function' ? value() : value);
  } catch (caught) {
    didReject = true;
    error = caught;
  }
  assert.ok(didReject, 'Expected promise to reject');
  assert.deepStrictEqual(error, expected);
}

function assertErrorMatches(
  error: unknown,
  expected?: string | RegExp | FunctionLike | Error,
): void {
  if (expected === undefined) {
    return;
  }
  if (typeof expected === 'string') {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(expected));
  } else if (expected instanceof RegExp) {
    assert.ok(error instanceof Error);
    assert.match(error.message, expected);
  } else if (typeof expected === 'function') {
    assert.ok(
      error instanceof
        (expected as unknown as new (
          ...args: never[]
        ) => object),
    );
  } else {
    assert.deepStrictEqual(error, expected);
  }
}

type MockCall = readonly unknown[] | { arguments: readonly unknown[] };
type MockLike = {
  mock?: { calls?: readonly MockCall[]; callCount?: () => number };
};

function callsOf(value: MockLike): readonly (readonly unknown[])[] {
  const calls = value.mock?.calls ?? [];
  return calls.map((call) =>
    'arguments' in call ? call.arguments : (call as readonly unknown[]),
  );
}

export function assertCalled(value: MockLike): void {
  assert.ok(callsOf(value).length > 0, 'Expected mock to have been called');
}

export function assertNotCalled(value: MockLike): void {
  assert.strictEqual(callsOf(value).length, 0);
}

export function assertCalledTimes(value: MockLike, expected: number): void {
  assert.strictEqual(
    value.mock?.callCount?.() ?? callsOf(value).length,
    expected,
  );
}

export function assertCalledWith(
  value: MockLike,
  ...expected: readonly unknown[]
): void {
  assert.ok(
    callsOf(value).some((call) => valueMatches(call, expected)),
    'Expected mock to have been called with the provided arguments',
  );
}

export function assertNotCalledWith(
  value: MockLike,
  ...expected: readonly unknown[]
): void {
  assert.ok(
    callsOf(value).every((call) => !valueMatches(call, expected)),
    'Expected mock not to have been called with the provided arguments',
  );
}

export function assertNthCalledWith(
  value: MockLike,
  nth: number,
  ...expected: readonly unknown[]
): void {
  const call = callsOf(value)[nth - 1];
  assert.ok(call, `Expected mock to have at least ${nth} calls`);
  assertMatches(call, expected);
}
