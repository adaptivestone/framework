#!/usr/bin/env bash
#
# Run the framework test suite under Bun's Node compatibility layer.
#
# Bun implements `node:test`'s API but not Node's test-runner CLI, so the `t`
# script's flags do not carry over. This script is the Bun equivalent:
#
#   node --test --test-global-setup=…   →   bun test  +  an externally started
#                                            Mongo, published as TEST_MONGO_URI
#   --import=<preload>                  →   --preload <preload> (same modules)
#   --test-timeout=10000                →   --timeout=10000
#   one process per test file           →   --isolate (fresh module registry
#                                            per file, so each file boots its
#                                            own Server exactly as under Node)
#
# `--experimental-test-module-mocks` has NO Bun equivalent: `mock.module()`
# throws ERR_NOT_IMPLEMENTED (oven-sh/bun#5090). The four files that depend on
# it are excluded below and named in README.md; nothing else is skipped.
#
# Mongo: an in-memory replica set is started here (the suite's change-stream
# tests need a replica set, not a standalone mongod) unless TEST_MONGO_URI is
# already set. The URI must contain `__DB_TO_REPLACE__`; each test file swaps in
# its own database name.
#
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "→ bun not installed — SKIPPING the Bun test run"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Bun $(bun --version)"

MONGO_PID=""
URI_FILE=""
cleanup() {
  if [ -n "$MONGO_PID" ]; then
    kill "$MONGO_PID" 2>/dev/null || true
    wait "$MONGO_PID" 2>/dev/null || true
  fi
  [ -n "$URI_FILE" ] && rm -f "$URI_FILE"
}
trap cleanup EXIT

if [ -z "${TEST_MONGO_URI:-}" ]; then
  echo "→ Starting an in-memory Mongo replica set (mongodb-memory-server)"
  URI_FILE="$(mktemp)"
  MONGO_URI_FILE="$URI_FILE" bun -e '
    import { writeFileSync } from "node:fs";
    const { MongoMemoryReplSet } = await import("mongodb-memory-server");
    const rs = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await rs.waitUntilRunning();
    writeFileSync(process.env.MONGO_URI_FILE, await rs.getUri("__DB_TO_REPLACE__"));
    const stop = async () => { await rs.stop(); process.exit(0); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    setInterval(() => {}, 1 << 30);
  ' &
  MONGO_PID=$!
  for _ in $(seq 1 120); do
    [ -s "$URI_FILE" ] && break
    kill -0 "$MONGO_PID" 2>/dev/null || { echo "✗ Mongo failed to start"; exit 1; }
    sleep 1
  done
  [ -s "$URI_FILE" ] || { echo "✗ Timed out waiting for Mongo"; exit 1; }
  TEST_MONGO_URI="$(cat "$URI_FILE")"
  export TEST_MONGO_URI
fi
echo "  TEST_MONGO_URI=$TEST_MONGO_URI"

export LOGGER_CONSOLE_LEVEL="${LOGGER_CONSOLE_LEVEL:-error}"

echo "→ bun test"
bun test \
  --isolate \
  --timeout=10000 \
  --preload ./src/tests/setupNodeTest.ts \
  --preload ./src/tests/frameworkNodeTestSetup.ts \
  --path-ignore-patterns='**/cluster.test.ts' \
  --path-ignore-patterns='**/UserOld.test.ts' \
  --path-ignore-patterns='**/redisConnection.failure.test.ts' \
  --path-ignore-patterns='**/I18n.missing.test.ts' \
  src/ \
  ./src/tests/nodeRunner.node-test.ts \
  ./src/tests/nodeRunnerShared.node-test.ts \
  "$@"
