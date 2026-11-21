import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLatestYml, bumpDateVersion, checkReleasePreflight, promoteChangelog } from '../tools/release-helpers.mjs'

test('bumpDateVersion increments n when current version is in the same year and month', () => {
  const nov2026 = new Date(2026, 10, 21) // month is 0-indexed -> 11
  assert.equal(bumpDateVersion('26.11.1', nov2026), '26.11.2')
  assert.equal(bumpDateVersion('26.11.9', nov2026), '26.11.10')
})

test('bumpDateVersion resets to <yy>.<m>.1 when month or year advances', () => {
  const dec2026 = new Date(2026, 11, 1)
  const jan2027 = new Date(2027, 0, 5)
  assert.equal(bumpDateVersion('26.11.4', dec2026), '26.12.1')
  assert.equal(bumpDateVersion('26.12.2', jan2027), '27.1.1')
  assert.equal(bumpDateVersion('0.1.0', dec2026), '26.12.1')
})

test('promoteChangelog moves Unreleased notes under the new version heading and keeps earlier entries', () => {
  const input = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    '- Added auto-update support.',
    '- Fixed Google sign-in.',
    '',
    '## 26.11.1 — 2026-11-21',
    '',
    '- Initial Dev release.',
    ''
  ].join('\n')

  const res = promoteChangelog(input, '26.11.2', '2026-11-22')
  assert.equal(res.wasEmpty, false)
  assert.equal(res.notes, '- Added auto-update support.\n- Fixed Google sign-in.')
  assert.equal(
    res.markdown,
    [
      '# Changelog',
      '',
      '## Unreleased',
      '',
      '## 26.11.2 — 2026-11-22',
      '',
      '- Added auto-update support.',
      '- Fixed Google sign-in.',
      '',
      '## 26.11.1 — 2026-11-21',
      '',
      '- Initial Dev release.',
      ''
    ].join('\n')
  )
})

test('promoteChangelog detects empty Unreleased section and rejects missing heading', () => {
  const empty = '# Changelog\n\n## Unreleased\n\n## 26.11.1 — 2026-11-21\n\n- First.\n'
  const res = promoteChangelog(empty, '26.11.2', '2026-11-22')
  assert.equal(res.wasEmpty, true)
  assert.equal(res.notes, '')
  assert.ok(res.markdown.includes('## 26.11.2 — 2026-11-22'))

  assert.throws(() => promoteChangelog('# Changelog\n\n## 26.11.1\n- First.\n', '26.11.2', '2026-11-22'), /Unreleased/)
})

test('checkReleasePreflight requires main branch and clean working tree', () => {
  assert.deepEqual(checkReleasePreflight({ branch: 'main', statusPorcelain: '' }), { ok: true, errors: [] })
  const wrongBranch = checkReleasePreflight({ branch: 'feat/updates-compat', statusPorcelain: '' })
  assert.equal(wrongBranch.ok, false)
  assert.equal(wrongBranch.errors.length, 1)

  const dirty = checkReleasePreflight({ branch: 'main', statusPorcelain: ' M package.json\n' })
  assert.equal(dirty.ok, false)
  assert.equal(dirty.errors.length, 1)
})

test('buildLatestYml formats expected electron-updater manifest fields', () => {
  const yml = buildLatestYml({
    version: '26.11.2',
    fileName: 'Veyra-Orbit-Dev-Setup-26.11.2.exe',
    sha512: 'abc123==',
    size: 98765432,
    releaseDate: '2026-11-21T12:00:00.000Z'
  })
  assert.ok(yml.includes('version: 26.11.2'))
  assert.ok(yml.includes('url: Veyra-Orbit-Dev-Setup-26.11.2.exe'))
  assert.ok(yml.includes('sha512: abc123=='))
  assert.ok(yml.includes('size: 98765432'))
  assert.ok(yml.includes("releaseDate: '2026-11-21T12:00:00.000Z'"))
})
