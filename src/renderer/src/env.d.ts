import type { VeyraApi, VeyraCompactPanelApi, VeyraMenuWindowApi } from '@shared/types'

declare global {
  interface Window {
    veyra: VeyraApi
    veyraMenu?: VeyraMenuWindowApi
    veyraCompactPanel?: VeyraCompactPanelApi
  }
}

export {}
