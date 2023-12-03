import yup from 'yup';
import YupValidator from './drivers/YupValidator.js';
import CustomValidator from './drivers/CustomValidator.js';
import Base from '../../modules/Base.js';

class ValidateService extends Base {
  constructor(app, validator) {
    super(app);
    this.validator = validator
      ? this.constructor.getDriverByValidatorBody(app, validator)
      : null;
  }

  static drivers = {
    YupValidator,
    CustomValidator,
  };

  static isValidatorExists(validator) {
    if (!(validator instanceof Object)) {
      return false;
    }

    return Object.values(this.drivers).some(
      (driver) => validator instanceof driver,
    );
  }

  static getDriverByValidatorBody(app, body) {
    if (this.isValidatorExists(body)) {
      return body;
    }
    if (yup.isSchema(body)) {
      const yupValidator = new YupValidator(app, body);
      return yupValidator;
    }
    const customValidator = new CustomValidator(app, body);
    return customValidator;
  }

  /**
   * Filter middlewares by route path and select all parameters
   */
  filterRelatedParametersByRoute(middlewares, method, path) {
    const middlewaresParams = middlewares
      .filter(
        (middleware) =>
          middleware.method.toLowerCase() === method.toLowerCase() &&
          middleware.fullPath.toLowerCase() === path.toLowerCase(),
      )
      ?.map((middleware) => {
        const instance = new middleware.MiddlewareFunction(
          this.app,
          middleware.params,
        );

        return instance.relatedReqParameters;
      });

    return middlewaresParams;
  }

  /**
   * Group all middleware(routes + controller) parameters
   */
  getMiddlewareParams(controllerMiddlewares, AllrouteMiddlewares, options) {
    const { method, path } = options;
    const routeMiddlewaresParams = this.filterRelatedParametersByRoute(
      AllrouteMiddlewares,
      method,
      path,
    );

    const controllerMiddlewaresParams = this.filterRelatedParametersByRoute(
      controllerMiddlewares,
      method,
      path,
    );

    return {
      request: [
        ...controllerMiddlewaresParams.map((x) => x.request),
        ...routeMiddlewaresParams.map((x) => x.request),
      ],
      query: [
        ...controllerMiddlewaresParams.map((x) => x.query),
        ...routeMiddlewaresParams.map((x) => x.query),
      ],
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async validateSchema(req, validator, data) {
    if (!validator) {
      return {};
    }

    await validator.validateFields(data, req);

    return validator.castFields(data, req);
  }

  async validateArrayOfSchemas(req, validators, data) {
    const result = [];

    for (const validator of validators) {
      const formatedValidator = this.constructor.getDriverByValidatorBody(
        this.app,
        validator,
      );
      result.push(this.validateSchema(req, formatedValidator, data));
    }

    return Promise.all(result);
  }

  /**
   * Validate req data. For example req.body, req.query
   */
  async validateReqData(req, options) {
    const { selectedReqData, additionalMiddlewareFieldsData } = options;
    const {
      middlewaresInfo,
      routeMiddlewaresReg,
      options: routeOptions,
    } = additionalMiddlewareFieldsData;

    let validatedFields = await this.validateSchema(
      req,
      this.validator,
      selectedReqData,
    );
    const additionalMiddlewareSchemas = this.getMiddlewareParams(
      middlewaresInfo,
      routeMiddlewaresReg,
      routeOptions,
    )[routeOptions.prefix];

    if (additionalMiddlewareSchemas.length) {
      const middlewareValidatedFields = await this.validateArrayOfSchemas(
        req,
        additionalMiddlewareSchemas,
        selectedReqData,
      );

      validatedFields = Object.assign(
        {},
        validatedFields,
        ...middlewareValidatedFields,
      );
    }

    return validatedFields;
  }
}

export default ValidateService;
