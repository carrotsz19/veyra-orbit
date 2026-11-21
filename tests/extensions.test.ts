import test from 'node:test'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import {
  canAccessCookiesForUrl,
  describeManifestPermissions,
  extractExtensionId,
  filterCookiesByHostPermissions,
  isAllowedExtensionTabUrl,
  isAllowedWebStoreOrigin,
  isCookiePermittedByHostPermissions,
  isSafeZipEntryPath,
  isUrlPermittedByHostPermissions,
  matchHostPattern,
  resolveAllowedExtensionTabUrl,
  sanitizeExtensionsRegistry,
  shouldAttachExtensionsNow,
  shouldLoadExtensionsForPartition,
  validateExtensionId
} from '../src/shared/extensions.ts'
import {
  buildCrx3Buffer,
  deriveExtensionIdFromPublicKey,
  parseAndVerifyCrx3
} from '../src/shared/crx3.ts'

const UBOL_ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh'
const BITWARDEN_ID = 'nngceckbapebfimnlniiiahkandclblb'

test('validateExtensionId and extractExtensionId', () => {
  assert.equal(validateExtensionId(UBOL_ID), true)
  assert.equal(validateExtensionId(BITWARDEN_ID), true)
  assert.equal(validateExtensionId('short'), false)
  assert.equal(validateExtensionId('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'), false)
  assert.equal(validateExtensionId('DDKJIAHEJLHFCAFBDDMGIAHCPHECMPFH'), false)

  assert.equal(extractExtensionId(UBOL_ID), UBOL_ID)
  assert.equal(
    extractExtensionId(`https://chromewebstore.google.com/detail/ublock-origin-lite/${UBOL_ID}`),
    UBOL_ID
  )
  assert.equal(
    extractExtensionId(`https://chromewebstore.google.com/detail/${BITWARDEN_ID}?hl=en`),
    BITWARDEN_ID
  )
  assert.equal(
    extractExtensionId(`https://chromewebstore.google.com.evil.test/detail/${UBOL_ID}`),
    null
  )
  assert.equal(extractExtensionId('https://example.com/foo'), null)
})

test('strict Chrome Web Store origin check rejects lookalike hosts', () => {
  assert.equal(isAllowedWebStoreOrigin('https://chromewebstore.google.com'), true)
  assert.equal(isAllowedWebStoreOrigin('https://chromewebstore.google.com/'), true)
  assert.equal(isAllowedWebStoreOrigin('https://chromewebstore.google.com.attacker.test'), false)
  assert.equal(isAllowedWebStoreOrigin('https://chromewebstore.google.com:8443'), false)
  assert.equal(isAllowedWebStoreOrigin('http://chromewebstore.google.com'), false)
  assert.equal(isAllowedWebStoreOrigin('https://chromewebstore.google.com/detail/foo'), false)
  assert.equal(isAllowedWebStoreOrigin(''), false)
  assert.equal(isAllowedWebStoreOrigin(null), false)
})

