/*
 * Settings store persisted in userData/settings.json.
 * Reads are validated strictly with unknown keys dropped and safe defaults applied.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, searchUrlFor, type Settings, type SettingsView } from '../shared/settings.ts'

export class SettingsStore {
  private readonly file: string
  private readonly defaultDownloadsDir: string
  private readonly envDownloadsDir: string
  private data: Settings

  constructor(file: string, defaultDownloadsDir: string, envDownloadsDir = '') {
    this.file = file
    this.defaultDownloadsDir = defaultDownloadsDir
    this.envDownloadsDir = envDownloadsDir
    this.data = this.load()
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return sanitizeSettings(raw)
    } catch {
      return { ...DEFAULT_SETTINGS }
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
    return { ...this.data }
  }

  searchUrl(): string {
    return searchUrlFor(this.data.searchEngine)
  }

  effectiveDownloadsDir(): string {
    return this.envDownloadsDir || this.data.downloadsDir || this.defaultDownloadsDir
  }

  view(): SettingsView {
    return {
      ...this.data,
      effectiveDownloadsDir: this.effectiveDownloadsDir(),
      downloadsOverridden: !!this.envDownloadsDir
    }
  }

  update(patch: unknown): SettingsView {
    this.data = mergeSettings(this.data, patch)
    this.save()
    return this.view()
  }
}
