import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .test.tsx files are component tests: they ask for jsdom in their own first line (// @vitest-environment jsdom),
    // so the many Node tests (engine, server, database) keep running in plain Node.
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
    // PGlite starts a Postgres in WebAssembly for each database test, and a busy machine (CI, antivirus) can make that
    // slow. 60 s for any test; the files known to be long get 120 s of their own in scripts/slowTests.mjs, applied by
    // vitest.setup.ts. Not a blanket longer value: a quick test that hangs should still fail soon.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ['./vitest.setup.ts'],
    // In CI (or with SLOWEST_TESTS=1) print the 10 slowest tests at the end, so drift towards the limit shows early.
    reporters: process.env.CI || process.env.SLOWEST_TESTS ? ['default', './scripts/slowestReporter.mjs'] : ['default'],
  },
})
