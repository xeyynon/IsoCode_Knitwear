// Bug round 2: BE-069, S3_ENDPOINT may point at the cloud metadata address or an IPv6 link-local address.
import { describe, expect, it } from 'vitest'
import { MediaConfigError, s3ConfigFromEnv } from '../src/mediaFromEnv.js'

const ENV = { S3_BUCKET: 'acme-photos-mumbai', S3_REGION: 'ap-south-1', S3_ACCESS_KEY_ID: 'AKIAFAKEKEYID', S3_SECRET_ACCESS_KEY: 'fake-secret-do-not-print' }
const refused = (endpoint: string): Error | undefined => { try { s3ConfigFromEnv({ ...ENV, S3_ENDPOINT: endpoint }) } catch (e) { return e as Error } return undefined }

describe('BE-069: S3_ENDPOINT never points at a link-local address (the cloud metadata service lives there)', () => {
  it.each([
    'https://169.254.169.254', 'http://169.254.169.254', 'https://169.254.0.1:9000', 'https://169.254.255.255',
    'https://2852039166',                // the same address written as one number: the URL parser turns it into 169.254.169.254
    'https://0xa9fea9fe', 'https://0251.0376.0251.0376',
    'https://[fe80::1]', 'https://[fe80::a00:27ff:fe4e:66a1]:9000', 'https://[febf::1]', 'https://[fe90::1]',
    'https://[::ffff:169.254.169.254]',  // IPv4 inside IPv6
    'https://[fd00:ec2::254]',           // the AWS metadata address over IPv6
    'https://metadata.google.internal',
  ])('BE-069: %s is refused with a plain message that names S3_ENDPOINT and not the value', (endpoint) => {
    const err = refused(endpoint)
    expect(err).toBeInstanceOf(MediaConfigError)
    expect(err!.message).toContain('S3_ENDPOINT')
    expect(err!.message).not.toContain('169.254')
    expect(err!.message).not.toContain('fe80')
  })

  it('BE-069: ordinary endpoints stay allowed, including a private LAN address and localhost over http', () => {
    for (const ok of [
      'https://abc.r2.cloudflarestorage.com', 'https://s3.ap-south-1.amazonaws.com', 'http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000',
      'https://10.0.0.5:9000', 'https://192.168.1.20', 'https://172.16.4.4:9000', 'https://169.253.1.1', 'https://169.255.1.1', 'https://[2001:db8::1]', 'https://[fec0::1]',
    ]) expect(refused(ok), ok).toBeUndefined()
  })
})
