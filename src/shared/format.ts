/** Converts an Electron zoom level (1.2^level) to a rounded percentage like 100 or 110. */
export function zoomPercent(level: number): number {
  return Math.round(Math.pow(1.2, level) * 100)
}

/** Keeps zoom levels within Chromium's supported ~25%–470% range. */
export function clampZoomLevel(level: number): number {
  return Math.max(-7.5, Math.min(8.5, level))
}
