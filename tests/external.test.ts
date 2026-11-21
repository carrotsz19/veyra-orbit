import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isExternalAppUrl, isSafeSubframeUrl, parseExternalAppUrl } from '../src/shared/external.ts'

test('allowlisted external app schemes parse cleanly', () => {
  const cases: [string, string, string][] = [
    ['mailto:teacher@school.edu?subject=Essay', 'mailto', 'Mail'],
    ['MAILTO:upper@example.com', 'mailto', 'Mail'],
    ['tel:+15551234567', 'tel', 'Phone'],
    ['sms:+15551234567', 'sms', 'Messages'],
    ['zoommtg://zoom.us/join?confno=123456', 'zoommtg', 'Zoom'],
    ['zoomus://zoom.us/join?confno=123456', 'zoomus', 'Zoom'],
    ['msteams:/l/meetup-join/19%3ameeting', 'msteams', 'Microsoft Teams'],
    ['slack://open?team=T123', 'slack', 'Slack'],
    ['discord://-/channels/1/2', 'discord', 'Discord'],
    ['spotify:track:4cOdK2wGLETKBW3PvgPWqT', 'spotify', 'Spotify'],
    ['facetime://alice@example.com', 'facetime', 'FaceTime'],
    ['webcal://calendar.example.com/schedule.ics', 'webcal', 'Calendar']
  ]
  for (const [input, scheme, appName] of cases) {
    const parsed = parseExternalAppUrl(input)
    assert.ok(parsed, input)
    assert.equal(parsed.scheme, scheme, input)
    assert.equal(parsed.appName, appName, input)
    assert.equal(isExternalAppUrl(input), true, input)
  }
})

test('dangerous and non-allowlisted schemes are always blocked', () => {
  const blocked = [
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ms-msdt:/id%20PCWDiagnostic',
    'search-ms:query=passwords',
    'ms-officecmd:ofv|u|https://evil.test/x.docx',
    'ms-appinstaller:?source=https://evil.test/a.msix',
    'shell:MyComputerFolder',
    'cmd:whoami',
    'powershell:calc',
    'chrome://settings',
    'orbit://settings',
    'about:blank',
    'https://example.com',
    'http://localhost:3000',
    'ftp://example.com/file',
    'custom-unknown-app://launch'
  ]
  for (const url of blocked) {
    assert.equal(parseExternalAppUrl(url), null, url)
    assert.equal(isExternalAppUrl(url), false, url)
  }
})

test('control characters, empty strings, and oversized URLs are rejected', () => {
  assert.equal(parseExternalAppUrl(''), null)
  assert.equal(parseExternalAppUrl('   '), null)
  assert.equal(parseExternalAppUrl('mailto:a@b.com\r\nbcc:evil@x.com'), null)
  assert.equal(parseExternalAppUrl('mailto:a@b.com\x00evil'), null)
  assert.equal(parseExternalAppUrl('zoommtg://zoom.us/' + 'a'.repeat(5000)), null)
})

test('isSafeSubframeUrl permits web subframes and blocks OS protocol handlers', () => {
  for (const ok of ['https://example.com/frame', 'http://localhost:8080/x', 'about:blank', 'about:srcdoc', 'blob:https://example.com/123', 'data:text/plain,hi']) {
    assert.equal(isSafeSubframeUrl(ok), true, ok)
  }
  for (const bad of ['file:///C:/x', 'ms-msdt:/id%20PCWDiagnostic', 'mailto:a@b.com', 'zoommtg://zoom.us/join', 'orbit://settings', 'chrome://settings']) {
    assert.equal(isSafeSubframeUrl(bad), false, bad)
  }
})

test('the built-in PDF viewer may draw in a frame; no other extension may', () => {
  assert.equal(isSafeSubframeUrl('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'), true)
  assert.equal(isSafeSubframeUrl('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html'), false)
  assert.equal(isSafeSubframeUrl('chrome://settings'), false)
})
