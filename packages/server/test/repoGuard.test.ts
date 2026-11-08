import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ROOT, git, removeDirs, run, scriptIn, scriptRepo, write } from './scriptHelpers'

// Worker photos land in MEDIA_DIR (./media in .env.example). They are real worker data and the repo is
// public, so .gitignore must hide them and scripts/check_repo.mjs must refuse them if they are added anyway.
const dirs: string[] = []
let dir = ''
afterEach(() => { removeDirs(dirs); dir = '' })

function scratchRepo() {
  dir = scriptRepo(dirs, 'repoguard')
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'))
  return dir
}
function put(rel: string) {
  write(dir, rel, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))
}
const ignored = (rel: string) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status === 0
const check = (env: Record<string, string> = {}) => run(scriptIn(dir, 'check_repo.mjs'), dir, [], env)

describe('repo guards keep worker photos out of git', () => {
  it('.gitignore hides photos under media/ and uploads/', () => {
    scratchRepo()
    expect(ignored('packages/server/media/ab/x.jpg')).toBe(true)
    expect(ignored('packages/server/uploads/x.jpg')).toBe(true)
  })

  it.each(['packages/server/media/ab/x.jpg', 'packages/server/uploads/x.jpg'])('check_repo refuses %s once added', (rel) => {
    scratchRepo()
    put(rel)
    git(dir, 'add', '-f', rel)
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${rel}: must not be tracked`)
  })

  it('check_repo still passes a clean repo', () => {
    scratchRepo()
    put('packages/web/public/icon.png')
    expect(check().status).toBe(0)
  })

  // BE-054: .gitignore protects these two private paths; check_repo must refuse them too if someone uses git add -f.
  it.each(['md/budget.md', 'company-a-build-plan.md'])('BE-054: check_repo refuses %s once force-added', (rel) => {
    scratchRepo()
    write(dir, rel, 'private planning notes\n')
    expect(ignored(rel)).toBe(true)
    git(dir, 'add', '-f', rel)
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${rel}: must not be tracked`)
  })

  it('BE-054: a folder called md deeper in the tree, such as docs/md/, is not the private one', () => {
    scratchRepo()
    write(dir, 'docs/md/notes.md', 'fine\n')
    expect(check().status).toBe(0)
  })
})

// Keys are split in two so this file never looks like a key itself.
const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP'
const TOKENS: [string, string][] = [
  ['.npmrc', `//registry.npmjs.org/:_authToken=npm_${'a1B2c3D4e5'.repeat(3)}abcdef\n`],
  ['deploy.sh', `export AWS_KEY=${AWS}\n`],
  ['notes.ps1', `$k = '${AWS}'\n`],
  ['config.cjs', `module.exports = '${AWS}'\n`],
  ['tool.mts', `export const k = '${AWS}'\n`],
  ['Dockerfile', `ENV KEY=${AWS}\n`],
  ['gh.txt', `token=github_pat_${'A1b2C3d4E5'.repeat(3)}_xyz\n`],
  ['stripe.txt', `key=sk_live_${'A1b2C3d4E5'.repeat(2)}\n`],
]

describe('check_repo reads every text file for key-shaped strings', () => {
  it.each(TOKENS)('refuses a key in %s', (rel, body) => {
    scratchRepo()
    fs.writeFileSync(path.join(dir, rel), body)
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`FAIL ${rel}: looks like a`)
  })
})

