import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { array, number, object, string } from 'yup';
import { appInstance } from '../../helpers/appInstance.ts';
import { assertRejectsLike, assertThrowsLike } from '../../tests/assertions.ts';
import { defineSchema } from './defineSchema.ts';
import { standardSchemaDriver } from './drivers/StandardSchemaDriver.ts';
import { yupDriver } from './drivers/YupDriver.ts';
import type {
  StandardSchemaV1,
  ValidationIssue,
  ValidatorDriver,
} from './types.ts';
import ValidateService from './ValidateService.ts';
import { ValidationError } from './ValidationError.ts';

describe('ValidateService', () => {
  describe('resolve', () => {
    it('returns null when schema is missing', () => {
      assert.strictEqual(ValidateService.resolve(null), null);
    });

    it('routes a yup schema to yupDriver', () => {
      const schema = object().shape({ name: string() });
      assert.strictEqual(ValidateService.resolve(schema), yupDriver);
    });

    it('returns null for legacy {validate, cast} plain objects (no driver matches)', () => {
      const schema = {
        validate: async () => {},
        cast: async (data: unknown) => data,
      };
      assert.strictEqual(ValidateService.resolve(schema), null);
    });

    it('routes a vendor-neutral Standard Schema to standardSchemaDriver', () => {
      const schema: StandardSchemaV1<unknown, { id: string }> = {
        '~standard': {
          version: 1,
          vendor: 'mycustom',
          validate(value) {
            return { value: value as { id: string } };
          },
        },
      };
      assert.strictEqual(ValidateService.resolve(schema), standardSchemaDriver);
    });
  });

  describe('validate', () => {
    it('passes data through when no schema is set', async () => {
      const svc = new ValidateService(appInstance, null);
      await assert.deepStrictEqual(await svc.validate({ a: 1 }), { a: 1 });
    });

    it('validates + casts + strips unknown for yup schemas', async () => {
      const schema = object().shape({ name: string() });
      const svc = new ValidateService(appInstance, schema);
      const result = await svc.validate({ name: 'alice', extra: 'leak' });
      assert.deepStrictEqual(result, { name: 'alice' });
    });

    it('throws ValidationError on yup failure', async () => {
      const schema = object().shape({
        email: string().email().required(),
      });
      const svc = new ValidateService(appInstance, schema);
      await assertRejectsLike(
        svc.validate({ email: 'not-email' }),
        ValidationError,
      );
    });

    it('returns cast value for Standard Schema validators', async () => {
      const schema: StandardSchemaV1<unknown, { ok: boolean }> = {
        '~standard': {
          version: 1,
          vendor: 'mycustom',
          validate(value) {
            const v = value as { ok?: unknown };
            if (typeof v?.ok !== 'boolean') {
              return { issues: [{ message: 'ok required', path: ['ok'] }] };
            }
            return { value: { ok: v.ok } };
          },
        },
      };
      const svc = new ValidateService(appInstance, schema);
      await assert.deepStrictEqual(
        await svc.validate({ ok: true, extra: 'x' }),
        {
          ok: true,
        },
      );
    });

    it('throws ValidationError on Standard Schema failure', async () => {
      const schema: StandardSchemaV1<unknown, { ok: boolean }> = {
        '~standard': {
          version: 1,
          vendor: 'mycustom',
          validate() {
            return { issues: [{ message: 'always-fail', path: ['root'] }] };
          },
        },
      };
      const svc = new ValidateService(appInstance, schema);
      await assertRejectsLike(svc.validate({}), ValidationError);
    });

    it('throws with migration message when given a legacy {validate, cast} schema', () => {
      const schema = {
        validate: async () => {},
        cast: async (data: unknown) => data,
      };
      assertThrowsLike(
        () => new ValidateService(appInstance, schema),
        /legacy `\{validate, cast\}` plain object/,
      );
    });

    it('throws with generic message when no driver matches', () => {
      const schema = { random: 'shape' };
      assertThrowsLike(
        () => new ValidateService(appInstance, schema),
        /must implement Standard Schema/,
      );
    });
  });

  describe('register', () => {
    it('prepends user drivers so they take priority', async () => {
      const calls: string[] = [];
      const customDriver: ValidatorDriver = {
        canHandle: (b: unknown) =>
          typeof b === 'object' && b !== null && '~standard' in b,
        async validate(_, data) {
          calls.push('custom');
          return data;
        },
        toJsonSchema: () => null,
      };

      ValidateService.register(customDriver);
      try {
        const schema = object().shape({ name: string() });
        const svc = new ValidateService(appInstance, schema);
        assert.strictEqual(svc.driver, customDriver);
        await svc.validate({ name: 'x' });
        assert.deepStrictEqual(calls, ['custom']);
      } finally {
        // Cleanup: remove the driver we just registered
        const idx = ValidateService.drivers.indexOf(customDriver);
        if (idx >= 0) {
          ValidateService.drivers.splice(idx, 1);
        }
      }
    });

    it('appends with position: "last"', () => {
      const lastDriver: ValidatorDriver = {
        canHandle: () => false,
        async validate(_, data) {
          return data;
        },
      };

      const before = ValidateService.drivers.length;
      ValidateService.register(lastDriver, 'last');
      try {
        assert.strictEqual(ValidateService.drivers.length, before + 1);
        assert.strictEqual(
          ValidateService.drivers[ValidateService.drivers.length - 1],
          lastDriver,
        );
      } finally {
        const idx = ValidateService.drivers.indexOf(lastDriver);
        if (idx >= 0) {
          ValidateService.drivers.splice(idx, 1);
        }
      }
    });
  });

  describe('i18n auto-translation', () => {
    it('translates raw i18n keys when i18n is passed', async () => {
      const schema = object().shape({
        email: string().email().required('auth.emailProvided'),
      });
      const svc = new ValidateService(appInstance, schema);
      const i18nService = await appInstance.getI18nService();
      // A key the app's locales DO ship still wins — asserted against `ru`,
      // which carries the full catalog (`en` now lives in code as defaults).
      const i18n = await i18nService.getI18nForLang('ru');

      let caught: ValidationError | null = null;
      try {
        await svc.validate({}, i18n);
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      assert.notStrictEqual(caught, null);
      assert.deepStrictEqual(caught?.message, {
        email: ['Нужно указать Email'],
      });
      assert.strictEqual(caught?.issues[0]?.message, 'Нужно указать Email');
    });

    it('falls back to the in-code defaultValue when the key is missing', async () => {
      // Framework messages ship their English text as `params.defaultValue`,
      // so a key absent from every catalog resolves to English instead of
      // leaking the raw key into the 400 body.
      const issues: ValidationIssue[] = [
        {
          message: 'auth.emailProvided',
          path: ['email'],
          params: { defaultValue: 'Email must be provided' },
        },
      ];
      const schema = defineSchema<{ email: string }>(() => ({ issues }));
      const svc = new ValidateService(appInstance, schema);
      const i18nService = await appInstance.getI18nService();
      const i18n = await i18nService.getI18nForLang('en');

      let caught: ValidationError | null = null;
      try {
        await svc.validate({}, i18n);
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      assert.deepStrictEqual(caught?.message, {
        email: ['Email must be provided'],
      });
    });

    it('interpolates params into an in-code defaultValue', async () => {
      const issues: ValidationIssue[] = [
        {
          message: 'framework.test.missingKey',
          path: ['password'],
          params: {
            min: 8,
            defaultValue: 'Password must be at least {{min}} characters',
          },
        },
      ];
      const schema = defineSchema<{ password: string }>(() => ({ issues }));
      const svc = new ValidateService(appInstance, schema);
      const i18nService = await appInstance.getI18nService();
      const i18n = await i18nService.getI18nForLang('en');

      let caught: ValidationError | null = null;
      try {
        await svc.validate({}, i18n);
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      assert.deepStrictEqual(caught?.message, {
        password: ['Password must be at least 8 characters'],
      });
    });

    it('leaves raw keys when no i18n is passed', async () => {
      const schema = object().shape({
        email: string().email().required('auth.emailProvided'),
      });
      const svc = new ValidateService(appInstance, schema);

      let caught: ValidationError | null = null;
      try {
        await svc.validate({});
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      assert.deepStrictEqual(caught?.message, {
        email: ['auth.emailProvided'],
      });
    });

    it('interpolates yup params into i18n placeholders', async () => {
      // yup's `min` validator populates `params: { min }`; the framework
      // forwards this to `t(message, fallback, params)` so the locale's
      // `{{min}}` placeholder resolves to the actual value.
      const schema = object().shape({
        password: string().min(8, 'auth.passwordTooShort').required(),
      });
      const svc = new ValidateService(appInstance, schema);
      const i18nService = await appInstance.getI18nService();
      const i18n = await i18nService.getI18nForLang('en');

      let caught: ValidationError | null = null;
      try {
        await svc.validate({ password: 'short' }, i18n);
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      assert.deepStrictEqual(caught?.message, {
        password: ['Password must be at least 8 characters'],
      });
    });

    it('does NOT resolve i18next nesting from a user-tainted message (injection guard)', async () => {
      // yup bakes the raw submitted value into its typeError message. If that
      // message were fed to i18next as a key/defaultValue, an attacker-supplied
      // `$t(<key>)` would resolve against the loaded bundle and leak it into the
      // 400 response. Free-form messages must pass through verbatim instead.
      const schema = object().shape({ age: number() });
      const svc = new ValidateService(appInstance, schema);
      const i18nService = await appInstance.getI18nService();
      const i18n = await i18nService.getI18nForLang('en');

      let caught: ValidationError | null = null;
      try {
        await svc.validate({ age: 'x-$t(auth.messageSome)-y' }, i18n);
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      const message = caught?.issues[0]?.message ?? '';
      // The nesting token survives unresolved …
      assert.ok(message.includes('$t(auth.messageSome)'));
      // … and the key it points at was NOT substituted in.
      assert.ok(!message.includes('Some server problem'));
    });
  });

  describe('shape — arrays + multi-error', () => {
    it('returns indexed paths for array element failures', async () => {
      const schema = object().shape({
        tags: array()
          .of(string().min(2, 'tag too short').required())
          .required(),
      });
      const svc = new ValidateService(appInstance, schema);

      let caught: ValidationError | null = null;
      try {
        await svc.validate({ tags: ['ok', 'a', 'longer'] });
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      // yup serializes the offending element as `tags[1]` in path
      assert.deepStrictEqual(caught?.message, {
        'tags[1]': ['tag too short'],
      });
      assert.strictEqual(caught?.issues.length, 1);
      assert.deepStrictEqual(caught?.issues[0]?.path, ['tags[1]']);
    });

    it('aggregates multiple errors per field', async () => {
      // `email` fails BOTH the format and the required test? required passes
      // because the value is provided; instead use min+matches to provoke
      // two errors on a single field.
      const schema = object().shape({
        password: string()
          .min(8, 'min8')
          .matches(/^[A-Z]/, 'startUpper')
          .required(),
      });
      const svc = new ValidateService(appInstance, schema);

      let caught: ValidationError | null = null;
      try {
        await svc.validate({ password: 'a' });
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      // YupDriver runs with abortEarly:false → both errors land on `password`
      assert.deepStrictEqual(caught?.message, {
        password: ['min8', 'startUpper'],
      });
      assert.strictEqual(caught?.issues.length, 2);
    });

    it('aggregates errors from multiple fields', async () => {
      const schema = object().shape({
        email: string().email().required('emailReq'),
        age: number().min(18, 'tooYoung').required(),
      });
      const svc = new ValidateService(appInstance, schema);

      let caught: ValidationError | null = null;
      try {
        await svc.validate({ age: 12 });
      } catch (err) {
        if (err instanceof ValidationError) {
          caught = err;
        }
      }
      assert.deepStrictEqual(caught?.message, {
        email: ['emailReq'],
        age: ['tooYoung'],
      });
    });
  });
});
