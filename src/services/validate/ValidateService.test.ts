import { describe, expect, it } from 'vitest';
import { array, number, object, string } from 'yup';
import { appInstance } from '../../helpers/appInstance.ts';
import { standardSchemaDriver } from './drivers/StandardSchemaDriver.ts';
import { yupDriver } from './drivers/YupDriver.ts';
import type { StandardSchemaV1, ValidatorDriver } from './types.ts';
import ValidateService from './ValidateService.ts';
import { ValidationError } from './ValidationError.ts';

describe('ValidateService', () => {
  describe('resolve', () => {
    it('returns null when schema is missing', () => {
      expect(ValidateService.resolve(null)).toBeNull();
    });

    it('routes a yup schema to yupDriver', () => {
      const schema = object().shape({ name: string() });
      expect(ValidateService.resolve(schema)).toBe(yupDriver);
    });

    it('returns null for legacy {validate, cast} plain objects (no driver matches)', () => {
      const schema = {
        validate: async () => {},
        cast: async (data: unknown) => data,
      };
      expect(ValidateService.resolve(schema)).toBeNull();
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
      expect(ValidateService.resolve(schema)).toBe(standardSchemaDriver);
    });
  });

  describe('validate', () => {
    it('passes data through when no schema is set', async () => {
      const svc = new ValidateService(appInstance, null);
      await expect(svc.validate({ a: 1 })).resolves.toEqual({ a: 1 });
    });

    it('validates + casts + strips unknown for yup schemas', async () => {
      const schema = object().shape({ name: string() });
      const svc = new ValidateService(appInstance, schema);
      const result = await svc.validate({ name: 'alice', extra: 'leak' });
      expect(result).toEqual({ name: 'alice' });
    });

    it('throws ValidationError on yup failure', async () => {
      const schema = object().shape({
        email: string().email().required(),
      });
      const svc = new ValidateService(appInstance, schema);
      await expect(svc.validate({ email: 'not-email' })).rejects.toBeInstanceOf(
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
      await expect(svc.validate({ ok: true, extra: 'x' })).resolves.toEqual({
        ok: true,
      });
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
      await expect(svc.validate({})).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws with migration message when given a legacy {validate, cast} schema', () => {
      const schema = {
        validate: async () => {},
        cast: async (data: unknown) => data,
      };
      expect(() => new ValidateService(appInstance, schema)).toThrow(
        /legacy `\{validate, cast\}` plain object/,
      );
    });

    it('throws with generic message when no driver matches', () => {
      const schema = { random: 'shape' };
      expect(() => new ValidateService(appInstance, schema)).toThrow(
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
        expect(svc.driver).toBe(customDriver);
        await svc.validate({ name: 'x' });
        expect(calls).toEqual(['custom']);
      } finally {
        // Cleanup: remove the driver we just registered
        const idx = ValidateService.drivers.indexOf(customDriver);
        if (idx >= 0) ValidateService.drivers.splice(idx, 1);
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
        expect(ValidateService.drivers).toHaveLength(before + 1);
        expect(
          ValidateService.drivers[ValidateService.drivers.length - 1],
        ).toBe(lastDriver);
      } finally {
        const idx = ValidateService.drivers.indexOf(lastDriver);
        if (idx >= 0) ValidateService.drivers.splice(idx, 1);
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
      const i18n = await i18nService.getI18nForLang('en');

      let caught: ValidationError | null = null;
      try {
        await svc.validate({}, i18n);
      } catch (err) {
        if (err instanceof ValidationError) caught = err;
      }
      expect(caught).not.toBeNull();
      expect(caught?.message).toEqual({
        email: ['Email must be provided'],
      });
      expect(caught?.issues[0]?.message).toBe('Email must be provided');
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
        if (err instanceof ValidationError) caught = err;
      }
      expect(caught?.message).toEqual({
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
        if (err instanceof ValidationError) caught = err;
      }
      expect(caught?.message).toEqual({
        password: ['Password must be at least 8 characters'],
      });
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
        if (err instanceof ValidationError) caught = err;
      }
      // yup serializes the offending element as `tags[1]` in path
      expect(caught?.message).toEqual({
        'tags[1]': ['tag too short'],
      });
      expect(caught?.issues).toHaveLength(1);
      expect(caught?.issues[0]?.path).toEqual(['tags[1]']);
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
        if (err instanceof ValidationError) caught = err;
      }
      // YupDriver runs with abortEarly:false → both errors land on `password`
      expect(caught?.message).toEqual({
        password: ['min8', 'startUpper'],
      });
      expect(caught?.issues).toHaveLength(2);
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
        if (err instanceof ValidationError) caught = err;
      }
      expect(caught?.message).toEqual({
        email: ['emailReq'],
        age: ['tooYoung'],
      });
    });
  });
});
