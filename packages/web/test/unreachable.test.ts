import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyFetchError, describeFailure, isGatewayFailure, isUnreachable } from '../src/api/sessionRules'
import { ApiError, apiBlob, apiFetch } from '../src/api/session'
import { classifyError } from '../src/queue/sync'
import { strings } from '../src/i18n'

afterEach(() => vi.unstubAllGlobals())

/** What the request threw; fails the test if it did not throw. */
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('the request did not fail') }, (x: unknown) => x as ApiError & Error)

describe('telling "cannot reach the server" from "the server said no"', () => {
  it('a thrown fetch is the network; only the caller aborting its own request is not', () => {
    expect(classifyFetchError(new TypeError('Failed to fetch'), false)).toBe('unreachable')
    expect(classifyFetchError(new DOMException('timed out', 'TimeoutError'), false)).toBe('unreachable')
    expect(classifyFetchError(new DOMException('aborted', 'AbortError'), true)).toBe('cancelled')
    expect(classifyFetchError(new DOMException('aborted', 'AbortError'), false)).toBe('unreachable')
  })

  it('a gateway answer is not the app answering', () => {
    for (const s of [502, 503, 504]) expect(isGatewayFailure(s, true)).toBe(true)
    expect(isGatewayFailure(500, false)).toBe(true)           // a proxy error page, not our JSON
    expect(isGatewayFailure(500, true)).toBe(false)           // the app's own error
    expect(isGatewayFailure(404, false)).toBe(false)
    expect(isGatewayFailure(409, true)).toBe(false)
  })

  it('isUnreachable reads the ApiError the fetch wrapper throws', () => {
    expect(isUnreachable(new ApiError(0, 'unreachable', 'x'))).toBe(true)
    expect(isUnreachable(new ApiError(503, 'unreachable', 'x'))).toBe(true)
    expect(isUnreachable(new ApiError(0, 'error', 'x'))).toBe(true)
    expect(isUnreachable(new ApiError(404, 'not_found', 'Not found'))).toBe(false)
    expect(isUnreachable(new Error('boom'))).toBe(false)
    expect(isUnreachable(null)).toBe(false)
    expect(isUnreachable('nope')).toBe(false)
  })

  it('describeFailure keeps the server words for a real answer and flags the connection otherwise', () => {
    expect(describeFailure(new ApiError(403, 'forbidden', 'Not allowed.'), 'Could not load.')).toEqual({ message: 'Not allowed.', unreachable: false })
    expect(describeFailure(new Error('boom'), 'Could not load.')).toEqual({ message: 'Could not load.', unreachable: false })
    const f = describeFailure(new ApiError(0, 'unreachable', 'x'), 'Could not load.')
    expect(f.unreachable).toBe(true)
    expect(f.message).toMatch(/Cannot reach the server/)
  })
})

describe('apiFetch', () => {
  it('a thrown fetch becomes an unreachable ApiError', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    const e = await failure(apiFetch('/api/board'))
    expect(e).toBeInstanceOf(ApiError)
    expect(isUnreachable(e)).toBe(true)
    expect(e.status).toBe(0)
  })

  it('a timeout counts as unreachable, but the caller aborting its own request stays an abort', async () => {
    vi.stubGlobal('fetch', async () => { throw new DOMException('timed out', 'TimeoutError') })
    expect(isUnreachable(await failure(apiFetch('/api/board')))).toBe(true)

    const ctl = new AbortController()
    vi.stubGlobal('fetch', async () => { ctl.abort(); throw new DOMException('aborted', 'AbortError') })
    const e = await failure(apiFetch('/api/board', { signal: ctl.signal }))
    expect(e.name).toBe('AbortError')
    expect(isUnreachable(e)).toBe(false)
  })

  it('a gateway page is unreachable, but the status code is kept so the sync queue still files it as a server problem', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }))
    const e = await failure(apiFetch('/api/board'))
    expect(isUnreachable(e)).toBe(true)
    expect(e.status).toBe(502)
    expect(classifyError(e)).toBe('server')
  })

  it('the queue still files a thrown fetch as a network problem', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    expect(classifyError(await failure(apiFetch('/api/events/batch')))).toBe('network')
  })

  it("the app's own JSON error is a server answer, not an outage", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'internal', message: 'Something broke.' } }), { status: 500 }))
    const e = await failure(apiFetch('/api/board'))
    expect(isUnreachable(e)).toBe(false)
    expect(e.message).toBe('Something broke.')
  })

  it('a picture that cannot be fetched is also unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    expect(isUnreachable(await failure(apiBlob('/api/photos/x')))).toBe(true)
  })
})

describe('the one card', () => {
  const page = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
  const card = (src: string) => /<LoadFailed.*?\/>/.exec(src)?.[0] ?? ''

  it('every screen that fetches shows it, and the supervisor screens also say the saved work is safe', () => {
    for (const p of ['pages/Board.tsx', 'pages/OrderDetail.tsx', 'pages/OrderSetup.tsx', 'pages/Review.tsx', 'pages/Today.tsx', 'pages/Update.tsx', 'pages/Buyer.tsx']) expect(page(p), p).toContain('<LoadFailed')
    for (const p of ['pages/Today.tsx', 'pages/Update.tsx']) expect(card(page(p)), p).toContain('workSafe')
    for (const p of ['pages/Board.tsx', 'pages/Review.tsx']) expect(card(page(p)), p).not.toContain('workSafe')
  })

  it('a buyer is never sent to the internal status page', () => {
    expect(card(page('pages/Buyer.tsx'))).toContain('statusLink={false}')
  })
})

describe('the words', () => {
  it('Tamil exists for each, and the sentences say what the issue asks', () => {
    expect(strings.en['err.cantReach']).toBe("Can't reach the server. Check the connection and try again.")
    expect(strings.en['err.workSafe']).toMatch(/saved on this phone is safe/)
    for (const k of ['err.cantReach', 'err.workSafe', 'err.retry', 'err.checkStatus'] as const) expect(strings.ta[k], k).toBeTruthy()
  })
})
