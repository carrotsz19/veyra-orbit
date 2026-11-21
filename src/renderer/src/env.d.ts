import type { VeyraApi, VeyraMenuWindowApi } from '@shared/types'

declare global {
  interface Window {
    veyra: VeyraApi
    veyraMenu?: VeyraMenuWindowApi
  }
}

export {}
