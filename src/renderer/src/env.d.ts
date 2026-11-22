import type {
  VeyraApi,
  VeyraCompactPanelApi,
  VeyraMenuWindowApi,
  VeyraPaletteWindowApi,
  VeyraPeekWindowApi,
  VeyraScreenshotWindowApi
} from '@shared/types'

declare global {
  interface Window {
    veyra: VeyraApi
    veyraMenu?: VeyraMenuWindowApi
    veyraCompactPanel?: VeyraCompactPanelApi
    veyraPalette?: VeyraPaletteWindowApi
    veyraPeek?: VeyraPeekWindowApi
    veyraScreenshot?: VeyraScreenshotWindowApi
  }
}

export {}
