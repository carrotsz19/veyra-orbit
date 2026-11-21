// Builds the Veyra Orbit Dev installer into release-dev/ (npm run dist:dev).
import { execSync } from 'node:child_process'

const env = { ...process.env, VEYRA_CHANNEL: 'dev' }
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env })

run('npm run typecheck')
run('npx electron-vite build')
run('npx electron-builder --win --publish never --config electron-builder.dev.cjs')
