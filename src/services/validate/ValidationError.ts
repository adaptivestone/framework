import type { ValidationIssue } from './types.ts';

/**
 * The wire shape that goes out via `res.json({ errors: err.message })`.
 *
 * Each key is a field path. Each value is either a single message string
 * or an array of messages. Both forms are preserved as-given — no
 * normalization — so consumers see the same response bytes regardless
 * of which validator produced the error.
 */
export type ValidationErrorPayload = Record<string, string | string[]>;

/**
 * Framework-owned validation error. Replaces yup's `ValidationError` at the
 * framework layer.
 *
 * Wire compatibility note — `.message` is the path-keyed payload object,
 * NOT a string. This mirrors yup's hack: `res.json({ errors: err.message })`
 * in `controllers/index.ts` (the validation wrapper) serializes the object directly to produce
 * `{ "errors": { "fieldName": [...] | "...", ... } }`. Existing user
 * catch-blocks that read `err.message` keep working unchanged.
 *
 * `.issues` is the canonical list (one entry per field/message pair) that
 * non-wire consumers (logging, observability) should iterate.
 */
export class ValidationError extends Error {
  issues: ValidationIssue[];

  // @ts-expect-error — Error.message is typed `string`, but we widen it to
  // the path-keyed payload object so `res.json({ errors: err.message })`
  // in AbstractController serializes the object directly. Mirrors yup's
  // wire-format hack.
  declare message: ValidationErrorPayload;

  constructor(
    payload: ValidationErrorPayload | ReadonlyArray<ValidationIssue>,
  ) {
    super();
    this.name = 'ValidationError';

    if (Array.isArray(payload)) {
      const issues = [...(payload as ReadonlyArray<ValidationIssue>)];
      this.issues = issues;
      this.message = issuesToPayload(issues);
    } else {
      const obj = { ...(payload as ValidationErrorPayload) };
      this.issues = payloadToIssues(obj);
      // Normalize: even when constructed from a string-valued payload,
      // canonical .message is always-array.
      this.message = issuesToPayload(this.issues);
    }
  }

  /**
   * Cross-realm-safe duck check. Mirrors `yup.ValidationError.isError`.
   * Use this in framework code instead of `instanceof` when the error
   * may have crossed a module-graph boundary.
   */
  static isValidationError(err: unknown): err is ValidationError {
    return (
      err instanceof Error &&
      (err as { name?: unknown }).name === 'ValidationError'
    );
  }
}

function payloadToIssues(payload: ValidationErrorPayload): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [path, value] of Object.entries(payload)) {
    const messages = Array.isArray(value) ? value : [value];
    for (const message of messages) {
      issues.push({ message, path: path === '' ? undefined : [path] });
    }
  }
  return issues;
}

export function issuesToPayload(
  issues: ReadonlyArray<ValidationIssue>,
): ValidationErrorPayload {
  // Always emit arrays per path, matching the existing yup-pipeline wire
  // shape: `{path: ["msg"]}` even for a single error. Single-string form
  // is still accepted as constructor input, but the canonical output is
  // always an array.
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const path = pathToString(issue.path);
    if (!out[path]) {
      out[path] = [];
    }
    out[path].push(issue.message);
  }
  return out;
}

function pathToString(path: ValidationIssue['path'] | undefined): string {
  if (!path || path.length === 0) {
    return '';
  }
  return path
    .map((segment) =>
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? String(segment.key)
        : String(segment),
    )
    .join('.');
}
