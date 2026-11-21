/** "dev" in Veyra Orbit Dev builds, "prod" otherwise. Set at build time (electron.vite.config.ts). */
declare const __CHANNEL__: 'dev' | 'prod'
/** Dev builds only (main process): read-only token for carrotsz19/veyra-orbit-dev; empty in Prod. */
declare const __DEV_FEED_TOKEN__: string
