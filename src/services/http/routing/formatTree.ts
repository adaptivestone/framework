/**
 * Format the route registry as a tree for boot-time logging.
 *
 * Walks the tree depth-first, indenting children. Per node, shows:
 *  - the segment name
 *  - any node-level middlewares (`mw: Class1, Class2`)
 *  - per-method handler entries (`METHOD → handlerName [request][query][mw: ...]`)
 *
 * Output is a single multi-line string — caller pipes through `logger.info`
 * or similar. Mirrors what the old `AbstractController` constructor logged
 * per-controller, but walks the unified registry tree instead, so
 * cross-controller middleware accumulation is visible.
 */

import type { MiddlewareEntry, RouteNode } from './RouteNode.ts';
import type { RouteRegistry } from './RouteRegistry.ts';

interface FormatOptions {
  /** Treat the root segment as `/` (default true). */
  showRoot?: boolean;
}

export function formatRouteTree(
  registry: RouteRegistry,
  options: FormatOptions = {},
): string {
  const showRoot = options.showRoot ?? true;
  const lines: string[] = [];
  const counts = { routes: 0, nodes: 0 };

  formatNode(registry.root, '', true, lines, counts, showRoot);

  const summary = `${counts.routes} route(s) across ${counts.nodes} node(s) in the tree.`;
  return ['Registered routes:', ...lines, '', summary].join('\n');
}

function formatNode(
  node: RouteNode,
  indent: string,
  isLast: boolean,
  lines: string[],
  counts: { routes: number; nodes: number },
  showRoot: boolean,
): void {
  counts.nodes += 1;

  // Render this node's line. Root is special: render as `/` instead of empty.
  const isRoot = node.segment === '' && counts.nodes === 1;
  if (isRoot && !showRoot) {
    // skip the root line itself, but still descend
  } else {
    const branch = isRoot ? '' : isLast ? '└── ' : '├── ';
    const seg = isRoot ? '/' : node.segment;
    const mwSuffix =
      node.middlewares.length > 0
        ? `  (mw: ${formatMwList(node.middlewares)})`
        : '';
    lines.push(`${indent}${branch}${seg}${mwSuffix}`);
  }

  // Render handler methods on this node.
  if (node.methods) {
    const methodKeys = Object.keys(node.methods);
    const childIndent = isRoot ? indent : indent + (isLast ? '    ' : '│   ');
    for (let i = 0; i < methodKeys.length; i++) {
      const m = methodKeys[i] as keyof typeof node.methods;
      const entry = node.methods[m];
      if (!entry) {
        continue;
      }
      counts.routes += 1;
      const handlerName = entry.meta?.methodName ?? '<anonymous>';
      const flags: string[] = [];
      if (entry.request) {
        flags.push('request');
      }
      if (entry.query) {
        flags.push('query');
      }
      if (entry.middlewares?.length) {
        flags.push(`mw: ${formatMwList(entry.middlewares)}`);
      }
      const flagSuffix = flags.length ? `  [${flags.join(', ')}]` : '';
      const isLastMethod =
        i === methodKeys.length - 1 &&
        node.children.size === 0 &&
        !node.paramChild &&
        !node.splatChild;
      const methodBranch = isLastMethod ? '└── ' : '├── ';
      lines.push(
        `${childIndent}${methodBranch}${m} → ${handlerName}${flagSuffix}`,
      );
    }
  }

  // Recurse: static children, then paramChild, then splatChild.
  const allChildren: RouteNode[] = [...node.children.values()];
  if (node.paramChild) {
    allChildren.push(node.paramChild);
  }
  if (node.splatChild) {
    allChildren.push(node.splatChild);
  }
  const childIndent = isRoot ? indent : indent + (isLast ? '    ' : '│   ');
  for (let i = 0; i < allChildren.length; i++) {
    formatNode(
      // biome-ignore lint/style/noNonNullAssertion: i is in bounds
      allChildren[i]!,
      childIndent,
      i === allChildren.length - 1,
      lines,
      counts,
      showRoot,
    );
  }
}

function formatMwList(mws: MiddlewareEntry[]): string {
  return mws
    .map((m) => (m.params ? `${m.Class.name}{…}` : m.Class.name))
    .join(', ');
}
