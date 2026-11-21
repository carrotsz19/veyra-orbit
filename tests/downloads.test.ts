import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, formatSpeed, isRunnable, pickUniqueFilename, sanitizeFilename, splitFilename } from '../src/shared/downloads.ts'

test('splitFilename separates stem and extension cleanly', () => {
  assert.deepEqual(splitFilename('report.pdf'), { stem: 'report', ext: '.pdf' })
  assert.deepEqual(splitFilename('notes.final.docx'), { stem: 'notes.final', ext: '.docx' })
  assert.deepEqual(splitFilename('backup.tar.gz'), { stem: 'backup', ext: '.tar.gz' })
  assert.deepEqual(splitFilename('README'), { stem: 'README', ext: '' })
  assert.deepEqual(splitFilename('.env'), { stem: '.env', ext: '' })
})

test('sanitizeFilename strips traversal, invalid characters, and reserved names', () => {
  assert.equal(sanitizeFilename('../../evil.exe'), 'evil.exe')
  assert.equal(sanitizeFilename('C:\\Windows\\System32\\cmd.exe'), 'cmd.exe')
  assert.equal(sanitizeFilename('hello:world?.txt'), 'hello_world_.txt')
  assert.equal(sanitizeFilename('trailing...  '), 'trailing')
  assert.equal(sanitizeFilename('   '), 'download')
  assert.equal(sanitizeFilename('..'), 'download')
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt')
  assert.equal(sanitizeFilename('nul'), '_nul')

  const long = 'a'.repeat(250) + '.pdf'
  const cleaned = sanitizeFilename(long)
  assert.ok(cleaned.endsWith('.pdf'))
  assert.ok(cleaned.length <= 200)
})

test('pickUniqueFilename appends incrementing counters on collision', () => {
  const taken = new Set(['file.pdf', 'file (1).pdf'])
  const exists = (name: string): boolean => taken.has(name.toLowerCase())

  assert.equal(pickUniqueFilename('other.pdf', exists), 'other.pdf')
  assert.equal(pickUniqueFilename('file.pdf', exists), 'file (2).pdf')
  assert.equal(pickUniqueFilename('FILE.PDF', exists), 'FILE (2).PDF')
})

test('pickUniqueFilename handles compound extensions, no extension, and dotfiles', () => {
  const taken = new Set(['archive.tar.gz', 'readme', '.env'])
  const exists = (name: string): boolean => taken.has(name.toLowerCase())

  assert.equal(pickUniqueFilename('archive.tar.gz', exists), 'archive (1).tar.gz')
  assert.equal(pickUniqueFilename('README', exists), 'README (1)')
  assert.equal(pickUniqueFilename('.env', exists), '.env (1)')
})

test('formatBytes and formatSpeed format sizes cleanly', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-5), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(10 * 1024 * 1024), '10 MB')
  assert.equal(formatBytes(1.25 * 1024 * 1024 * 1024), '1.25 GB')

  assert.equal(formatSpeed(0), '')
  assert.equal(formatSpeed(-10), '')
  assert.equal(formatSpeed(2 * 1024 * 1024), '2 MB/s')
})

test('programs and scripts are recognised so they are never opened from the downloads list', () => {
  for (const f of ['setup.exe', 'Installer.MSI', 'run.bat', 'x.cmd', 'script.ps1', 'a.vbs', 'shortcut.lnk', 'page.hta', 'tool.jar', 'evil.exe. ']) assert.equal(isRunnable(f), true, f)
  for (const f of ['notes.pdf', 'essay.docx', 'photo.jpg', 'data.csv', 'README', 'archive.zip']) assert.equal(isRunnable(f), false, f)
})
