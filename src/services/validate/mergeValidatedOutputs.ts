/**
 * A validator output can be any JavaScript value. Only combining several
 * validator outputs requires an object shape: the framework's established
 * merge is a shallow, ordered merge of plain objects.
 */
export function isPlainObject(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Preserve a single validator output exactly. When several schemas contribute
 * to one request slot, merge their plain-object outputs in schema order so
 * later keys overwrite earlier keys. Other shapes are a configuration error;
 * spreading them would silently turn arrays and primitives into records.
 */
export function mergeValidatedOutputs(outputs: readonly unknown[]): unknown {
  if (outputs.length === 1) {
    return outputs[0];
  }

  const objects = outputs.map((output, index) => {
    if (!isPlainObject(output)) {
      throw new Error(
        `Cannot merge validated outputs: output ${index + 1} is not a plain object. ` +
          'Multiple validation schemas must return plain objects.',
      );
    }
    return output;
  });

  return Object.assign({}, ...objects);
}

/**
 * Add the framework-owned content-type discriminator without mutating a
 * validator's singleton output. Content-type maps are object contracts, so a
 * non-plain output is rejected explicitly rather than being spread.
 */
export function addContentTypeDiscriminator(
  output: unknown,
  contentType: string,
): Record<string, unknown> {
  if (!isPlainObject(output)) {
    throw new Error(
      'Cannot add a content-type discriminator: the matched validation output must be a plain object.',
    );
  }
  return { ...output, contentType };
}
