import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCompatRequestHeaders,
  buildChromeIdentity,
  isGoogleAuthUrl,
  WEBAUTHN_CONDITIONAL_SHIM
} from '../src/shared/compat.ts'

test('buildChromeIdentity produces consistent Chrome UA, Firefox UA, and Client Hints', () => {
  const win = buildChromeIdentity({ chromeVersion: '156.0.8078.96', platform: 'win32', arch: 'x64', osRelease: '10.0.26300' })
  assert.equal(win.major, '156')
  assert.equal(win.platform, 'Windows')
  assert.equal(win.platformVersion, '19.0.0')
  assert.equal(win.architecture, 'x86')
  assert.equal(win.bitness, '64')
  assert.ok(win.userAgent.includes('Chrome/156.0.0.0'))
  assert.equal(win.userAgent.includes('Electron'), false)
  assert.ok(win.firefoxUserAgent.includes('Firefox/'))
  assert.ok(win.secChUa.includes('"Google Chrome";v="156"'))
  assert.ok(win.secChUa.includes('"Chromium";v="156"'))
  assert.ok(win.secChUaFullVersionList.includes('"Google Chrome";v="156.0.8078.96"'))

  const macArm = buildChromeIdentity({ chromeVersion: '140.0.1.2', platform: 'darwin', arch: 'arm64' })
  assert.equal(macArm.platform, 'macOS')
  assert.equal(macArm.architecture, 'arm')
  assert.equal(macArm.bitness, '64')
  assert.ok(macArm.userAgent.includes('Macintosh'))
  assert.ok(macArm.firefoxUserAgent.includes('Macintosh'))
})

test('isGoogleAuthUrl matches only accounts.google.com over http(s)', () => {
  assert.equal(isGoogleAuthUrl('https://accounts.google.com/v3/signin/identifier'), true)
  assert.equal(isGoogleAuthUrl('https://ACCOUNTS.GOOGLE.COM/ServiceLogin'), true)
  assert.equal(isGoogleAuthUrl('https://docs.google.com/'), false)
  assert.equal(isGoogleAuthUrl('https://mail.google.com/'), false)
  assert.equal(isGoogleAuthUrl('https://accounts.google.com.evil.example/'), false)
  assert.equal(isGoogleAuthUrl('file:///accounts.google.com'), false)
  assert.equal(isGoogleAuthUrl('not a url'), false)
})

test('applyCompatRequestHeaders uses Firefox UA and strips Sec-CH-UA* only for accounts.google.com', () => {
  const id = buildChromeIdentity({ chromeVersion: '156.0.8078.96', platform: 'win32', arch: 'x64', osRelease: '10.0.26300' })

  const googleHeaders = applyCompatRequestHeaders(
    'https://accounts.google.com/v3/signin/identifier',
    {
      'User-Agent': id.userAgent,
      'Sec-CH-UA': '"Not:A-Brand";v="8", "Chromium";v="156"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-CH-UA-Full-Version-List': '"Chromium";v="156.0.8078.96"',
      Accept: 'text/html'
    },
    id
  )
  assert.equal(googleHeaders['User-Agent'], id.firefoxUserAgent)
  assert.equal('Sec-CH-UA' in googleHeaders, false)
  assert.equal('Sec-CH-UA-Mobile' in googleHeaders, false)
  assert.equal('Sec-CH-UA-Platform' in googleHeaders, false)
  assert.equal('Sec-CH-UA-Full-Version-List' in googleHeaders, false)
  assert.equal(googleHeaders.Accept, 'text/html')

  const otherHeaders = applyCompatRequestHeaders(
    'https://github.com/login',
    {
      'User-Agent': id.userAgent,
      'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156"',
      'sec-ch-ua-full-version-list': '"Chromium";v="156.0.8078.96"',
      'sec-ch-ua-platform': '"Windows"'
    },
    id
  )
  assert.equal(otherHeaders['User-Agent'], id.userAgent)
  assert.equal(otherHeaders['sec-ch-ua'], id.secChUa)
  assert.equal(otherHeaders['sec-ch-ua-full-version-list'], id.secChUaFullVersionList)
  assert.equal(otherHeaders['sec-ch-ua-platform'], '"Windows"')
})

test('WEBAUTHN_CONDITIONAL_SHIM disables conditional mediation while keeping explicit credentials.get', async () => {
  const origPkc = (globalThis as Record<string, unknown>).PublicKeyCredential
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let nativeGetCalls = 0
  const fakeCreds = {
    get: async (opts: unknown) => {
      nativeGetCalls++
      return { ok: true, opts }
    }
  }
  const fakePkc = {
    isConditionalMediationAvailable: async () => true,
    getClientCapabilities: async () => ({ conditionalGet: true, conditionalCreate: true, userVerifyingPlatformAuthenticator: true })
  }
  Object.defineProperty(globalThis, 'PublicKeyCredential', { value: fakePkc, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'navigator', { value: { credentials: fakeCreds }, configurable: true })

  try {
    ;(0, eval)(WEBAUTHN_CONDITIONAL_SHIM)
    assert.equal(await fakePkc.isConditionalMediationAvailable(), false)
    const caps = await fakePkc.getClientCapabilities()
    assert.equal(caps.conditionalGet, false)
    assert.equal(caps.conditionalCreate, false)
    assert.equal(caps.userVerifyingPlatformAuthenticator, true)

    await assert.rejects(
      () => fakeCreds.get({ mediation: 'conditional', publicKey: {} }),
      (err: unknown) => err instanceof DOMException && err.name === 'NotAllowedError'
    )
    assert.equal(nativeGetCalls, 0)

    const explicit = await fakeCreds.get({ mediation: 'optional', publicKey: {} })
    assert.deepEqual(explicit, { ok: true, opts: { mediation: 'optional', publicKey: {} } })
    assert.equal(nativeGetCalls, 1)
  } finally {
    if (origPkc === undefined) delete (globalThis as Record<string, unknown>).PublicKeyCredential
    else Object.defineProperty(globalThis, 'PublicKeyCredential', { value: origPkc, configurable: true, writable: true })
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav)
  }
})
