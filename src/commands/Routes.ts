import AbstractCommand from '../modules/AbstractCommand.ts';
import type HttpServer from '../services/http/HttpServer.ts';
import { formatRouteTree } from '../services/http/routing/formatTree.ts';

/**
 * Print the project's route tree — "what's mounted in my app".
 *
 * Boot-based, no DB / no port: builds a `RouteRegistry` and registers every
 * controller with `skipWrap` (no middleware instantiation, no mongo, no HTTP
 * listen), then renders the SAME tree the server logs at boot. Mirrors the
 * `openapi` command's registry build and reuses `formatRouteTree`, so there is
 * one source of truth for "what routes exist".
 */
class Routes extends AbstractCommand {
  static get description(): string {
    return 'Print the project route tree (what is mounted in the app)';
  }

  // No DB / no model paths — pure route introspection.
  static isShouldInitModels = false;
  static isShouldGetModelPaths = false;

  async run(): Promise<boolean> {
    // Build the route registry without an HttpServer (its ctor binds a port).
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

    console.log(formatRouteTree(registry));
    return true;
  }
}

export default Routes;
