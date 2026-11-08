import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Vercel entry's start-up (vercel.ts init), with the database driver replaced by a small fake: S-5 and S-6.
const state = vi.hoisted(() => ({ ended: 0, pools: 0, roleRow: { name: 'app_user', superuser: false, bypassrls: false, owned: 0 } as Record<string, unknown> | null }))

vi.mock('pg', () => {
  class Pool {
    constructor() { state.pools++ }
    async query() { return { rows: state.roleRow ? [state.roleRow] : [] } }
    async end() { state.ended++ }
    on() { return this }
  }
  return { default: { Pool, types: { setTypeParser() {} } }, Pool }
})

import { init } from '../src/vercel'

const ENV = { DATABASE_URL: 'postgres://app_user:x@localhost:5432/db', TOKEN_SECRET: 'x'.repeat(40) }

beforeEach(() => { state.ended = 0; state.pools = 0; state.roleRow = { name: 'app_user', superuser: false, bypassrls: false, owned: 0 } })
afterEach(() => { vi.restoreAllMocks() })

describe('S-5: an AI provider named without its key must not take the whole API down', () => {
  it('S-5: start-up succeeds, logs the reason once, and runs with AI off', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = await init({ ...ENV, AI_PROVIDER: 'gemini' })
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    const aiLines = errors.mock.calls.filter((c) => String(c[0]).includes('GEMINI_API_KEY'))
    expect(aiLines).toHaveLength(1)
    expect(String(aiLines[0]![0])).toMatch(/AI suggestions are off/)
    await app.close()
  })

  it('S-5: with no AI settings at all it starts quietly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = await init({ ...ENV })
    expect(errors).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('S-6: a start-up that fails does not leave its connection pool open', () => {
  it('S-6: an unsafe database login ends the pool before the error is thrown', async () => {
    state.roleRow = { name: 'postgres', superuser: true, bypassrls: true, owned: 3 }
    await expect(init({ ...ENV })).rejects.toThrow(/superuser/)
    expect(state.pools).toBe(1)
    expect(state.ended).toBe(1)
  })

  it('S-6: a start-up that fails later (a missing TOKEN_SECRET) ends the pool too', async () => {
    await expect(init({ DATABASE_URL: ENV.DATABASE_URL })).rejects.toThrow(/TOKEN_SECRET/)
    expect(state.ended).toBe(1)
  })

  it('S-6: a start-up that works keeps its pool open for the requests', async () => {
    const app = await init({ ...ENV })
    expect(state.ended).toBe(0)
    await app.close()
  })
})
