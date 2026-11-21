#!/usr/bin/env node
/**
 * Releases Veyra Orbit Dev (npm run release:dev):
 *  1. Refuses unless on `main` with a clean working tree.
 *  2. Bumps the date-based version (yy.m.n) in package.json (and package-lock.json),
 *     moves CHANGELOG.md's `## Unreleased` notes under the new version heading, and commits.
 *  3. Runs the Dev build (tools/dist-dev.mjs) and verifies .exe, .blockmap, and latest.yml.
 *  4. Pushes `main` to `origin` and `dev`.
 *  5. Creates GitHub release `v<version>` on carrotsz19/veyra-orbit-dev with those assets.
 *
 * Pass `--dry-run` to test everything up to the point before committing, pushing, or releasing.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bumpDateVersion, checkReleasePreflight, promoteChangelog } from './release-helpers.mjs'

const DEV_REPO = 'carrotsz19/veyra-orbit-dev'
const dryRun = process.argv.includes('--dry-run')
const allowEmptyNotes = process.argv.includes('--allow-empty-notes')

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const runNode = (script, env = process.env) => {
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit', env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const statusPorcelain = git('status', '--porcelain')
const preflight = checkReleasePreflight({ branch, statusPorcelain })

if (!preflight.ok) {
  if (dryRun) {
    console.log('[dry-run] Preflight would refuse a real release:')
    for (const err of preflight.errors) console.log(`  - ${err}`)
  } else {
    for (const err of preflight.errors) console.error(`Error: ${err}`)
    process.exit(1)
  }
}

const pkgRaw = readFileSync('package.json', 'utf8')
const pkg = JSON.parse(pkgRaw)
const nextVersion = bumpDateVersion(pkg.version)
const today = new Date().toISOString().slice(0, 10)

if (!existsSync('CHANGELOG.md')) {
  console.error('Error: CHANGELOG.md not found.')
  process.exit(1)
}
const changelogRaw = readFileSync('CHANGELOG.md', 'utf8')
const promoted = promoteChangelog(changelogRaw, nextVersion, today)
if (promoted.wasEmpty && !allowEmptyNotes) {
  if (dryRun) {
    console.log('[dry-run] Warning: "## Unreleased" in CHANGELOG.md is empty (real release would refuse unless --allow-empty-notes).')
  } else {
    console.error('Error: Add release notes under "## Unreleased" in CHANGELOG.md before releasing.')
    process.exit(1)
  }
}

const releaseNotes = promoted.notes || `- Veyra Orbit Dev ${nextVersion}.`

if (dryRun) {
  console.log(`[dry-run] Version bump: ${pkg.version} -> ${nextVersion}`)
  console.log('[dry-run] Extracted release notes:\n' + releaseNotes)
  console.log('[dry-run] Running Dev build (without modifying package.json or CHANGELOG.md)...')
  rmSync('release-dev', { recursive: true, force: true })
  runNode(join('tools', 'dist-dev.mjs'))

  const builtArtifacts = [
    join('release-dev', `Veyra-Orbit-Dev-Setup-${pkg.version}.exe`),
    join('release-dev', `Veyra-Orbit-Dev-Setup-${pkg.version}.exe.blockmap`),
    join('release-dev', 'latest.yml')
  ]
  const missing = builtArtifacts.filter((p) => !existsSync(p))
  if (missing.length > 0) {
    console.error('[dry-run] Missing expected build artifacts:', missing.join(', '))
    process.exit(1)
  }
  console.log('[dry-run] Verified build artifacts:', builtArtifacts.join(', '))
  console.log('[dry-run] Would commit package.json, package-lock.json (if present), CHANGELOG.md')
  console.log('[dry-run] Would run: git push origin main')
  console.log('[dry-run] Would run: git push dev main')
  console.log(
    `[dry-run] Would run: gh release create v${nextVersion} release-dev/Veyra-Orbit-Dev-Setup-${nextVersion}.exe release-dev/Veyra-Orbit-Dev-Setup-${nextVersion}.exe.blockmap release-dev/latest.yml --repo ${DEV_REPO} --title "Veyra Orbit Dev ${nextVersion}" --notes-file release-dev/release-notes.md --latest`
  )
  console.log('[dry-run] Done. Nothing was committed, pushed, or published.')
  process.exit(0)
}

// Verify gh CLI is signed in before mutating anything.
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' })
} catch {
  console.error('Error: Sign in with the GitHub CLI first (gh auth login).')
  process.exit(1)
}

const eol = pkgRaw.includes('\r\n') ? '\r\n' : '\n'
const nextPkg = { ...pkg, version: nextVersion }
writeFileSync('package.json', `${JSON.stringify(nextPkg, null, 2).replace(/\n/g, eol)}${eol}`, 'utf8')

const filesToCommit = ['package.json', 'CHANGELOG.md']
if (existsSync('package-lock.json')) {
  const lockRaw = readFileSync('package-lock.json', 'utf8')
  const lockEol = lockRaw.includes('\r\n') ? '\r\n' : '\n'
  const lock = JSON.parse(lockRaw)
  lock.version = nextVersion
  if (lock.packages && lock.packages['']) lock.packages[''].version = nextVersion
  writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2).replace(/\n/g, lockEol)}${lockEol}`, 'utf8')
  filesToCommit.push('package-lock.json')
}

writeFileSync('CHANGELOG.md', promoted.markdown, 'utf8')

execFileSync('git', ['add', ...filesToCommit], { stdio: 'inherit' })
execFileSync('git', ['commit', '-m', `Release Veyra Orbit Dev ${nextVersion}`], { stdio: 'inherit' })

rmSync('release-dev', { recursive: true, force: true })
runNode(join('tools', 'dist-dev.mjs'))

const exe = join('release-dev', `Veyra-Orbit-Dev-Setup-${nextVersion}.exe`)
const blockmap = join('release-dev', `Veyra-Orbit-Dev-Setup-${nextVersion}.exe.blockmap`)
const latestYml = join('release-dev', 'latest.yml')
for (const artifact of [exe, blockmap, latestYml]) {
  if (!existsSync(artifact)) {
    console.error(`Error: Expected build artifact missing: ${artifact}`)
    process.exit(1)
  }
}

execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' })
execFileSync('git', ['push', 'dev', 'main'], { stdio: 'inherit' })

const notesFile = join('release-dev', 'release-notes.md')
writeFileSync(notesFile, `${releaseNotes}\n`, 'utf8')

execFileSync(
  'gh',
  [
    'release',
    'create',
    `v${nextVersion}`,
    exe,
    blockmap,
    latestYml,
    '--repo',
    DEV_REPO,
    '--title',
    `Veyra Orbit Dev ${nextVersion}`,
    '--notes-file',
    notesFile,
    '--latest'
  ],
  { stdio: 'inherit' }
)

console.log(`\nReleased Veyra Orbit Dev ${nextVersion}: https://github.com/${DEV_REPO}/releases/tag/v${nextVersion}`)
