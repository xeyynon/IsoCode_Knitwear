import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { csp } from '../../../scripts/csp.mjs'

// FE-X-07 (final bug cycle): the app had no Content-Security-Policy, while a 30-day sign-in token sits in the browser's storage. A policy
// is only safe to ship if it is tested against the real screens: this file pins its shape, and `npm run e2e` runs the whole supervisor
// flow under it (a violation is logged as a console error and fails the run).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(name + ' ')) ?? ''

describe('FE-X-07: the policy', () => {
  const hosted = csp()
  it('allows scripts from the app itself only: no inline script, no eval, no other site', () => {
    expect(directive(hosted, 'script-src')).toBe("script-src 'self'")
    expect(hosted).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|https?:\/\/[a-z]/i)
  })
  it('keeps the rest closed: objects, base address, form targets, framing', () => {
    expect(hosted).toContain("object-src 'none'")
    expect(hosted).toContain("base-uri 'self'")
    expect(hosted).toContain("form-action 'self'")
    expect(hosted).toContain("frame-ancestors 'none'")
    expect(hosted).toContain("default-src 'self'")
  })
  it('lets a photo be shown from the browser (blob) and the API be the same address', () => {
    expect(directive(hosted, 'img-src')).toContain('blob:')
    expect(directive(hosted, 'connect-src')).toBe("connect-src 'self'")
  })
  it('only the local preview may also reach an API on localhost, never the hosted build', () => {
    expect(directive(csp({ localApi: true }), 'connect-src')).toContain('http://127.0.0.1:*')
    expect(hosted).not.toContain('127.0.0.1')
    expect(hosted).not.toContain('localhost')
  })
})

describe('FE-X-07: where it is sent', () => {
  it('the hosted build sends it on every response, with the other security headers', () => {
    const build = read('../../../scripts/vercel_build.mjs')
    expect(build).toContain("import { csp } from './csp.mjs'")
    expect(build).toMatch(/'content-security-policy':\s*csp\(\)/)
  })
  it('the preview server used by the browser tests sends the same policy, so it is enforced while tests run', () => {
    const config = read('../vite.config.ts')
    expect(config).toMatch(/preview:\s*\{[^}]*Content-Security-Policy[^}]*csp\(\{ localApi: true \}\)/)
  })
  it('index.html holds nothing the policy would block: no inline script, no event-handler attributes', () => {
    const html = read('../index.html').replace(/<!--[\s\S]*?-->/g, '')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  })
})
