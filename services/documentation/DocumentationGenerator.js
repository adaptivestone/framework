const Base = require('../../modules/Base');
const ValidateService = require('../validate/ValidateService');

class DocumentationGenerator extends Base {
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
        field.required = value.exclusiveTests.required;
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

  static selectUniqueFields(fields) {
    return Array.from(
      new Map(fields.map((item) => [item.name, item])).values(),
    ).reduce((uniqueArray, item) => {
      const existingItem = uniqueArray.find(
        (uniqueItem) => uniqueItem.name === item.name,
      );
      if (!existingItem) {
        uniqueArray.push(item);
      } else if (item.required) {
        existingItem.required = true;
      }
      return uniqueArray;
    }, []);
  }

  static groupFieldsFromSchemas(schemas) {
    const result = [];
    schemas.forEach((schema) => {
      const convertedSchema = new ValidateService(this.app, schema).validator;

      for (const [key, value] of Object.entries(
        convertedSchema?.fieldsInJsonFormat,
      )) {
        result.push({
          name: key,
          type: value.type,
          required: value.required,
        });
      }
    });

    return result;
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
        const middlewareQueryParams = ValidateService.getMiddlewareParams(
          middlewaresInfo,
          routeMiddlewaresReg,
          {
            method: route.method.toLowerCase(),
            path: route.fullPath,
          },
        ).query;

        const middlewareRequestParams = ValidateService.getMiddlewareParams(
          middlewaresInfo,
          routeMiddlewaresReg,
          {
            method: route.method.toLowerCase(),
            path: route.fullPath,
          },
        ).request;

        const queryParams = this.groupFieldsFromSchemas(middlewareQueryParams);

        const requestParams = this.groupFieldsFromSchemas(
          middlewareRequestParams,
        );

        return {
          [route.fullPath]: {
            method: route.method,
            name: route.name,
            description: route?.description,
            fields: this.selectUniqueFields([
              ...this.processingFields(route.fields),
              ...requestParams,
            ]),
            queryFields: this.selectUniqueFields([
              ...this.processingFields(route.queryFields),
              ...queryParams,
            ]),
            routeMiddlewares: routeMiddlewaresReg
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
                return null;
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
