const yup = require('yup');

function jsonToYup(json) {
  const ret = {};
  for (const key of Object.keys(json)) {
    const { type, required } = json[key];
    if (!yup[type]) {
      throw new Error(`Invalid field type: ${key} ${type}`);
    }
    let filedValidate = yup[type]();
    if (required) {
      filedValidate = filedValidate.required();
    }
    if (json[key].default) {
      filedValidate = filedValidate.default(json[key].default);
    }
    if (json[key].test) {
      filedValidate = filedValidate.test(json[key].test);
    }

    ret[key] = filedValidate
      .transform((currentValue, originalValue) =>
        originalValue === '' ? null : currentValue,
      )
      .nullable();
  }

  return yup.object().shape(ret);
}

module.exports = jsonToYup;
