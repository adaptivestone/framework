// Simulates a model extending BaseModel from a DIFFERENT installed copy of the
// framework (BaseModel's static surface, but not `instanceof` this copy's
// BaseModel). Boot must reject it with the dedupe diagnostic, not treat it as legacy.
// biome-ignore lint/complexity/noStaticOnlyClass: mirrors BaseModel's static surface without extending it
export default class DuplicateCopyModel {
  static get modelSchema() {
    return { name: { type: String } } as const;
  }

  static initialize(): never {
    throw new Error('must be rejected by the loader before initialize() runs');
  }
}
