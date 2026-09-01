/**
 * Type-level fixture (compiled by the `ModelTyping.typecheck.test.ts` tsc-gate,
 * excluded from the build). Pins every virtual shape a model can declare to a
 * usable type on the hydrated document.
 *
 * Only a zero-argument getter used to be understood. A getter that takes
 * Mongoose's `(value, virtual, doc)` arguments, a set-only virtual, and a
 * populate virtual (`ref`/`localField`/`foreignField`, no getter at all) all
 * collapsed to `never` — which is assignable to everything, so any misuse of
 * them compiled silently.
 *
 * A getter's return type now wins whatever its parameters; a set-only virtual
 * is typed by the value its setter takes; a virtual with neither is `unknown`,
 * which is honest — the populated shape is not knowable from the schema — and
 * makes reading it a narrowing instead of a free pass.
 *
 * The projection also decides whether the document keeps Mongoose's `id`
 * virtual at all, so that is pinned here too — see `virtualsModelKeepsId`.
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

class Post extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String, required: true },
      body: { type: String, required: true },
    } as const;
  }

  static get modelVirtuals() {
    return {
      // A plain getter.
      wordCount: {
        get(this: PostAuthoringDocument): number {
          return this.body.split(' ').length;
        },
      },
      // An async getter — the document sees the promise the getter returns.
      readingTime: {
        async get(this: PostAuthoringDocument): Promise<number> {
          return this.body.length / 200;
        },
      },
      // A get/set pair — the getter decides the type.
      slug: {
        get(this: PostAuthoringDocument): string {
          return this.title.toLowerCase().replaceAll(' ', '-');
        },
        set(this: PostAuthoringDocument, value: string) {
          this.title = value;
        },
      },
      // Set-only — a write surface, typed by the value the setter takes.
      titleFromInput: {
        set(this: PostAuthoringDocument, value: string) {
          this.title = value;
        },
      },
      // A getter declared with the arguments Mongoose passes it.
      excerpt: {
        get(this: PostAuthoringDocument, value: unknown): string {
          void value;
          return this.body.slice(0, 40);
        },
      },
      // A populate virtual — no getter, so no knowable shape.
      related: {
        options: {
          ref: 'Post',
          localField: '_id',
          foreignField: 'parentId',
        },
      },
    } as const;
  }
}

type PostAuthoringModel = GetModelTypeLiteFromSchema<typeof Post.modelSchema>;
type PostAuthoringDocument = InstanceType<PostAuthoringModel>;
type PostDocument = InstanceType<GetModelTypeFromClass<typeof Post>>;

const plainGetter: Exact<PostDocument['wordCount'], number> = true;
const asyncGetter: Exact<PostDocument['readingTime'], Promise<number>> = true;
const getterWithSetter: Exact<PostDocument['slug'], string> = true;
const setOnlyVirtual: Exact<PostDocument['titleFromInput'], string> = true;
const getterWithArguments: Exact<PostDocument['excerpt'], string> = true;
const populateVirtual: Exact<PostDocument['related'], unknown> = true;

// Virtual shapes decide whether the document keeps Mongoose's `id` virtual: a
// projection where every virtual is `never` satisfies `Record<string, never>`,
// which sends `HydratedDocument` down its empty-overrides branch — and that
// branch adds no `id`. Typed virtual values keep it.
const virtualsModelKeepsId: Exact<PostDocument['id'], string> = true;

// `unknown` narrows without a cast — the shape a populate produces is the
// consumer's to declare, not the schema's to guess.
function readPopulateVirtual(doc: PostDocument) {
  if (Array.isArray(doc.related)) {
    const first: unknown = doc.related[0];
    return first;
  }
  return undefined;
}

/**
 * The same set-only virtual on a model that does not freeze its virtuals with
 * `as const`: the projection preserves the modifiers of the definition it maps,
 * so only this spelling leaves the virtual writable — which is the whole point
 * of a setter.
 */
class Draft extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String, required: true },
    } as const;
  }

  static get modelVirtuals() {
    return {
      titleFromInput: {
        set(this: DraftAuthoringDocument, value: string) {
          this.title = value;
        },
      },
    };
  }
}

type DraftAuthoringDocument = InstanceType<
  GetModelTypeLiteFromSchema<typeof Draft.modelSchema>
>;
type DraftDocument = InstanceType<GetModelTypeFromClass<typeof Draft>>;

const writableSetOnlyVirtual: Exact<DraftDocument['titleFromInput'], string> =
  true;

// The pointed case for the coupling above: this model's only virtual is
// set-only, so under the old mapping the whole projection was `never`-valued
// and only the (since removed) forced `{ id: string }` intersection kept `id`
// on its documents — a mapping that reintroduces `never` would lose `id`.
const setOnlyVirtualsModelKeepsId: Exact<DraftDocument['id'], string> = true;

function writeSetOnlyVirtual(doc: DraftDocument) {
  doc.titleFromInput = 'A fresh title';
}

export {
  asyncGetter,
  getterWithArguments,
  getterWithSetter,
  plainGetter,
  populateVirtual,
  readPopulateVirtual,
  setOnlyVirtual,
  setOnlyVirtualsModelKeepsId,
  virtualsModelKeepsId,
  writableSetOnlyVirtual,
  writeSetOnlyVirtual,
};
