import type { TFunction } from 'i18next';
import Base from '../../modules/Base.ts';
import type { IApp } from '../../server.ts';
import { standardSchemaDriver } from './drivers/StandardSchemaDriver.ts';
import { yupDriver } from './drivers/YupDriver.ts';
import type { ValidatorDriver } from './types.ts';
import { issuesToPayload, ValidationError } from './ValidationError.ts';

/**
 * Per-route validator dispatcher. Resolves a `ValidatorDriver` once at
 * construction (cheap sync property check) and delegates per-request
 * validation to it. Drivers are vendor-aware — see `./drivers/`.
 *
 * User-extension API: `ValidateService.register(myDriver)` prepends
 * a custom driver, giving it priority over the built-ins. Drivers
 * are matched in order via `canHandle(body)`; first match wins.
 *
 * Built-in resolution order (most specific first):
 *   1. yupDriver            — Standard Schema with `vendor: 'yup'` (strip-unknown)
 *   2. standardSchemaDriver — any other `~standard`-conformant lib
 *
 * Schemas that match no driver throw at construction with a migration
 * message — including legacy `{validate, cast}` plain objects (removed
 * in 5.0; wrap as Standard Schema, ~10 lines).
 */
class ValidateService extends Base {
  schema: unknown;
  driver: ValidatorDriver | null;

  static drivers: ValidatorDriver[] = [yupDriver, standardSchemaDriver];

  constructor(app: IApp, schema: unknown | null) {
    super(app);
    this.schema = schema;
    if (schema) {
      const driver = ValidateService.resolve(schema);
      if (!driver) {
        throw new Error(buildNoDriverMessage(schema));
      }
      this.driver = driver;
    } else {
      this.driver = null;
    }
  }

  /**
   * Find the first registered driver whose `canHandle(schema)` returns true.
   */
  static resolve(schema: unknown): ValidatorDriver | null {
    return (
      ValidateService.drivers.find((driver) => driver.canHandle(schema)) ?? null
    );
  }

  /**
   * Register a custom driver. By default prepends so user drivers take
   * priority over the built-ins (e.g., to override yup-strip behavior
   * or to add a non-Standard-Schema lib like raw Joi).
   */
  static register(
    driver: ValidatorDriver,
    position: 'first' | 'last' = 'first',
  ): void {
    if (position === 'first') {
      ValidateService.drivers.unshift(driver);
    } else {
      ValidateService.drivers.push(driver);
    }
  }

  /**
   * Validate `data` against the route's schema. Returns the cast value
   * on success; throws `ValidationError` on failure. If no schema was
   * provided, returns `data` unchanged.
   *
   * If `i18n` is supplied, error messages are translated through `i18n.t`
   * before the error is re-thrown — both `.message` (wire-shape) and
   * `.issues` (structured). Skip the argument and consumers that don't
   * need translation (workers, RPC, tests) get raw keys back. The HTTP
   * controller path passes `req.appInfo.i18n` so users never have to
   * remember a translation step.
   */
  async validate(
    data: unknown,
    i18n?: { t: TFunction } | null,
  ): Promise<unknown> {
    if (!this.driver) {
      return data;
    }
    try {
      return await this.driver.validate(this.schema, data);
    } catch (err) {
      if (i18n?.t && err instanceof ValidationError) {
        translateInPlace(err, i18n.t);
      }
      throw err;
    }
  }

  static get loggerGroup() {
    return 'service';
  }
}

function translateInPlace(err: ValidationError, t: TFunction): void {
  err.issues = err.issues.map((issue) => ({
    ...issue,
    message: t(issue.message, issue.message, issue.params) as unknown as string,
  }));
  err.message = issuesToPayload(err.issues);
}

function buildNoDriverMessage(schema: unknown): string {
  const looksLegacy =
    typeof schema === 'object' &&
    schema !== null &&
    typeof (schema as { validate?: unknown }).validate === 'function' &&
    typeof (schema as { cast?: unknown }).cast === 'function';

  if (looksLegacy) {
    return (
      'Schema appears to be a legacy `{validate, cast}` plain object. ' +
      'This pattern was removed in @adaptivestone/framework@5.0. Wrap as ' +
      'Standard Schema (https://standardschema.dev/) — ~10 lines:\n\n' +
      '  const schema: StandardSchemaV1<Input, Output> = {\n' +
      "    '~standard': {\n" +
      '      version: 1,\n' +
      "      vendor: 'mycustom',\n" +
      '      validate(value) {\n' +
      '        // your validation logic; return {value} on success or {issues} on failure\n' +
      '      },\n' +
      '    },\n' +
      '  };'
    );
  }

  return (
    'No ValidatorDriver matches this schema. Schemas must implement ' +
    'Standard Schema (`~standard`). Yup ≥1.7, Zod ≥3.24, Valibot, and ArkType ' +
    'all conform — see https://standardschema.dev/. ' +
    'Custom validators: implement the `~standard` interface, or register ' +
    'a custom driver via `ValidateService.register(driver)`.'
  );
}

export default ValidateService;
