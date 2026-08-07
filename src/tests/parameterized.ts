import { it } from 'node:test';
import { format } from 'node:util';

type TestResult = void | Promise<void>;

export function testEach<T extends readonly unknown[]>(
  cases: readonly T[],
  name: string,
  fn: (...args: T) => TestResult,
): void;
export function testEach<T>(
  cases: readonly T[],
  name: string,
  fn: (value: T) => TestResult,
): void;
export function testEach(
  cases: readonly unknown[],
  name: string,
  fn: (...args: never[]) => TestResult,
): void {
  cases.forEach((row, index) => {
    const args = Array.isArray(row) ? row : [row];
    const testName = format(name.replaceAll('%#', String(index)), ...args);
    it(testName, () => fn(...(args as never[])));
  });
}
