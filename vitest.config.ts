import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,   // PGlite starts a Postgres in WebAssembly for each database test
    hookTimeout: 30_000,
  },
})
