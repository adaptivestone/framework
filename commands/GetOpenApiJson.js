const AbstractCommand = require('../modules/AbstractCommand');

class GetOpenApiJson extends AbstractCommand {
  async run() {
    const { myDomain } = this.app.getConfig('http');
    const openApi = {
      openapi: '3.0.0',
      info: {
        title: 'Some title',
        description: 'This is a simple API',
        contact: {
          email: 'you@your-company.com',
        },
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3300',
          description: 'Localhost',
        },
        {
          url: myDomain,
          description: 'Domain from config',
        },
      ],
    };

    const baseDocumentation = await this.app.runCliCommand('documentation');

    if (!baseDocumentation) {
      throw new Error('Problems with basic documenation generation');
    }

    openApi.components = {};
    openApi.components.securitySchemes = {};

    openApi.tags = [];

    for (const controller of baseDocumentation) {
      const controllerName = controller.contollerName.split('/')[0];
      if (!openApi.tags.find((tag) => tag.name === controllerName)) {
        openApi.tags.push({
          name: controllerName,
          description: '',
        });
      }
    }

    openApi.paths = {};

    for (const controller of baseDocumentation) {
      for (const route of controller.routesInfo) {
        const routeInfo = route[Object.keys(route)?.[0]];
        const middlewares = [
          ...routeInfo.controllerMiddlewares,
          ...routeInfo.routeMiddlewares,
        ];

        const securitySchemaNames = [];

        if (middlewares?.length) {
          for (const middleware of middlewares) {
            if (middleware?.authParams?.length) {
              for (const authParam of middleware.authParams) {
                if (!openApi.components.securitySchemes[authParam.name]) {
                  openApi.components.securitySchemes[authParam.name] =
                    authParam;
                }

                securitySchemaNames.push({
                  [authParam.name]: [],
                });
              }
            }
          }
        }

        let routeName = Object.keys(route)[0];

        if (routeName === '/') {
          // eslint-disable-next-line no-continue
          continue;
        }

        if (routeName.slice(-1) === '/') {
          routeName = routeName.substring(0, routeName.length - 1);
        }

        const partsRoute = routeName.split('/');

        const newRoute = [];
        const routeParameters = [];
        for (const routeDetail of partsRoute) {
          let routeCopy = routeDetail;

          if (routeDetail.startsWith(':')) {
            const routeChange = routeCopy.split('');
            routeChange[0] = '{';
            routeChange.push('}');
            routeCopy = routeChange.join('');
            routeParameters.push(routeCopy.replace(/^.|.$/g, ''));
          }

          newRoute.push(routeCopy);
        }

        routeName = newRoute.join('/');

        if (!openApi.paths[routeName]) {
          openApi.paths[routeName] = {};
        }

        const methodName = route[Object.keys(route)[0]].method.toLowerCase();
        const routeTitle = route[Object.keys(route)[0]].name;
        const routeDescription =
          route[Object.keys(route)[0]]?.description || 'empty description';
        const routeFields = route[Object.keys(route)[0]].fields;

        if (!openApi.paths[routeName][methodName]) {
          openApi.paths[routeName][methodName] = {};
        }

        openApi.paths[routeName][methodName].tags = [];

        openApi.paths[routeName][methodName].tags.push(
          controller.contollerName.split('/')[0],
        );

        openApi.paths[routeName][methodName].summary = routeTitle;
        openApi.paths[routeName][methodName].description = routeDescription;
        openApi.paths[routeName][methodName].parameters = [];
        openApi.paths[routeName][methodName].security = securitySchemaNames;

        openApi.paths[routeName][methodName].responses = {
          200: {
            description: 'Successfully',
          },
          201: {
            description: 'The resource was created successfully',
          },
          400: {
            description: 'There is a syntax error in the request',
          },
          401: {
            description:
              'Authentication is required to access the requested resource',
          },
          404: {
            description:
              'The server accepted the request, but did not find the corresponding resource at the specified URI',
          },
        };

        for (const routeField of routeParameters) {
          openApi.paths[routeName][methodName].parameters.push({
            name: routeField,
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
          });
        }

        if (routeFields.length) {
          const groupBodyFields = {};
          const requiredFields = [];
          for (const field of routeFields) {
            if (field.isRequired) {
              requiredFields.push(field.name);
            }

            if (field.type === 'object') {
              groupBodyFields[field.name] = {};
              const objectFields = {};
              for (const objField of field.fields) {
                objectFields[objField.name] = {
                  // fields file has mixed type but openApi doesnt have this type
                  type: objField.type === 'mixed' ? 'string' : objField.type,
                };
              }

              groupBodyFields[field.name].properties = objectFields;
            } else {
              groupBodyFields[field.name] = {
                type: field.type,
              };

              if (field.type === 'array') {
                groupBodyFields[field.name].items = {
                  type: field.innerType,
                };
              }
            }
          }

          openApi.paths[routeName][methodName].requestBody = {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: groupBodyFields,
                },
              },
            },
          };

          if (requiredFields.length) {
            openApi.paths[routeName][methodName].requestBody.content[
              'application/json'
            ].schema.required = requiredFields;
          }
        }
      }
    }

    const result = JSON.stringify(openApi);
    console.log(result);
    return result;
  }
}

module.exports = GetOpenApiJson;
