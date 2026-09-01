/**
 * Type-level fixture (compiled by the `ModelTyping.typecheck.test.ts` tsc-gate,
 * excluded from the build). Pins the `id` virtual to the value a model actually
 * has at runtime.
 *
 * Mongoose adds the `id` virtual itself and skips it when the schema options
 * carry `id: false` or the schema declares an `id` path of its own. Forcing an
 * extra `id: string` onto every hydrated document typed a value that is
 * `undefined` at runtime (`id: false`) and re-typed a numeric `id` path as a
 * string, so both mistakes compiled silently.
 */

import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

/** Invariant type identity: unlike assignability, `never` and `any` fail it. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type HasKey<T, K extends string> = K extends keyof T ? true : false;

class Article extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String, required: true },
    } as const;
  }
}

type ArticleDocument = InstanceType<GetModelTypeFromClass<typeof Article>>;

// The default: Mongoose's own `id` virtual, the hex string of `_id`.
const defaultIdIsString: Exact<ArticleDocument['id'], string> = true;

class Ticket extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String, required: true },
    } as const;
  }

  static get schemaOptions() {
    return { id: false } as const;
  }
}

type TicketDocument = InstanceType<GetModelTypeFromClass<typeof Ticket>>;
type TicketLiteDocument = InstanceType<
  GetModelTypeLiteFromSchema<
    typeof Ticket.modelSchema,
    typeof Ticket.schemaOptions
  >
>;

// `id: false` removes the virtual at runtime — reading `doc.id` must not compile.
const disabledIdIsAbsent: HasKey<TicketDocument, 'id'> = false;
const disabledIdIsAbsentOnLiteModel: HasKey<TicketLiteDocument, 'id'> = false;

class Legacy extends BaseModel {
  static get modelSchema() {
    return {
      // A schema-declared `id` path wins over the generated virtual.
      id: { type: Number, required: true },
      title: { type: String },
    } as const;
  }
}

type LegacyDocument = InstanceType<GetModelTypeFromClass<typeof Legacy>>;

const schemaIdKeepsItsOwnType: Exact<LegacyDocument['id'], number> = true;

export {
  defaultIdIsString,
  disabledIdIsAbsent,
  disabledIdIsAbsentOnLiteModel,
  schemaIdKeepsItsOwnType,
};