test('extension tab/window URL guard allows only http(s) and same-extension chrome-extension://', () => {
  assert.equal(isAllowedExtensionTabUrl('https://example.com/page', UBOL_ID), true)
  assert.equal(isAllowedExtensionTabUrl('http://localhost:3000/test', UBOL_ID), true)
  assert.equal(isAllowedExtensionTabUrl(`chrome-extension://${UBOL_ID}/dashboard.html`, UBOL_ID), true)
  assert.equal(isAllowedExtensionTabUrl('dashboard.html', UBOL_ID), true)
  assert.equal(
    resolveAllowedExtensionTabUrl('popup.html#settings', UBOL_ID),
    `chrome-extension://${UBOL_ID}/popup.html#settings`
  )

  // Must reject other extensions' chrome-extension:// pages
  assert.equal(isAllowedExtensionTabUrl(`chrome-extension://${BITWARDEN_ID}/popup.html`, UBOL_ID), false)

  // Must reject dangerous / internal schemes
  assert.equal(isAllowedExtensionTabUrl('file:///C:/Windows/win.ini', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('data:text/html,<script>alert(1)</script>', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('javascript:alert(1)', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('orbit://settings', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('orbit://history', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('chrome://settings', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('chrome://extensions', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('about:blank', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('mailto:user@example.com', UBOL_ID), false)
  assert.equal(isAllowedExtensionTabUrl('', UBOL_ID), false)
})

test('cookies permission and host-permission enforcement', () => {
  const noPerm = { permissions: [], host_permissions: [] }
  const cookiesNoHost = { permissions: ['cookies'], host_permissions: [] }
  const hostNoCookies = { permissions: [], host_permissions: ['https://example.com/*'] }
  const narrowCookies = {
    permissions: ['cookies'],
    host_permissions: ['https://*.example.com/*']
  }
  const allCookies = {
    permissions: ['cookies'],
    host_permissions: ['<all_urls>']
  }

  assert.equal(canAccessCookiesForUrl(noPerm, 'https://example.com/'), false)
  assert.equal(canAccessCookiesForUrl(cookiesNoHost, 'https://example.com/'), false)
  assert.equal(canAccessCookiesForUrl(hostNoCookies, 'https://example.com/'), false)
  assert.equal(canAccessCookiesForUrl(narrowCookies, 'https://app.example.com/'), true)
  assert.equal(canAccessCookiesForUrl(narrowCookies, 'https://example.com/'), true)
  assert.equal(canAccessCookiesForUrl(narrowCookies, 'https://other.org/'), false)
  assert.equal(canAccessCookiesForUrl(narrowCookies, 'http://example.com/'), false)
  assert.equal(canAccessCookiesForUrl(allCookies, 'https://other.org/'), true)

  assert.equal(matchHostPattern('*://*.github.com/*', 'https://gist.github.com/a'), true)
  assert.equal(matchHostPattern('*://*.github.com/*', 'https://evilgithub.com/a'), false)
  assert.equal(isUrlPermittedByHostPermissions('file:///etc/passwd', ['<all_urls>']), false)

  const cookies = [
    { domain: '.example.com', path: '/', secure: true, name: 'a' },
    { domain: 'sub.example.com', path: '/app', secure: true, name: 'b' },
    { domain: 'secret.bank.test', path: '/', secure: true, name: 'c' }
  ]
  assert.deepEqual(
    filterCookiesByHostPermissions(cookies, ['https://*.example.com/*']).map((c) => c.name),
    ['a', 'b']
  )
  assert.deepEqual(filterCookiesByHostPermissions(cookies, []), [])
  assert.equal(
    isCookiePermittedByHostPermissions({ domain: 'example.com', path: '/', secure: false }, ['http://example.com/*']),
    true
  )
  assert.equal(
    isCookiePermittedByHostPermissions({ domain: 'example.com', path: '/', secure: true }, ['http://example.com/*']),
    false
  )
})

test('plain-English permission descriptions', () => {
  const details = describeManifestPermissions({
    permissions: ['history', 'cookies', 'storage', 'tabs', 'notifications', 'declarativeNetRequest'],
    host_permissions: ['<all_urls>']
  })
  const labels = details.map((d) => d.label)
  assert.ok(labels.includes('Read and change all your data on all websites'))
  assert.ok(labels.includes('Read your browsing history'))
  assert.ok(labels.includes('Read and change your cookies on allowed websites'))
  assert.ok(labels.includes('Read your open tabs and website addresses'))
  assert.ok(labels.includes('Block or modify network requests on websites'))
  assert.ok(labels.includes('Store settings and data locally in Orbit'))
  // High-risk items come before low-risk items
  assert.equal(details[0].risk, 'high')
  assert.equal(details[details.length - 1].risk, 'low')

  const narrow = describeManifestPermissions({
    permissions: ['storage'],
    host_permissions: ['https://*.wikipedia.org/*']
  })
  assert.ok(narrow.some((d) => d.label === 'Read and change your data on wikipedia.org'))
})

test('partition and lazy-load rules exclude private workspaces and defer isolated workspaces', () => {
  assert.equal(shouldLoadExtensionsForPartition('persist:web'), true)
  assert.equal(shouldLoadExtensionsForPartition('persist:ws-study'), true)
  assert.equal(shouldLoadExtensionsForPartition('private-ws-private-1'), false)
  assert.equal(shouldLoadExtensionsForPartition(''), false)
  assert.equal(shouldLoadExtensionsForPartition('persist:other'), false)

  const activated = new Set<string>()
  assert.equal(shouldAttachExtensionsNow('persist:web', activated), true)
  assert.equal(shouldAttachExtensionsNow('persist:ws-study', activated), false)
  assert.equal(shouldAttachExtensionsNow('private-ws-private-1', activated), false)

  activated.add('persist:ws-study')
  assert.equal(shouldAttachExtensionsNow('persist:ws-study', activated), true)

  activated.add('private-ws-private-1')
  assert.equal(shouldAttachExtensionsNow('private-ws-private-1', activated), false)
})

test('CRX3 signature verification accepts valid RSA & ECDSA packages and rejects tampering', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rsaPubDer = rsa.publicKey.export({ type: 'spki', format: 'der' })
  const expectedRsaId = deriveExtensionIdFromPublicKey(rsaPubDer)
  const zipPayload = Buffer.from('PK\x03\x04synthetic-zip-payload')

  const validRsaCrx = buildCrx3Buffer({
    algorithm: 'rsa',
    publicKeyDer: rsaPubDer,
    zipBytes: zipPayload,
    sign: (data) => createSign('SHA256').update(data).sign(rsa.privateKey)
  })

  const parsed = parseAndVerifyCrx3(validRsaCrx, expectedRsaId)
  assert.equal(parsed.extensionId, expectedRsaId)
  assert.deepEqual(Buffer.from(parsed.zipBytes), zipPayload)

  // Tampering with a single byte of the ZIP payload must fail signature verification
  const tamperedZip = Buffer.from(validRsaCrx)
  tamperedZip[tamperedZip.length - 1] ^= 0xff
  assert.throws(() => parseAndVerifyCrx3(tamperedZip, expectedRsaId), /signature verification failed/i)

  // Mismatched expected extension ID must fail
  assert.throws(() => parseAndVerifyCrx3(validRsaCrx, UBOL_ID), /extension ID mismatch/i)

  // CRX2 must be rejected
  const crx2 = Buffer.from(validRsaCrx)
  crx2.writeUInt32LE(2, 4)
  assert.throws(() => parseAndVerifyCrx3(crx2), /CRX3 required/i)

  // Valid ECDSA CRX3 must also verify
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const ecPubDer = ec.publicKey.export({ type: 'spki', format: 'der' })
  const expectedEcId = deriveExtensionIdFromPublicKey(ecPubDer)
  const validEcCrx = buildCrx3Buffer({
    algorithm: 'ecdsa',
    publicKeyDer: ecPubDer,
    zipBytes: zipPayload,
    sign: (data) => createSign('SHA256').update(data).sign(ec.privateKey)
  })
  assert.equal(parseAndVerifyCrx3(validEcCrx, expectedEcId).extensionId, expectedEcId)
})

test('Zip-Slip path guard and registry sanitization', () => {
  assert.equal(isSafeZipEntryPath('manifest.json'), true)
  assert.equal(isSafeZipEntryPath('js/background.js'), true)
  assert.equal(isSafeZipEntryPath('../evil.exe'), false)
  assert.equal(isSafeZipEntryPath('a/../../evil.exe'), false)
  assert.equal(isSafeZipEntryPath('/etc/passwd'), false)
  assert.equal(isSafeZipEntryPath('C:\\Windows\\system.ini'), false)
  assert.equal(isSafeZipEntryPath('a\0b.js'), false)

  const reg = sanitizeExtensionsRegistry({
    developerMode: true,
    extensions: [
      { id: UBOL_ID, source: 'webstore', enabled: true, pinned: true, name: 'uBOL' },
      { id: UBOL_ID, source: 'webstore', enabled: false, pinned: false }, // duplicate dropped
      { id: 'bad-id', source: 'webstore', enabled: true, pinned: false },
      { id: BITWARDEN_ID, source: 'unpacked', enabled: true, pinned: false } // unpacked missing path dropped
    ]
  })
  assert.equal(reg.developerMode, true)
  assert.equal(reg.extensions.length, 1)
  assert.equal(reg.extensions[0].id, UBOL_ID)
  assert.equal(reg.extensions[0].pinned, true)
})