// BE-048: git quotes a file name with non-ASCII characters ("caf\303\251.txt") unless it is asked not to, so the
// quoted name matched no path rule and fs could not find it to read it: a key in such a file passed the guard.
describe('BE-048: file names with non-ASCII characters are checked like any other', () => {
  const PEM = '-----BEGIN RSA ' + 'PRIVATE KEY-----\nabc\n'

  it.each(['தமிழ்.pem', 'clé.key'])('BE-048: a forbidden file with the name %s is refused once force-added', (name) => {
    scratchRepo()
    write(dir, name, 'x')
    git(dir, 'add', '-f', name)
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${name}: must not be tracked`)
  })

  it('BE-048: a key inside a file with an accented name is found, new or added', () => {
    scratchRepo()
    write(dir, 'café.txt', `export AWS_KEY=${AWS}\n`)
    write(dir, 'தமிழ்/குறிப்பு.txt', PEM)
    let r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('FAIL café.txt: looks like a')
    expect(r.stderr).toContain('FAIL தமிழ்/குறிப்பு.txt: looks like a private key')
    git(dir, 'add', '-A')
    r = check()
    expect(r.stderr).toContain('FAIL café.txt: looks like a')
  })

  it('BE-048: a banned term in a non-ASCII file name is found', () => {
    scratchRepo()
    write(dir, 'acme-தமிழ்.txt', 'fine\n')
    const r = check({ BANNED_TERMS: 'acme' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('acme-தமிழ்.txt: file name contains a banned term')
  })

  it('BE-048: an ordinary Tamil-named file is still fine', () => {
    scratchRepo()
    write(dir, 'குறிப்பு.txt', 'plain words\n')
    const r = check()
    expect(r.status, r.stderr).toBe(0)
  })
})

// BE-049: the guard knew other people's key shapes but not this project's own: a database URL with a password,
// TOKEN_SECRET / S3_SECRET_ACCESS_KEY values and a signed token. Placeholders (CHANGE_ME, postgres:postgres in
// CI, the fake values in tests) must keep passing.
describe("BE-049: the project's own secret shapes are caught, its placeholders are not", () => {
  const real = [
    ['a database URL with a password', 'DATABASE_URL=' + 'postgres://owner:Xk29sLq81vZ' + '@db.prod.example.com:5432/orders\n'],
    ['a postgresql:// URL in quotes', 'const url = "' + 'postgresql://app_user:q7Hn4Vd2Rt9' + '@10.0.0.5/orders"\n'],
    ['TOKEN_SECRET with a value', 'TOKEN_SECRET=' + '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c\n'],
    ['S3_SECRET_ACCESS_KEY with a value', 'S3_SECRET_ACCESS_KEY=' + 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'],
    ['a quoted PASSWORD in an env file', 'DB_PASSWORD: "' + 'Zq81vXk29sL7' + '"\n'],
    ['a signed token (JWT)', 'tok=' + 'eyJhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc\n'],
  ] as const

  it.each(real)('BE-049: refuses %s', (_label, body) => {
    scratchRepo()
    write(dir, 'deploy-notes.txt', body)
    const r = check()
    expect(r.status, r.stdout).toBe(1)
    expect(r.stderr).toContain('FAIL deploy-notes.txt: looks like a')
  })

  it('BE-049: the placeholders the repo itself uses still pass', () => {
    scratchRepo()
    write(dir, 'packages/server/.env.example', fs.readFileSync(path.join(ROOT, 'packages/server/.env.example'), 'utf8'))
    write(dir, '.github/workflows/ci.yml', fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'))
    write(dir, 'notes.md', [
      'Run DATABASE_URL=postgres://owner:...@host/db npm run migrate',
      'url: postgres://postgres:postgres@localhost:5432/postgres',
      'postgres://u:hunter2@localhost:1/x and postgresql://u:p@host/db',
      "const APP_USER_PASSWORD = 'app_user_test_only'",
      "S3_SECRET_ACCESS_KEY: 'fake-secret-do-not-print'",
      'TOKEN_SECRET=CHANGE_ME_to_at_least_32_random_characters',
      'TOKEN_SECRET = process.env.TOKEN_SECRET',
      'postgres://${USER}:${PASSWORD}@host/db and postgres://<user>:<password>@host/db',
    ].join('\n') + '\n')
    const r = check()
    expect(r.status, r.stderr).toBe(0)
  })
})

// BE-062 (part): where BANNED_TERMS is required, an empty one is a failure, not a quiet pass.
describe('BE-062: the banned-terms guard can be made to fail loudly', () => {
  it('REQUIRE_BANNED_TERMS=1 with no terms fails and says why', () => {
    scratchRepo()
    const r = check({ REQUIRE_BANNED_TERMS: '1' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('BANNED_TERMS')
    expect(r.stderr).toContain('REQUIRE_BANNED_TERMS')
  })

  it('REQUIRE_BANNED_TERMS=1 with terms set passes, and unset it still passes without terms', () => {
    scratchRepo()
    expect(check({ REQUIRE_BANNED_TERMS: '1', BANNED_TERMS: 'zzzz' }).status).toBe(0)
    expect(check().status).toBe(0)
    expect(check({ REQUIRE_BANNED_TERMS: '0' }).status).toBe(0)
  })

  it('on GitHub Actions with no terms and none required it warns on the log instead of saying nothing', () => {
    scratchRepo()
    const r = check({ GITHUB_ACTIONS: 'true' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('::warning::')
  })
})
