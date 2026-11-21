import type { VeyraApi, VeyraCompactPanelApi, VeyraMenuWindowApi, VeyraPaletteWindowApi } from '@shared/types'

declare global {
  interface Window {
    veyra: VeyraApi
    veyraMenu?: VeyraMenuWindowApi
    veyraCompactPanel?: VeyraCompactPanelApi
    veyraPalette?: VeyraPaletteWindowApi
  }
}

export {}
