import type { ValidationIssue } from '../services/validate/types.ts';
import { getAppInstance } from './appInstance.ts';

/** @internal English defaults of the password messages, shared with the `Auth` controller. */
export const PASSWORD_EN = {
  'auth.passwordProvided': 'Password must be provided',
  'auth.passwordTooShort': 'Password must be at least {{min}} characters',
  'auth.passwordTooLong': 'Password must be at most {{max}} characters',
} as const;

/** @internal {@link passwordPolicyIssues} against the given `auth` config. */
export const passwordPolicyIssuesFor = (
  authConfig: Record<string, unknown>,
  password: unknown,
  field = 'password',
): ValidationIssue[] => {
  if (typeof password !== 'string' || password === '') {
    return [
      {
        message: 'auth.passwordProvided',
        path: [field],
        params: { defaultValue: PASSWORD_EN['auth.passwordProvided'] },
      },
    ];
  }
  const policy = authConfig.passwordPolicy as
    | { minLength?: number; maxLength?: number }
    | undefined;
  const min = policy?.minLength ?? 15;
  const max = policy?.maxLength ?? 128;
  if (
    !Number.isInteger(min) ||
    min < 1 ||
    !Number.isInteger(max) ||
    max < min
  ) {
    throw new Error(
      'Invalid auth.passwordPolicy: require 1 <= minLength <= maxLength',
    );
  }
  // Count Unicode code points, without normalizing or truncating the secret.
  const length = Array.from(password).length;
  if (length >= min && length <= max) {
    return [];
  }
  const message =
    length < min ? 'auth.passwordTooShort' : 'auth.passwordTooLong';
  return [
    {
      message,
      path: [field],
      params: {
        min,
        max,
        defaultValue: PASSWORD_EN[message]
          .replace('{{min}}', String(min))
          .replace('{{max}}', String(max)),
      },
    },
  ];
};

/**
 * Check a new password against `auth.passwordPolicy` (`minLength`..`maxLength`
 * Unicode code points). Returns `[]` when it passes, otherwise one issue at
 * `field` whose message is an i18n key with an English default; a thrown
 * `HttpError` translates it. Throws when the policy config is invalid.
 *
 * ```ts
 * const issues = passwordPolicyIssues(req.appInfo.request.newPassword, 'newPassword');
 * if (issues.length) {
 *   throw new BadRequestError({ code: 'VALIDATION_FAILED', message: 'Validation failed', errors: issues });
 * }
 * ```
 */
export const passwordPolicyIssues = (
  password: unknown,
  field = 'password',
): ValidationIssue[] =>
  passwordPolicyIssuesFor(getAppInstance().getConfig('auth'), password, field);
