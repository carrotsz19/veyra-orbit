/**
 * Pure release helpers for Veyra Orbit Dev (version bumping, changelog promotion,
 * preflight validation, and latest.yml generation).
 */

/**
 * Date-based version bump: <yy>.<m>.<n> (e.g. 26.11.1 -> 26.11.2, or 26.12.1 next month).
 */
export function bumpDateVersion(currentVersion, now = new Date()) {
  const yy = now.getFullYear() % 100
  const month = now.getMonth() + 1
  const match = /^\s*(\d+)\.(\d+)\.(\d+)/.exec(String(currentVersion ?? ''))
  if (match) {
    const curY = Number.parseInt(match[1], 10)
    const curM = Number.parseInt(match[2], 10)
    const curN = Number.parseInt(match[3], 10)
    if (curY === yy && curM === month) {
      return `${yy}.${month}.${curN + 1}`
    }
  }
  return `${yy}.${month}.1`
}

/**
 * Extracts notes from `## Unreleased` in CHANGELOG.md and moves them under a new
 * `## <version> — <date>` heading, leaving a fresh empty `## Unreleased` section.
 */
export function promoteChangelog(markdown, version, dateStr = new Date().toISOString().slice(0, 10)) {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const normalized = markdown.replace(/\r\n/g, '\n')
  const headingRe = /^##[ \t]+Unreleased[ \t]*$/im
  const match = headingRe.exec(normalized)
  if (!match) {
    throw new Error('CHANGELOG.md must contain a "## Unreleased" heading.')
  }

  const afterHeadingStart = match.index + match[0].length
  const rest = normalized.slice(afterHeadingStart)
  const nextSectionMatch = /\n(?=##[ \t]+)/.exec(rest)
  const sectionEnd = nextSectionMatch ? afterHeadingStart + nextSectionMatch.index : normalized.length

  const rawBody = normalized.slice(afterHeadingStart, sectionEnd)
  const notes = rawBody.trim()
  const before = normalized.slice(0, match.index)
  const after = normalized.slice(sectionEnd).replace(/^\n+/, '')

  const entryBody = notes || `- Veyra Orbit Dev ${version}.`
  const versionSection = `## Unreleased\n\n## ${version} — ${dateStr}\n\n${entryBody}`
  const combined = after ? `${before}${versionSection}\n\n${after}` : `${before}${versionSection}\n`
  const finalText = combined.endsWith('\n') ? combined : `${combined}\n`

  return {
    markdown: eol === '\r\n' ? finalText.replace(/\n/g, '\r\n') : finalText,
    notes,
    wasEmpty: notes.length === 0
  }
}

/**
 * Verifies the git working tree is on `main` with no uncommitted changes.
 */
export function checkReleasePreflight({ branch, statusPorcelain }) {
  const errors = []
  if (branch !== 'main') {
    errors.push(`Must be on branch "main" (currently "${branch || 'detached'}").`)
  }
  if (String(statusPorcelain ?? '').trim().length > 0) {
    errors.push('Working tree is not clean. Commit or stash all changes first.')
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Builds an electron-updater compatible latest.yml when electron-builder omits it
 * (e.g. for private GitHub repos with --publish never).
 */
export function buildLatestYml({ version, fileName, sha512, size, releaseDate = new Date().toISOString() }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    ''
  ].join('\n')
}
