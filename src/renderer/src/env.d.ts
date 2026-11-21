import type { VeyraApi } from '@shared/types'

declare global {
  interface Window {
    veyra: VeyraApi
  }
}

export {}
