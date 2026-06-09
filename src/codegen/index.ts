/**
 * Codegen public entry. Used by:
 *  - the `generatetypes` CLI command (`src/commands/GenerateTypes.ts`)
 *  - any programmatic caller (build plugin, watch mode, etc.)
 *
 * Splits into two outputs:
 *  - `genTypes.d.ts` at the project root (config + model maps)
 *  - `<File>.routes.gen.ts` next to each controller (handler request shapes)
 */

import path from 'node:path';
import type { IApp } from '../server.ts';
import { type CodegenLogger, generateAppTypes } from './appTypes.ts';
import { generateRouteTypesViaAst } from './astEmit.ts';

export type { CodegenLogger };
export { generateAppTypes, generateRouteTypesViaAst };

/**
 * Generate both app-level and per-controller route types from the AST front-end
 * — no app boot, no model imports, no `importResolution`. A controller whose
 * `routes` / `middleware` / `getHttpPath` isn't a literal can't be statically
 * analyzed; rather than silently mis-generate, codegen throws and names it so
 * it can be made declarative.
 */
export async function generateAll(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<void> {
  await generateAppTypes(app, logger);
  const { needsBoot } = await generateRouteTypesViaAst(app, logger);
  if (needsBoot.length > 0) {
    const names = needsBoot.map((p) => path.basename(p)).join(', ');
    throw new Error(
      `Route-type codegen can't statically analyze ${needsBoot.length} controller(s): ${names}. ` +
        'Their `routes` / `middleware` / `getHttpPath` must be literal (no loops, ' +
        'conditionals, or computed values). Make them declarative.',
    );
  }
}
