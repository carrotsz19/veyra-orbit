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
  private safeMode: boolean
  private activeWindowButtons: WindowButtonsStyle
  private data: Settings

  constructor(
    file: string,
    defaultDownloadsDir: string,
    envDownloadsDir = '',
    supportsWindowButtons = process.platform === 'win32',
    supportsAcrylic = false,
    safeMode = false
  ) {
    this.file = file
    this.defaultDownloadsDir = defaultDownloadsDir
    this.envDownloadsDir = envDownloadsDir
    this.supportsWindowButtons = supportsWindowButtons
    this.supportsAcrylic = supportsAcrylic
    this.safeMode = safeMode
    this.data = this.load()
    this.activeWindowButtons = supportsWindowButtons ? this.data.windowButtons : 'windows'
  }

  setSafeMode(on: boolean): void {
    this.safeMode = on
  }

  isSafeMode(): boolean {
    return this.safeMode
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
      searchEngines: this.data.searchEngines.map((e) => ({ ...e })),
      appearance: {
        ...this.data.appearance,
        toolbarItems: [...this.data.appearance.toolbarItems],
        enabledMods: [...this.data.appearance.enabledMods]
      },
      startPage: {
        ...this.data.startPage,
        quickLinks: this.data.startPage.quickLinks.map((l) => ({ ...l })),
        widgets: this.data.startPage.widgets.map((w) => ({ ...w }))
      },
      shortcuts: { ...this.data.shortcuts }
    }
  }

  searchEngines() {
    return this.data.searchEngines.map((e) => ({ ...e }))
  }

  searchUrl(): string {
    return searchUrlFor(this.data.searchEngine, this.data.searchEngines)
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
      supportsAcrylic: this.supportsAcrylic,
      safeMode: this.safeMode
    }
  }

  update(patch: unknown): SettingsView {
    this.data = mergeSettings(this.data, patch)
    this.save()
    return this.view()
  }
}
