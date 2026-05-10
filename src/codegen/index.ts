/**
 * Codegen public entry. Used by:
 *  - the `generatetypes` CLI command (`src/commands/GenerateTypes.ts`)
 *  - any programmatic caller (build plugin, watch mode, etc.)
 *
 * Splits into two outputs:
 *  - `genTypes.d.ts` at the project root (config + model maps)
 *  - `<File>.routes.gen.ts` next to each controller (handler request shapes)
 */

import type { IApp } from '../server.ts';
import { type CodegenLogger, generateAppTypes } from './appTypes.ts';
import { generateRouteTypes } from './routeTypes.ts';

export type { CodegenLogger };
export { generateAppTypes, generateRouteTypes };

/** Generate both app-level and per-controller route types. */
export async function generateAll(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<void> {
  await generateAppTypes(app, logger);
  await generateRouteTypes(app, logger);
}
