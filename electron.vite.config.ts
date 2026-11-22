import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolveDevFeedToken } from './src/shared/updates'

function copyExtensionPreloads() {
  return {
    name: 'copy-extension-preloads',
    writeBundle() {
      const outDir = resolve('out/preload')
      mkdirSync(outDir, { recursive: true })
      const src = resolve('node_modules/electron-chrome-extensions/dist/chrome-extension-api.preload.js')
      if (existsSync(src)) {
        copyFileSync(src, resolve(outDir, 'chrome-extension-api.preload.js'))
      }
    }
  }
}

// Which Orbit this build is: "dev" for Veyra Orbit Dev test builds (tools/dist-dev.mjs), "prod" otherwise.
const channelName = process.env.VEYRA_CHANNEL === 'dev' ? 'dev' : 'prod'
const channel = { __CHANNEL__: JSON.stringify(channelName) }

// Dev builds only: read-only token for the private carrotsz19/veyra-orbit-dev repo.
// Never embedded in Prod, preload, or renderer.
const devFeedToken = resolveDevFeedToken({
  channel: channelName,
  envToken: process.env.VEYRA_ORBIT_DEV_FEED_TOKEN,
  envTokenFile: process.env.VEYRA_ORBIT_DEV_FEED_TOKEN_FILE,
  readTokenFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null)
})

export default defineConfig({
  // node:sqlite is built into Electron's Node; it isn't bundled.
  main: {
    define: { ...channel, __DEV_FEED_TOKEN__: JSON.stringify(devFeedToken) },
    build: { rollupOptions: { external: ['node:sqlite'] } }
  },
  preload: {
    plugins: [copyExtensionPreloads()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          floating: resolve('src/preload/floating.ts'),
          compact: resolve('src/preload/compact.ts'),
          palette: resolve('src/preload/palette.ts'),
          peek: resolve('src/preload/peek.ts'),
          screenshot: resolve('src/preload/screenshot.ts'),
          'ext-compat': resolve('src/preload/ext-compat.ts'),
          webstore: resolve('src/preload/webstore.ts')
        }
      }
    }
  },
  renderer: {
    define: channel,
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
