import fs from 'node:fs/promises';
import path from 'node:path';
import AbstractCommand from '../modules/AbstractCommand.ts';
import {
  generateOpenApi,
  type OpenApiInfo,
} from '../services/documentation/OpenApiGenerator.ts';
import type HttpServer from '../services/http/HttpServer.ts';

/**
 * Generate an OpenAPI 3.1 document from the app's controllers.
 *
 * Boot-based: builds a `RouteRegistry` and registers every controller with
 * `skipWrap` (no middleware instantiation, no mongo, no HTTP listen), then walks
 * `flatten()` — the SAME route model codegen reads. Loading the controllers is
 * what gives the generator the *live* schema objects needed to emit JSON Schema
 * (the AST front-end only sees type references). OpenAPI is a cold, rare run, so
 * the one-time load is fine.
 */
class OpenApi extends AbstractCommand {
  static get description(): string {
    return 'Generate an OpenAPI 3.1 JSON document from controllers and routes';
  }

  // No DB / no model paths — pure route + schema introspection.
  static isShouldInitModels = false;
  static isShouldGetModelPaths = false;

  static get commandArguments() {
    return {
      output: {
        type: 'string' as const,
        description: 'Output file path. Omit to print to stdout.',
      },
    };
  }

  async run(): Promise<boolean> {
    // 1. Build the route registry without an HttpServer (its ctor binds a port).
    const { RouteRegistry } = await import(
      '../services/http/routing/RouteRegistry.ts'
    );
    const { default: ControllerManager } = await import(
      '../controllers/index.ts'
    );
    const registry = new RouteRegistry();
    this.app.httpServer = {
      routeRegistry: registry,
    } as unknown as HttpServer;
    const controllerManager = new ControllerManager(this.app);
    this.app.controllerManager = controllerManager;
    await controllerManager.initControllers({ skipWrap: true });
    const routes = registry.flatten();

    // 2. Document metadata from package.json + http config.
    const info = await this.readPackageInfo();
    const http = this.app.getConfig('http') as {
      port?: number | string;
      myDomain?: string;
    };
    const servers = [
      {
        url: `http://localhost:${http.port ?? 3300}`,
        description: 'Localhost',
      },
      ...(http.myDomain
        ? [{ url: http.myDomain, description: 'Domain from config' }]
        : []),
    ];

    // 3. Generate.
    const warnings: string[] = [];
    const doc = await generateOpenApi(routes, {
      info,
      servers,
      onWarning: (m) => warnings.push(m),
    });
    if (warnings.length > 0) {
      this.logger?.warn(
        `OpenAPI: ${warnings.length} schema(s) could not be fully introspected:\n  ${warnings.join('\n  ')}`,
      );
    }

    // 4. Emit.
    const json = JSON.stringify(doc, null, 2);
    const output = this.args.output as string | undefined;
    if (output) {
      await fs.writeFile(output, json);
      this.logger?.info(`OpenAPI document written to ${output}`);
    } else {
      console.log(json);
    }
    return true;
  }

  /** Read `name`/`description`/`version`/`author.email` from the consumer's package.json. */
  private async readPackageInfo(): Promise<OpenApiInfo> {
    const fallback: OpenApiInfo = {
      title: 'API',
      description: undefined,
      version: '0.0.0',
    };
    const pkgPath =
      process.env.npm_package_json ?? path.join(process.cwd(), 'package.json');
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
        name?: string;
        description?: string;
        version?: string;
        author?: string | { email?: string };
      };
      const email =
        typeof pkg.author === 'object' ? pkg.author?.email : undefined;
      return {
        title: pkg.name ?? fallback.title,
        description: pkg.description,
        version: pkg.version ?? fallback.version,
        ...(email ? { contact: { email } } : {}),
      };
    } catch {
      this.logger?.warn(
        `OpenAPI: could not read package.json at ${pkgPath}; using defaults.`,
      );
      return fallback;
    }
  }
}

export default OpenApi;
