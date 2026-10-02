/**
 * Build a warner that fires once per class. Dedups on the class via a private
 * `WeakSet`, then emits a warning (`DeprecationWarning` by default) with the
 * given code.
 * Reused by the framework's "we had to fall back to instantiation" warnings.
 */
export function makeOncePerClassWarner(
  code: string,
  message: (className: string, err?: unknown) => string,
  type = 'DeprecationWarning',
) {
  const warned = new WeakSet<object>();
  return (Class: { name: string }, err?: unknown): void => {
    if (warned.has(Class)) {
      return;
    }
    warned.add(Class);
    process.emitWarning(message(Class.name, err), {
      type,
      code,
    });
  };
}
