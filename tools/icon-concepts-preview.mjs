import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'resources', 'icon-concepts')
const out = 'C:/Users/garre/AppData/Local/Temp/veyra-orbit-icon-concepts.png'
const sizes = [16, 24, 32, 48, 128, 256]
const cellW = 550
const rowH = 300
const top = 105
const left = 190
const concepts = [
  ['A', 'Single moon', 'a-single-moon'],
  ['B', 'Orbit O', 'b-orbit-o'],
  ['C', 'Crescent', 'c-crescent'],
  ['D', 'Wayfinder', 'd-wayfinder'],
]
const rows = concepts.flatMap(([letter, name, file]) => [
  { letter, name, file: `${file}.svg`, env: 'Prod' },
  { letter, name, file: `${file}-dev.svg`, env: 'Dev' },
])
const width = left + sizes.length * cellW
const height = top + rows.length * rowH
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#e8e5de"/><text x="24" y="40" font-family="Segoe UI,Arial" font-size="25" font-weight="700" fill="#1b1a18">Veyra Orbit · Icon concepts</text><text x="24" y="72" font-family="Segoe UI,Arial" font-size="14" fill="#514d46">Each sample shown at native pixel size, on light and dark taskbar backgrounds</text>`]
for (let col = 0; col < sizes.length; col++) {
  const x = left + col * cellW
  parts.push(`<text x="${x + cellW / 2}" y="50" text-anchor="middle" font-family="Segoe UI,Arial" font-size="16" font-weight="700" fill="#514d46">${sizes[col]} px</text><text x="${x + 140}" y="90" text-anchor="middle" font-family="Segoe UI,Arial" font-size="13" fill="#514d46">Light taskbar</text><text x="${x + 415}" y="90" text-anchor="middle" font-family="Segoe UI,Arial" font-size="13" fill="#514d46">Dark taskbar</text>`)
}
rows.forEach((row, i) => {
  const y = top + i * rowH
  const name = i % 2 === 0 ? `<text x="22" y="${y + 40}" font-family="Segoe UI,Arial" font-size="18" font-weight="700" fill="#1b1a18">${row.letter} · ${esc(row.name)}</text>` : ''
  parts.push(`<rect x="0" y="${y}" width="${width}" height="${rowH}" fill="${i % 2 === 0 ? '#e8e5de' : '#dedbd4'}"/>${name}<text x="24" y="${y + 70}" font-family="Segoe UI,Arial" font-size="14" fill="#514d46">${row.env}</text>`)
  for (let col = 0; col < sizes.length; col++) {
    const cellX = left + col * cellW
    parts.push(`<rect x="${cellX + 5}" y="${y + 12}" width="270" height="270" rx="24" fill="#f3f1ec"/><rect x="${cellX + 280}" y="${y + 12}" width="270" height="270" rx="24" fill="#282725"/>`)
  }
})
parts.push('</svg>')
const overlays = [{ input: Buffer.from(parts.join('')), left: 0, top: 0 }]
for (let r = 0; r < rows.length; r++) {
  const svg = await readFile(join(dir, rows[r].file))
  for (let c = 0; c < sizes.length; c++) {
    const size = sizes[c]
    const x = left + c * cellW
    const y = top + r * rowH + 12
    const png = await sharp(svg).resize(size, size).png().toBuffer()
    overlays.push({ input: png, left: x + 5 + Math.floor((270 - size) / 2), top: y + Math.floor((270 - size) / 2) })
    overlays.push({ input: png, left: x + 280 + Math.floor((270 - size) / 2), top: y + Math.floor((270 - size) / 2) })
  }
}
await mkdir('C:/Users/garre/AppData/Local/Temp', { recursive: true })
await sharp({ create: { width, height, channels: 4, background: '#e8e5de' } }).composite(overlays).png().toFile(out)
console.log(`Preview: ${out}`)
