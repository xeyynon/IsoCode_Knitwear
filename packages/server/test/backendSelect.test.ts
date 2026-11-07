import { describe, expect, it } from 'vitest'
import { selectBackend } from './helpers.js'

// Which database the suite runs on is decided by TEST_DATABASE_URL alone. This needs no database.
describe('test backend selection (TEST_DATABASE_URL)', () => {
  it('uses PGlite when the variable is unset, empty or blank', () => {
    expect(selectBackend({})).toEqual({ kind: 'pglite' })
    expect(selectBackend({ TEST_DATABASE_URL: '' })).toEqual({ kind: 'pglite' })
    expect(selectBackend({ TEST_DATABASE_URL: '   ' })).toEqual({ kind: 'pglite' })
  })

  it('uses a real Postgres, with the URL as given, when it is set', () => {
    const url = 'postgres://postgres:postgres@localhost:5432/postgres'
    expect(selectBackend({ TEST_DATABASE_URL: url })).toEqual({ kind: 'postgres', url })
    expect(selectBackend({ TEST_DATABASE_URL: `  ${url}\n` })).toEqual({ kind: 'postgres', url })
    expect(selectBackend({ TEST_DATABASE_URL: 'postgresql://u:p@db.internal/postgres' }).kind).toBe('postgres')
  })

  it('refuses a bad value instead of quietly falling back to PGlite', () => {
    expect(() => selectBackend({ TEST_DATABASE_URL: 'not a url' })).toThrow(/TEST_DATABASE_URL is set but is not a connection string/)
    expect(() => selectBackend({ TEST_DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/must start with postgres:\/\//)
    expect(() => selectBackend({ TEST_DATABASE_URL: 'postgres:///db' })).toThrow(/no host/)
  })

  it('never puts the password in an error message', () => {
    for (const bad of ['mysql://root:hunter2@h/db', 'postgres://u:hunter2@/db']) {
      try { selectBackend({ TEST_DATABASE_URL: bad }); throw new Error('should have thrown') } catch (e) {
        expect((e as Error).message).not.toContain('hunter2')
      }
    }
  })

  // `npm run test:pg` is the same vitest run as the default; without the variable it would quietly test PGlite.
  it.runIf(process.env.npm_lifecycle_event === 'test:pg')('npm run test:pg refuses to run without TEST_DATABASE_URL', () => {
    expect(process.env.TEST_DATABASE_URL?.trim(), 'npm run test:pg needs TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres (a superuser on a disposable Postgres 16)').toBeTruthy()
  })

  it('reads the real environment by default, which is unset in a plain local run', () => {
    expect(selectBackend().kind).toBe(process.env.TEST_DATABASE_URL?.trim() ? 'postgres' : 'pglite')
  })
})
