import type {
  VeyraApi,
  VeyraCompactPanelApi,
  VeyraMenuWindowApi,
  VeyraPaletteWindowApi,
  VeyraPeekWindowApi
} from '@shared/types'

declare global {
  interface Window {
    veyra: VeyraApi
    veyraMenu?: VeyraMenuWindowApi
    veyraCompactPanel?: VeyraCompactPanelApi
    veyraPalette?: VeyraPaletteWindowApi
    veyraPeek?: VeyraPeekWindowApi
  }
}

export {}
