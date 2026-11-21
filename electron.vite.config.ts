import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Which Orbit this build is: "dev" for Veyra Orbit Dev test builds (tools/dist-dev.mjs), "prod" otherwise.
const channel = { __CHANNEL__: JSON.stringify(process.env.VEYRA_CHANNEL === 'dev' ? 'dev' : 'prod') }

export default defineConfig({
  // node:sqlite is built into Electron's Node; it isn't bundled.
  main: { define: channel, build: { rollupOptions: { external: ['node:sqlite'] } } },
  preload: {},
  renderer: {
    define: channel,
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
