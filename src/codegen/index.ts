/**
 * Codegen public entry. Used by:
 *  - the `generatetypes` CLI command (`src/commands/GenerateTypes.ts`)
 *  - any programmatic caller (build plugin, watch mode, etc.)
 *
 * Splits into two outputs:
 *  - `genTypes.d.ts` at the project root (config + model maps)
 *  - `<File>.routes.gen.ts` next to each controller (handler request shapes)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IApp } from '../server.ts';
import {
  type CodegenLogger,
  generateAppTypes,
  getTemplate,
} from './appTypes.ts';
import {
  deleteOrphans,
  generateRouteTypesViaAst,
  type PlannedOutput,
  planRouteTypes,
  writePlanned,
} from './astEmit.ts';

export type { CodegenLogger };
export { generateAppTypes, generateRouteTypesViaAst };

export interface GenerateAllOptions {
  /** Verify-only (CI drift guard): compare rendered output against disk, write
   * nothing, throw (non-zero exit) on any missing/stale/orphan file. */
  check?: boolean;
}

/**
 * Generate both app-level and per-controller route types from the AST front-end
 * — no app boot, no model imports. A controller whose `routes` / `middleware` /
 * `getHttpPath` isn't a literal (a loop, conditional, computed key, or `super`
 * — e.g. one that extends another controller and merges `super.routes`) can't be
 * statically analyzed. Rather than abort the whole run, such controllers are
 * SKIPPED with a warning: they work at runtime, only their generated request
 * types are omitted. Types for every analyzable controller are still written.
 *
 * Analysis runs fully BEFORE any write, so a failure never leaves partially
 * refreshed output (atomicity). With `{ check: true }` nothing is written and
 * any drift throws — wire `generatetypes --check` into CI.
 */
export async function generateAll(
  app: IApp,
  logger?: CodegenLogger | null,
  options: GenerateAllOptions = {},
): Promise<void> {
  // 1. Analyze everything first (pure text, no writes).
  const appTypesText = await getTemplate(
    app.internalFilesCache.configs,
    app.internalFilesCache.modelPaths,
    app.internalFilesCache.configPaths,
  );
  const plan = await planRouteTypes(app, logger, { skipNonAnalyzable: true });
  if (plan.needsBoot.length > 0) {
    const names = plan.needsBoot.map((p) => path.basename(p)).join(', ');
    logger?.warn?.(
      `Route-type codegen skipped ${plan.needsBoot.length} controller(s) that aren't statically analyzable: ${names}. ` +
        'Their `routes` / `middleware` / `getHttpPath` use a loop, conditional, computed value, or `super` ' +
        '(e.g. a controller that extends another and merges `super.routes`). They work at runtime — only their ' +
        'generated request types are skipped. Declare literal `routes` to get types.',
    );
    // A skipped controller that already has a gen file on disk is worse than a
    // routine skip: the file no longer reflects the source, is never rewritten
    // here, and is not an orphan (its source still exists) — without a loud
    // signal the stale types rot until a confusing consumer tsc error.
    const staleGen: string[] = [];
    for (const srcPath of plan.needsBoot) {
      const genPath = path.join(
        path.dirname(srcPath),
        `${path.basename(srcPath, path.extname(srcPath))}.routes.gen.ts`,
      );
      try {
        await fs.access(genPath);
        staleGen.push(genPath);
      } catch {
        // No gen file → routine skip, warning above is enough.
      }
    }
    if (staleGen.length > 0) {
      logger?.error?.(
        `Route-type codegen: ${staleGen.length} previously generated file(s) are now stale — ` +
          'their controller is no longer statically analyzable, so the file will NOT be updated:\n' +
          `${staleGen.map((p) => `  ${p}`).join('\n')}\n` +
          'Restore a literal `routes` return (optional `const` setup is allowed) or delete the stale file.',
      );
    }
  }

  const outputs: PlannedOutput[] = [
    { outPath: path.join(process.cwd(), 'genTypes.d.ts'), text: appTypesText },
    ...plan.outputs,
  ];

  // 2a. Check mode: compare against disk, write nothing, fail on drift.
  if (options.check) {
    const drift = await collectDrift(outputs, plan.orphans);
    if (drift.length > 0) {
      throw new Error(
        `generatetypes --check: ${drift.length} generated file(s) out of date — run \`npm run gen\`:\n${drift.join('\n')}`,
      );
    }
    logger?.info?.('generatetypes --check: all generated files up to date');
    return;
  }

  // 2b. Write everything, then clean up orphaned gen files.
  await writePlanned(outputs, logger);
  await deleteOrphans(plan.orphans, logger);
  logger?.info?.('TypeScript types generated successfully at genTypes.d.ts');
}

/** Byte-compare planned outputs against disk; list missing/stale/orphan files. */
async function collectDrift(
  outputs: PlannedOutput[],
  orphans: string[],
): Promise<string[]> {
  const drift: string[] = [];
  for (const { outPath, text } of outputs) {
    let onDisk: string | null = null;
    try {
      onDisk = await fs.readFile(outPath, 'utf8');
    } catch {
      onDisk = null;
    }
    if (onDisk === null) {
      drift.push(`  missing: ${outPath}`);
    } else if (onDisk !== text) {
      drift.push(`  stale:   ${outPath}`);
    }
  }
  for (const orphan of orphans) {
    drift.push(`  orphan:  ${orphan}`);
  }
  return drift;
}
