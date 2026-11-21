import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEV_FEED_TOKEN_FILE,
  DEV_REPO,
  PROD_REPO,
  classifyUpdateError,
  redactSecrets,
  resolveDevFeedToken,
  selectUpdateFeed
} from '../src/shared/updates.ts'

test('resolveDevFeedToken returns empty string in Prod even if env or file has a token', () => {
  let fileRead = false
  const token = resolveDevFeedToken({
    channel: 'prod',
    envToken: 'github_pat_should_not_leak',
    readTokenFile: () => {
      fileRead = true
      return 'github_pat_from_file'
    }
  })
  assert.equal(token, '')
  assert.equal(fileRead, false)
})

test('resolveDevFeedToken prefers env token over token file in Dev builds', () => {
  let readPath: string | null = null
  const token = resolveDevFeedToken({
    channel: 'dev',
    envToken: '  github_pat_env_123  ',
    readTokenFile: (p) => {
      readPath = p
      return 'github_pat_file_456'
    }
  })
  assert.equal(token, 'github_pat_env_123')
  assert.equal(readPath, null)
})

test('resolveDevFeedToken reads default C:/dev/tools/veyra-orbit-dev-feed.token when env is unset', () => {
  let readPath: string | null = null
  const token = resolveDevFeedToken({
    channel: 'dev',
    readTokenFile: (p) => {
      readPath = p
      return '  github_pat_file_456\r\n'
    }
  })
  assert.equal(readPath, DEV_FEED_TOKEN_FILE)
  assert.equal(token, 'github_pat_file_456')
})

test('resolveDevFeedToken returns empty string when token file is missing', () => {
  const token = resolveDevFeedToken({
    channel: 'dev',
    readTokenFile: () => null
  })
  assert.equal(token, '')
})

test('selectUpdateFeed disables updates when unpackaged (npm run dev) or explicitly disabled', () => {
  assert.deepEqual(
    selectUpdateFeed({ channel: 'dev', isPackaged: false, devFeedToken: 'tok' }),
    { enabled: false, reason: 'unpackaged' }
  )
  assert.deepEqual(
    selectUpdateFeed({ channel: 'prod', isPackaged: false }),
    { enabled: false, reason: 'unpackaged' }
  )
  assert.deepEqual(
    selectUpdateFeed({ channel: 'prod', isPackaged: true, disableUpdates: true }),
    { enabled: false, reason: 'disabled' }
  )
})

test('selectUpdateFeed skips Dev builds when no feed token is embedded', () => {
  assert.deepEqual(
    selectUpdateFeed({ channel: 'dev', isPackaged: true, devFeedToken: '' }),
    { enabled: false, reason: 'missing-dev-token' }
  )
  assert.deepEqual(
    selectUpdateFeed({ channel: 'dev', isPackaged: true, devFeedToken: '   ' }),
    { enabled: false, reason: 'missing-dev-token' }
  )
})

test('selectUpdateFeed picks private Dev repo with token for packaged Dev builds', () => {
  assert.deepEqual(
    selectUpdateFeed({ channel: 'dev', isPackaged: true, devFeedToken: 'tok_abc' }),
    {
      enabled: true,
      feed: {
        provider: 'github',
        owner: DEV_REPO.owner,
        repo: DEV_REPO.repo,
        private: true,
        token: 'tok_abc'
      },
      forceDevUpdateConfig: false
    }
  )
})

test('selectUpdateFeed picks public Prod repo with no token for packaged Prod builds', () => {
  assert.deepEqual(
    selectUpdateFeed({ channel: 'prod', isPackaged: true, devFeedToken: 'ignored_in_prod' }),
    {
      enabled: true,
      feed: {
        provider: 'github',
        owner: PROD_REPO.owner,
        repo: PROD_REPO.repo,
        private: false
      },
      forceDevUpdateConfig: false
    }
  )
})

test('selectUpdateFeed supports generic test feed URL override', () => {
  assert.deepEqual(
    selectUpdateFeed({ channel: 'dev', isPackaged: false, testFeedUrl: 'http://127.0.0.1:4123/' }),
    {
      enabled: true,
      feed: { provider: 'generic', url: 'http://127.0.0.1:4123/' },
      forceDevUpdateConfig: true
    }
  )
})

test('classifyUpdateError recognises missing releases so Prod stays quiet before first release', () => {
  assert.equal(classifyUpdateError(new Error('No published versions on GitHub')), 'no-release')
  assert.equal(classifyUpdateError(new Error('HttpError: 404 Not Found')), 'no-release')
  assert.equal(classifyUpdateError({ code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND', message: 'missing' }), 'no-release')
  assert.equal(classifyUpdateError(new Error('Cannot find latest.yml in the latest release artifacts')), 'no-release')
  assert.equal(classifyUpdateError(new Error('getaddrinfo ENOTFOUND api.github.com')), 'network')
  assert.equal(classifyUpdateError(new Error('Unexpected failure')), 'other')
})

test('redactSecrets strips embedded tokens and Authorization headers from log messages', () => {
  const leaked = 'Request failed with Authorization: Bearer secret123 and github_pat_11AAbbCC_xyz token=abc'
  const clean = redactSecrets(leaked, ['secret123'])
  assert.equal(clean.includes('secret123'), false)
  assert.equal(clean.includes('github_pat_11AAbbCC_xyz'), false)
  assert.equal(clean.includes('token=abc'), false)
})
