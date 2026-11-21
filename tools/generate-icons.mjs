import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = resolve(import.meta.dirname, '..')
const resources = join(root, 'resources')
const sizes = [16, 24, 32, 48, 64, 128, 256]

async function makeIcon(name) {
  const svg = await readFile(join(resources, `${name}.svg`))
  const master = await sharp(svg).resize(1024, 1024).png().toBuffer()
  await writeFile(join(resources, `${name}.png`), master)
  const images = await Promise.all(sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()))
  await writeFile(join(resources, `${name}.ico`), await pngToIco(images))
  return master
}

await mkdir(resources, { recursive: true })
const [prod, dev] = await Promise.all([makeIcon('icon'), makeIcon('icon-dev')])

// A contact sheet in the OS temporary folder for review, with both variants at several sizes.
const cell = 288
const rowHeight = 350
const labels = ['16 px', '24 px', '32 px', '48 px', '64 px', '128 px', '256 px']
const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 7}" height="710"><rect width="100%" height="100%" fill="#e8e5de"/><text x="24" y="30" font-family="Segoe UI,Arial" font-size="20" fill="#1b1a18">Veyra Orbit · Prod</text><text x="24" y="380" font-family="Segoe UI,Arial" font-size="20" fill="#1b1a18">Veyra Orbit · Dev</text></svg>`)
const overlays = [{ input: background, left: 0, top: 0 }]
for (let row = 0; row < 2; row++) {
  const source = row ? dev : prod
  for (let col = 0; col < sizes.length; col++) {
    const size = sizes[col]
    const rendered = await sharp(source).resize(size, size).png().toBuffer()
    overlays.push({ input: rendered, left: col * cell + Math.round((cell - size) / 2), top: row * rowHeight + 50 })
    const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="24"><text x="${cell / 2}" y="17" text-anchor="middle" font-family="Segoe UI,Arial" font-size="13" fill="#514d46">${labels[col]}</text></svg>`)
    overlays.push({ input: text, left: col * cell, top: row * rowHeight + 320 })
  }
}
const preview = join(tmpdir(), 'veyra-orbit-icon-preview.png')
await sharp({ create: { width: cell * 7, height: 710, channels: 4, background: '#e8e5de' } }).composite(overlays).png().toFile(preview)
console.log(`Generated PNG and ICO assets. Preview: ${preview}`)
