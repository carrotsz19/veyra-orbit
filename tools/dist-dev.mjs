// Builds the Veyra Orbit Dev installer into release-dev/ (npm run dist:dev).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLatestYml } from './release-helpers.mjs'

const env = { ...process.env, VEYRA_CHANNEL: 'dev' }
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env })

run('npm run typecheck')
run('npx electron-vite build')
run('npx electron-builder --win --publish never --config electron-builder.dev.cjs')

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const fileName = `Veyra-Orbit-Dev-Setup-${version}.exe`
const exePath = join('release-dev', fileName)
const latestPath = join('release-dev', 'latest.yml')

if (existsSync(exePath) && !existsSync(latestPath)) {
  const sha512 = createHash('sha512').update(readFileSync(exePath)).digest('base64')
  const size = statSync(exePath).size
  writeFileSync(latestPath, buildLatestYml({ version, fileName, sha512, size }), 'utf8')
}
