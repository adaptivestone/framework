import Base from '../../modules/Base.ts';
import { collectMiddlewareSchemas } from '../http/middleware/schemas.ts';

class DocumentationGenerator extends Base {
  processingFields(fieldsByRoute) {
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
        const entries = Object.entries(value.fields);
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

  selectUniqueFields(fields) {
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

  /**
   * Map middleware-declared schemas to document field entries.
   *
   * TODO: lib-agnostic schema introspection requires `driver.toJsonSchema`
   * (per-vendor exporters: yup `describe()`, zod `z.toJSONSchema()`,
   * valibot/arktype native). Stubbed empty until that ships.
   */
  groupFieldsFromSchemas(_schemas) {
    return [];
  }

  convertDataToDocumentationElement(
    controllerName,
    routesInfo,
    middlewaresInfo,
    routeMiddlewaresReg,
  ) {
    return {
      contollerName: controllerName,
      routesInfo: routesInfo.map((route) => {
        const middlewareQueryParams = collectMiddlewareSchemas(
          this.app,
          middlewaresInfo,
          routeMiddlewaresReg,
          route.method.toLowerCase(),
          route.fullPath,
          'query',
        );

        const middlewareRequestParams = collectMiddlewareSchemas(
          this.app,
          middlewaresInfo,
          routeMiddlewaresReg,
          route.method.toLowerCase(),
          route.fullPath,
          'request',
        );

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

export default DocumentationGenerator;
