import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertTextMatch, assertThrowsLike } from './assertions.ts';
import { configureTestServer } from './testHelpers.ts';

// The consumer bootstrap runs in a spawned child: this test file already has a
// booted shared server, so the "options reach the Server constructor" path needs
// its own process. It reuses the parent's `TEST_MONGO_URI` (published by the
// global setup), so it boots against the same Mongo.
const fixture = fileURLToPath(
  new URL('./fixtures/testBootstrapServer.ts', import.meta.url),
);

const runChild = (
  args: string[],
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve, reject) => {
    const env = { ...process.env } as NodeJS.ProcessEnv;
    env.LOGGER_CONSOLE_LEVEL = 'error';
    // This suite itself runs under node:test; without this the child's own
    // `--test` sees the inherited context and skips running files.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn('node', args, { env });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d) => {
      out += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out.\n${out}`));
    }, 25000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });

describe('configureTestServer — consumer Server options in the test bootstrap', () => {
  it('runs the configured bootHttp hook before the adapter mounts', async () => {
    const { code, out } = await runChild([fixture]);

    assertTextMatch(out, /HOOK_RAN/);
    // Served through the adapter → the hook ran while the registry was still
    // being built, exactly as it does in production.
    assertTextMatch(out, /ROUTE_STATUS:200/);
    assertTextMatch(out, /ROUTE_BODY:\{"bootHttp":"ran"\}/);
    assert.strictEqual(code, 0);
  }, 40000);

  it('works in the documented arrangement: glue imported above the call', async () => {
    // The changelog snippet: `import '…/setupNodeTest.js'` hoisted above a
    // module-scope `configureTestServer(...)` call, run as a `--test` preload.
    // node:test fires the glue's root `before()` at registration — during the
    // preload's own import evaluation — so without the deferred boot the
    // options window closed before the call ran and every file died on the
    // helper's guard.
    const preload = fileURLToPath(
      new URL('./fixtures/documentedPreloadArrangement.ts', import.meta.url),
    );
    const childTest = fileURLToPath(
      new URL(
        './fixtures/documentedPreloadArrangement.child.ts',
        import.meta.url,
      ),
    );
    const { code, out } = await runChild([
      '--import',
      preload,
      '--test',
      childTest,
    ]);

    assertTextMatch(out, /DOC_PRELOAD_OK/);
    assertTextMatch(out, /DOC_HOOK_RAN/);
    assertTextMatch(out, /pass 1/);
    assert.strictEqual(code, 0);
  }, 40000);

  it('throws when called after the test server has booted', () => {
    assertThrowsLike(
      () => configureTestServer({ bootHttp: () => {} }),
      'must be called before the test server boots',
    );
  });
});
