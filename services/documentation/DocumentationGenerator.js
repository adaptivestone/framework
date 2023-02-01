const Base = require('../../modules/Base');
const ReqValidator = require('../validate/ValidateService');

class DocumentationGenerator extends Base {
  static convertYupFieldsToSwaggerFormat(fields) {
    const convertedFields = [];
    const entries = Object.entries(fields.describe().fields);

    if (!entries?.length) {
      return convertedFields;
    }
    const requiredFields = [];

    for (const [field, fieldProp] of entries) {
      const isRequired = fieldProp?.tests?.find(
        (prop) => prop.name === 'required',
      );
      if (isRequired) {
        requiredFields.push(field);
      }
    }

    entries.forEach(([key, value]) => {
      const field = {
        name: key,
        type: value.type,
        isRequired: requiredFields?.includes(key),
      };

      convertedFields.push(field);
    });

    return convertedFields;
  }

  static processingFields(fieldsByRoute) {
    const fields = [];
    if (!fieldsByRoute) {
      return fields;
    }
    const entries = Object.entries(fieldsByRoute);
    entries.forEach(([key, value]) => {
      const field = {};
      field.name = key;
      field.type = value.type;
      if (value.exclusiveTests) {
        field.isRequired = value.exclusiveTests.required;
      }
      if (value?.innerType) {
        field.innerType = value?.innerType?.type;
      }

      if (value.fields) {
        field.fields = [];
        // eslint-disable-next-line no-shadow
        const entries = Object.entries(value.fields);
        // eslint-disable-next-line no-shadow
        entries.forEach(([key, value]) => {
          field.fields.push({
            name: key,
            type: value.type,
          });
        });
      }
      fields.push(field);
    });
    return fields;
  }

  static convertDataToDocumentationElement(
    controllerName,
    routesInfo,
    middlewaresInfo,
    routeMiddlewaresReg,
  ) {
    return {
      contollerName: controllerName,
      routesInfo: routesInfo.map((route) => {
        const middlewareQueryParams = ReqValidator.getMiddlewareParams(
          middlewaresInfo,
          routeMiddlewaresReg,
          {
            method: route.method.toLowerCase(),
            path: route.fullPath,
          },
        ).query;

        const middlewareRequestParams = ReqValidator.getMiddlewareParams(
          middlewaresInfo,
          routeMiddlewaresReg,
          {
            method: route.method.toLowerCase(),
            path: route.fullPath,
          },
        ).request;

        const queryParams = this.convertYupFieldsToSwaggerFormat(
          middlewareQueryParams,
        );
        const requestParams = this.convertYupFieldsToSwaggerFormat(
          middlewareRequestParams,
        );

        return {
          [route.fullPath]: {
            method: route.method,
            name: route.name,
            description: route?.description,
            fields: this.processingFields(route.fields).concat(requestParams),
            queryFields: this.processingFields(route.queryFields).concat(
              queryParams,
            ),
            routeMiddlewares: routeMiddlewaresReg
              // eslint-disable-next-line consistent-return
              .map((middleware) => {
                const routeFullPath = route.fullPath.toUpperCase();
                const middlewareFullPath = middleware.fullPath.toUpperCase();
                if (
                  route.method.toLowerCase() ===
                    middleware.method.toLowerCase() &&
                  (middlewareFullPath === routeFullPath ||
                    middlewareFullPath === `${routeFullPath}*`)
                ) {
                  return {
                    name: middleware.name,
                    params: middleware.params,
                    authParams: middleware.authParams,
                  };
                }
              })
              .filter(Boolean),
            controllerMiddlewares: [
              ...new Set(
                middlewaresInfo
                  .filter((middleware) => {
                    const routeFullPath = route.fullPath.toUpperCase();
                    const middlewareFullPath =
                      middleware.fullPath.toUpperCase();
                    const middlewareFullPathWithSliced = middleware.fullPath
                      .toUpperCase()
                      .slice(0, -1);

                    return (
                      middlewareFullPath === routeFullPath ||
                      middlewareFullPath === `${routeFullPath}*` ||
                      routeFullPath?.indexOf(middlewareFullPathWithSliced) !==
                        -1
                    );
                  })
                  .map(({ name, params, authParams }) => ({
                    name,
                    params,
                    authParams,
                  })),
              ),
            ],
          },
        };
      }),
    };
  }
}

module.exports = DocumentationGenerator;
