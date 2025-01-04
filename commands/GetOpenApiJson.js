import { promises as fs } from 'node:fs';
import AbstractCommand from '../modules/AbstractCommand.js';

/**
 * Command for generate documentation json file openApi
 */
class GetOpenApiJson extends AbstractCommand {
  static get description() {
    return 'Generate documentation (openApi) ';
  }

  async run() {
    const { myDomain } = this.app.getConfig('http');
    let jsonFile = process.env.npm_package_json;
    if (!jsonFile) {
      jsonFile = `${process.env.PWD}/package.json`;
    }

    try {
      jsonFile = JSON.parse(await fs.readFile(jsonFile, 'utf8'));
    } catch (e) {
      this.logger.error(
        'No npm package detected. Please start this command via NPM as it depends on package.json',
      );
    }

    if (!jsonFile) {
      jsonFile = {
        name: 'UNDETECTD PROJECT',
        description: 'UNDETECTD PROJECT DECCRIPTION',
        version: '0.0.0-undetrcted',
        author: {
          email: 'none@example.com',
        },
      };
    }

    if (!jsonFile.author) {
      jsonFile.author = 'none@example.com';
    }

    const openApi = {
      openapi: '3.0.0',
      info: {
        title: jsonFile.name,
        description: jsonFile.description,
        contact: {
          email: jsonFile.author.email,
        },
        version: jsonFile.version,
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

    const permissionWithRoutes = {};
    for (const controller of baseDocumentation) {
      for (const route of controller.routesInfo) {
        const routeInfo = route[Object.keys(route)?.[0]];
        const middlewares = [
          ...routeInfo.controllerMiddlewares,
          ...routeInfo.routeMiddlewares,
        ];

        const securitySchemaNames = [];

        permissionWithRoutes[Object.keys(route)?.[0]] = [];

        if (middlewares?.length) {
          for (const middleware of middlewares) {
            if (middleware?.authParams?.length) {
              for (const authParam of middleware.authParams) {
                const { permissions, ...mainFields } = authParam;
                const fullName = authParam.name;
                if (permissions) {
                  permissionWithRoutes[Object.keys(route)?.[0]].push(
                    permissions,
                  );
                }

                if (!openApi.components.securitySchemes[fullName]) {
                  openApi.components.securitySchemes[fullName] = mainFields;
                }

                securitySchemaNames.push({
                  [fullName]: [],
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

        const routeDescription =
          route[Object.keys(route)[0]]?.description || 'empty description';
        const permissions =
          permissionWithRoutes[Object.keys(route)[0]][
            permissionWithRoutes[Object.keys(route)[0]].length - 1
          ];
        const routeDescriptionWithPermissions = `${
          permissions || ''
        } ${routeDescription}`;
        const methodName = route[Object.keys(route)[0]].method.toLowerCase();
        const routeTitle = route[Object.keys(route)[0]].name;

        const routeFields = route[Object.keys(route)[0]].fields;
        const routeQueryFields = route[Object.keys(route)[0]].queryFields;

        if (!openApi.paths[routeName][methodName]) {
          openApi.paths[routeName][methodName] = {};
        }

        openApi.paths[routeName][methodName].tags = [];

        openApi.paths[routeName][methodName].tags.push(
          controller.contollerName.split('/')[0],
        );

        openApi.paths[routeName][methodName].summary = routeTitle;
        openApi.paths[routeName][methodName].description =
          routeDescriptionWithPermissions;
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

        for (const queryField of routeQueryFields) {
          openApi.paths[routeName][methodName].parameters.push({
            name: queryField.name,
            in: 'query',
            required: queryField?.required,
            schema: {
              type: queryField.type,
            },
          });
        }

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
          let isMultipartFormaData = false;
          for (const field of routeFields) {
            if (field.required) {
              requiredFields.push(field.name);
            }

            switch (field.type) {
              case 'object':
                groupBodyFields[field.name] = {
                  properties: {},
                };

                for (const objField of field.fields) {
                  groupBodyFields[field.name].properties[objField.name] = {
                    // fields file has mixed type but openApi doesnt have this type
                    type: objField.type === 'mixed' ? 'string' : objField.type,
                  };
                }

                break;

              case 'array':
                groupBodyFields[field.name] = {
                  items: {
                    type: field.innerType,
                  },
                };
                break;

              case 'lazy':
                groupBodyFields[field.name] = {
                  oneOf: [
                    {
                      type: 'object',
                    },
                    {
                      type: 'string',
                    },
                  ],
                };
                break;

              case 'file':
                groupBodyFields[field.name] = {
                  type: 'string',
                  format: 'binary',
                };
                isMultipartFormaData = true;
                break;
              default:
                groupBodyFields[field.name] = {
                  type: field.type,
                };
            }
          }

          const contentType = isMultipartFormaData
            ? 'multipart/form-data'
            : 'application/json';

          openApi.paths[routeName][methodName].requestBody = {
            content: {
              [contentType]: {
                schema: {
                  type: 'object',
                  properties: groupBodyFields,
                },
              },
            },
          };

          if (requiredFields.length) {
            openApi.paths[routeName][methodName].requestBody.content[
              contentType
            ].schema.required = requiredFields;
          }
        }
      }
    }

    const result = JSON.stringify(openApi);

    if (this.args.output) {
      await fs.writeFile(this.args.output, result);
      this.logger.info(`Output to: ${this.args.output}`);
    }

    return result;
  }
}

export default GetOpenApiJson;
