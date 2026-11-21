declare module 'adm-zip' {
  export interface IZipEntry {
    entryName: string
    isDirectory: boolean
    getData(): Buffer
  }
  export default class AdmZip {
    constructor(input?: string | Buffer)
    getEntries(): IZipEntry[]
    extractAllTo(targetPath: string, overwrite?: boolean): void
  }
}
