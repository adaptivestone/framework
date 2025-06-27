import Base from '../../../modules/Base.ts';

class AbstractValidator extends Base {
  constructor(app, body) {
    super(app);
    this.body = body;
  }

  static convertFieldsToJson(_fields) {
    // IMPLENT;
    return {};
  }

  get fieldsInJsonFormat() {
    // IMPLENT;
    return {};
  }

  // biome-ignore lint/correctness/noUnusedFunctionParameters: child will use them
  async validateFields(_data, { query, body, appInfo }) {
    // IMPLENT;
    return true;
  }

  async castFields() {
    // IMPLENT;
    return true;
  }

  static get loggerGroup() {
    return 'AbstractValidator_';
  }
}
export default AbstractValidator;
