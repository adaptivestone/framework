import { PersistentFile } from "formidable";
import { Schema } from "yup";

/**
 * Validator for file
 * use as
 * @example
 * request: yup.object().shape({
 *          someFile: new YupFile().required(),
 * })
 */
class YupFile extends Schema {
  constructor() {
    super({
      type: "file",
      check: (value: unknown) =>
        Array.isArray(value) &&
        value.every((item) => item instanceof PersistentFile),
    });
  }
}

export { YupFile };
