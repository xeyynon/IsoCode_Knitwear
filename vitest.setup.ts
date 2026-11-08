import { expect, vi } from 'vitest'
import { slowTimeoutFor } from './scripts/slowTests.mjs'

// A longer time limit for the files that start PGlite or spawn git many times (see scripts/slowTests.mjs). Set per test
// file, so a quick test that hangs still fails in the default time.
const ms = slowTimeoutFor(expect.getState().testPath ?? '')
if (ms) vi.setConfig({ testTimeout: ms, hookTimeout: ms })
