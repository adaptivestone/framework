import AbstractMiddleware from '../../../services/http/middleware/AbstractMiddleware.ts';
import { defineSchema } from '../../../services/validate/defineSchema.ts';

export class RequiredOutput extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return defineSchema<{ value: number }>(() => ({ value: { value: 42 } }));
  }

  static get provides() {
    return {} as { audit: string };
  }
}

export class OptionalOutput extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return defineSchema<{ value?: number }>(() => ({ value: {} }));
  }
}

export class FinalOutput extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return defineSchema<{ value: boolean }>(() => ({ value: { value: true } }));
  }
}

export class LegacyOutput extends AbstractMiddleware {
  get relatedQueryParameters() {
    return defineSchema<{ legacy: number }>(() => ({ value: { legacy: 1 } }));
  }
}

export class NullableOutput extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return process.env.TYPE_FIXTURE_OPTIONAL
      ? defineSchema<{ value: number; nullableOnly: true }>(() => ({
          value: { value: 42, nullableOnly: true },
        }))
      : null;
  }
}

export class StaticRequestInstanceQuery extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return defineSchema<{ staticValue: number }>(() => ({
      value: { staticValue: 42 },
    }));
  }

  get relatedQueryParameters() {
    return defineSchema<{ legacyOnly: number }>(() => ({
      value: { legacyOnly: 1 },
    }));
  }
}

export class UnknownOutput extends AbstractMiddleware {
  static get relatedRequestParameters() {
    return defineSchema<unknown>(() => ({ value: 42 }));
  }
}
