/*
 * Settings store persisted in userData/settings.json.
 * Reads are validated strictly with unknown keys dropped and safe defaults applied.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  mergeSettings,
  sanitizeSettings,
  searchUrlFor,
  type Settings,
  type SettingsView,
  type WindowButtonsStyle
} from '../shared/settings.ts'

export class SettingsStore {
  private readonly file: string
  private readonly defaultDownloadsDir: string
  private readonly envDownloadsDir: string
  private readonly supportsWindowButtons: boolean
  private readonly supportsAcrylic: boolean
  private activeWindowButtons: WindowButtonsStyle
  private data: Settings

  constructor(
    file: string,
    defaultDownloadsDir: string,
    envDownloadsDir = '',
    supportsWindowButtons = process.platform === 'win32',
    supportsAcrylic = false
  ) {
    this.file = file
    this.defaultDownloadsDir = defaultDownloadsDir
    this.envDownloadsDir = envDownloadsDir
    this.supportsWindowButtons = supportsWindowButtons
    this.supportsAcrylic = supportsAcrylic
    this.data = this.load()
    this.activeWindowButtons = supportsWindowButtons ? this.data.windowButtons : 'windows'
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return sanitizeSettings(raw)
    } catch {
      return sanitizeSettings(null)
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
    } catch {
      /* not fatal: settings stay in memory for this run */
    }
  }

  get(): Settings {
    return {
      ...this.data,
      appearance: { ...this.data.appearance },
      startPage: {
        ...this.data.startPage,
        quickLinks: this.data.startPage.quickLinks.map((l) => ({ ...l })),
        widgets: this.data.startPage.widgets.map((w) => ({ ...w }))
      },
      shortcuts: { ...this.data.shortcuts }
    }
  }

  searchUrl(): string {
    return searchUrlFor(this.data.searchEngine)
  }

  effectiveDownloadsDir(): string {
    return this.envDownloadsDir || this.data.downloadsDir || this.defaultDownloadsDir
  }

  activeWindowButtonsStyle(): WindowButtonsStyle {
    return this.activeWindowButtons
  }

  acrylicSupported(): boolean {
    return this.supportsAcrylic
  }

  view(): SettingsView {
    return {
      ...this.get(),
      effectiveDownloadsDir: this.effectiveDownloadsDir(),
      downloadsOverridden: !!this.envDownloadsDir,
      activeWindowButtons: this.activeWindowButtons,
      supportsWindowButtons: this.supportsWindowButtons,
      supportsAcrylic: this.supportsAcrylic
    }
  }

  update(patch: unknown): SettingsView {
    this.data = mergeSettings(this.data, patch)
    this.save()
    return this.view()
  }
}
