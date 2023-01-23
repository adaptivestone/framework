const yup = require('yup');
const Base = require('../../modules/Base');

class ReqValidator extends Base {
  constructor(app, schema) {
    super(app);
    this.schema = schema;
  }

  /**
   * Filter middlewares by route path and select all parameters
   */
  static filterRelatedParametersByRoute(middlewares, method, path) {
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
  static getMiddlewareParams(
    controllerMiddlewares,
    AllrouteMiddlewares,
    options,
  ) {
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

    return yup.object().shape({
      request: yup
        .object()
        .concat(
          ...controllerMiddlewaresParams?.map((x) => x.request),
          ...routeMiddlewaresParams?.map((x) => x.request),
        ),
      query: yup
        .object()
        .concat(
          ...controllerMiddlewaresParams?.map((x) => x.query),
          ...routeMiddlewaresParams?.map((x) => x.query),
        ),
    });
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
    const { controllerValidationAbortEarly } = this.app.getConfig('validate');
    const additionalMiddlewareFields = this.constructor.getMiddlewareParams(
      middlewaresInfo,
      routeMiddlewaresReg,
      routeOptions,
    ).fields[routeOptions.prefix];

    let yupSchema = this.schema;
    if (!this.schema && additionalMiddlewareFields) {
      yupSchema = additionalMiddlewareFields;
    } else if (this.schema && additionalMiddlewareFields) {
      yupSchema = this.schema.concat(additionalMiddlewareFields);
    } else {
      return {};
    }

    if (yupSchema) {
      if (typeof yupSchema.validate !== 'function') {
        this.logger.error('request.validate should be a function');
      }
      if (typeof yupSchema.cast !== 'function') {
        this.logger.error('request.cast should be a function');
      }

      try {
        await yupSchema.validate(selectedReqData, {
          abortEarly: controllerValidationAbortEarly,
          req,
        });
      } catch (e) {
        console.log(e);
        let { errors } = e;
        // translate it
        if (req.i18n && errors) {
          errors = errors.map((err) => req.i18n.t(err));
        }
        this.logger.error(
          `Request validation failed with message: ${e.message}. errors: ${errors}`,
        );

        const errorAnswer = {};
        if (!e.inner || !e.inner.length) {
          errorAnswer[e.path] = errors;
        } else {
          e.inner.forEach((err) => {
            errorAnswer[err.path] = err.errors;
            if (req.i18n && err.errors) {
              errorAnswer[err.path] = err.errors.map((err1) =>
                req.i18n.t(err1),
              );
            }
          });
        }

        throw {
          message: errorAnswer,
        };
      }

      return yupSchema.cast(selectedReqData, {
        stripUnknown: true,
        req,
      });
    }

    return {};
  }
}

module.exports = ReqValidator;
