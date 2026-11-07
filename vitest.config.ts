import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .test.tsx files are component tests: they ask for jsdom in their own first line (// @vitest-environment jsdom),
    // so the many Node tests (engine, server, database) keep running in plain Node.
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
    testTimeout: 30_000,   // PGlite starts a Postgres in WebAssembly for each database test
    hookTimeout: 30_000,
  },
})
