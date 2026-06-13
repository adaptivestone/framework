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
 *
 * ANSI codes are emitted unconditionally — looks right in dev consoles, mild
 * pollution in file/Sentry transports for the one-time boot output.
 */

import type { MiddlewareEntry, RouteNode } from './RouteNode.ts';
import type { RouteRegistry } from './RouteRegistry.ts';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const METHOD_COLORS: Record<string, string> = {
  GET: '\x1b[34m', // blue
  HEAD: '\x1b[34m',
  POST: '\x1b[32m', // green
  PUT: '\x1b[33m', // yellow
  PATCH: '\x1b[33m',
  DELETE: '\x1b[31m', // red
  OPTIONS: '\x1b[90m', // gray
};
const PARAM = '\x1b[35m'; // magenta — covers :param and *splat
const FLAG = '\x1b[36m'; // cyan — schema flags

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

  formatNode(registry.root, '/', [], '', true, lines, counts, showRoot);

  const summary = `${counts.routes} route(s) across ${counts.nodes} node(s) in the tree.`;
  return ['Registered routes:', ...lines, '', summary].join('\n');
}

function joinPath(parent: string, segment: string): string {
  if (parent === '/' || parent === '') {
    return `/${segment}`;
  }
  return `${parent}/${segment}`;
}

function formatNode(
  node: RouteNode,
  fullPath: string,
  ancestorMws: MiddlewareEntry[],
  indent: string,
  isLast: boolean,
  lines: string[],
  counts: { routes: number; nodes: number },
  showRoot: boolean,
): void {
  counts.nodes += 1;

  // Filter local node middlewares against ancestor chain — only show what's
  // newly attached at this node. NOTE: this dedup is display-only. At runtime
  // the dispatcher runs the full accumulated chain in order with NO dedup, so a
  // class re-attached at multiple levels executes once per attachment; we hide
  // the repeat here purely to keep the tree readable. Inherited ones are listed
  // separately as `pmw:` (parent middleware) so you can see what came from above.
  const ancestorClasses = new Set(ancestorMws.map((m) => m.Class));
  const nodeNewMws = node.middlewares.filter(
    (m) => !ancestorClasses.has(m.Class),
  );

  // Render this node's line. Root is special: render as `/` instead of empty.
  const isRoot = node.segment === '' && counts.nodes === 1;
  if (isRoot && !showRoot) {
    // skip the root line itself, but still descend
  } else {
    const branch = isRoot ? '' : `${DIM}${isLast ? '└── ' : '├── '}${RESET}`;
    const seg = isRoot ? '/' : colorSegment(node.segment);
    const mwSuffix =
      nodeNewMws.length > 0
        ? `${DIM}  (mw: ${formatMwList(nodeNewMws)}${
            ancestorMws.length > 0
              ? `; pmw: ${formatMwList(dedupByClass(ancestorMws))}`
              : ''
          })${RESET}`
        : '';
    lines.push(`${indent}${branch}${seg}${mwSuffix}`);
  }

  // Render handler methods on this node.
  if (node.methods) {
    const methodKeys = Object.keys(node.methods);
    const childIndent = isRoot
      ? indent
      : indent + (isLast ? '    ' : `${DIM}│${RESET}   `);
    for (let i = 0; i < methodKeys.length; i++) {
      const m = methodKeys[i] as keyof typeof node.methods;
      const entry = node.methods[m];
      if (!entry) {
        continue;
      }
      counts.routes += 1;
      const flags: string[] = [];
      if (entry.request) {
        flags.push('request');
      }
      if (entry.query) {
        flags.push('query');
      }
      // Filter route-level middlewares against everything that already runs
      // at this node (ancestors + node-local). `mw:` lists what's newly
      // added for this specific route entry; `pmw:` lists the full chain
      // that runs before it (deduped, in chain order) — so the route line
      // is self-contained for "what runs for this exact route".
      const chainAtNode = [...ancestorMws, ...node.middlewares];
      const chainAtNodeClasses = new Set(chainAtNode.map((mw) => mw.Class));
      const routeNewMws =
        entry.middlewares?.filter((mw) => !chainAtNodeClasses.has(mw.Class)) ??
        [];
      if (routeNewMws.length > 0) {
        const parentPart =
          chainAtNode.length > 0
            ? `; pmw: ${formatMwList(dedupByClass(chainAtNode))}`
            : '';
        flags.push(`mw: ${formatMwList(routeNewMws)}${parentPart}`);
      }
      const flagSuffix = flags.length
        ? `  ${FLAG}[${flags.join(', ')}]${RESET}`
        : '';
      const isLastMethod =
        i === methodKeys.length - 1 &&
        node.children.size === 0 &&
        !node.paramChild &&
        !node.splatChild;
      const methodBranch = `${DIM}${isLastMethod ? '└── ' : '├── '}${RESET}`;
      const methodColor = METHOD_COLORS[m as string] ?? '';
      const paddedMethod = (m as string).padEnd(7);
      lines.push(
        `${childIndent}${methodBranch}${methodColor}${paddedMethod}${RESET} ${fullPath}${flagSuffix}`,
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
  const childIndent = isRoot
    ? indent
    : indent + (isLast ? '    ' : `${DIM}│${RESET}   `);
  const chainForChildren = [...ancestorMws, ...node.middlewares];
  for (let i = 0; i < allChildren.length; i++) {
    formatNode(
      // biome-ignore lint/style/noNonNullAssertion: i is in bounds
      allChildren[i]!,
      // biome-ignore lint/style/noNonNullAssertion: i is in bounds
      joinPath(fullPath, allChildren[i]!.segment),
      chainForChildren,
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

function colorSegment(segment: string): string {
  if (segment.startsWith(':') || segment.startsWith('*')) {
    return `${PARAM}${segment}${RESET}`;
  }
  return segment;
}

function dedupByClass(mws: MiddlewareEntry[]): MiddlewareEntry[] {
  const seen = new Set<MiddlewareEntry['Class']>();
  const out: MiddlewareEntry[] = [];
  for (const m of mws) {
    if (!seen.has(m.Class)) {
      seen.add(m.Class);
      out.push(m);
    }
  }
  return out;
}
