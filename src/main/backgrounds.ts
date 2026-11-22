/*
 * App-owned start page background image management (main process only).
 * Opens native file picker for PNG/JPG/WebP <= 20 MB, validates magic bytes,
 * re-encodes with nativeImage to <= 2560 px JPEG in userData/backgrounds/<uuid>.jpg,
 * deletes the previous background, and serves only app-owned files to the UI.
 */
import { BrowserWindow, dialog, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { isValidBackgroundFilename } from '../shared/startpage'

const MAX_INPUT_BYTES = 20 * 1024 * 1024 // 20 MB
const MAX_DIMENSION_PX = 2560
const JPEG_QUALITY = 84

function hasSupportedImageSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true
  }
  return false
}

function backgroundsDir(userDataDir: string): string {
  return join(userDataDir, 'backgrounds')
}

function safeBgPath(userDataDir: string, filename: string): string | null {
  if (!filename || !isValidBackgroundFilename(filename)) return null
  const dir = resolve(backgroundsDir(userDataDir))
  const cleanName = basename(filename)
  if (cleanName !== filename) return null
  const full = resolve(dir, cleanName)
  if (!full.startsWith(dir)) return null
  return full
}

export function deleteStartBackgroundFile(userDataDir: string, filename: string): void {
  const path = safeBgPath(userDataDir, filename)
  if (!path) return
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* ignore best-effort cleanup */
  }
}

export function readStartBackgroundDataUrl(userDataDir: string, filename: string): string | null {
  const path = safeBgPath(userDataDir, filename)
  if (!path || !existsSync(path)) return null
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_BYTES) return null
    const buf = readFileSync(path)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export type ChooseBackgroundResult =
  | { ok: true; filename: string; dataUrl: string }
  | { ok: false; canceled?: boolean; error?: string }

export async function chooseAndSaveStartBackground(
  win: BrowserWindow,
  userDataDir: string,
  previousFilename: string
): Promise<ChooseBackgroundResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: 'Choose start page background',
    filters: [{ name: 'Images (PNG, JPEG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  })
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false, canceled: true }
  }

  const sourcePath = picked.filePaths[0]
  let buf: Buffer
  try {
    const stat = statSync(sourcePath)
    if (!stat.isFile()) return { ok: false, error: 'Selected item is not a file.' }
    if (stat.size <= 0) return { ok: false, error: 'Selected image file is empty.' }
    if (stat.size > MAX_INPUT_BYTES) {
      return { ok: false, error: 'Image is too large (maximum 20 MB).' }
    }
    buf = readFileSync(sourcePath)
  } catch {
    return { ok: false, error: 'Could not read the selected image file.' }
  }

  if (!hasSupportedImageSignature(buf)) {
    return { ok: false, error: 'Only PNG, JPEG, and WebP images are supported.' }
  }

  let img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) {
    return { ok: false, error: 'Could not decode the selected image.' }
  }

  const size = img.getSize()
  if (size.width <= 0 || size.height <= 0) {
    return { ok: false, error: 'Image has invalid dimensions.' }
  }

  if (size.width > MAX_DIMENSION_PX || size.height > MAX_DIMENSION_PX) {
    const scale = Math.min(MAX_DIMENSION_PX / size.width, MAX_DIMENSION_PX / size.height)
    img = img.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good'
    })
  }

  const jpeg = img.toJPEG(JPEG_QUALITY)
  if (!jpeg.length) {
    return { ok: false, error: 'Could not re-encode the image.' }
  }

  const filename = `${randomUUID()}.jpg`
  const dir = backgroundsDir(userDataDir)
  const dest = safeBgPath(userDataDir, filename)
  if (!dest) return { ok: false, error: 'Could not resolve background directory.' }

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(dest, jpeg)
  } catch {
    return { ok: false, error: 'Could not save the background image.' }
  }

  if (previousFilename && previousFilename !== filename) {
    deleteStartBackgroundFile(userDataDir, previousFilename)
  }

  return {
    ok: true,
    filename,
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`
  }
}
