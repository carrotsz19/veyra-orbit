import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = resolve(import.meta.dirname, '..')
const resources = join(root, 'resources')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const smallSizes = [16, 24, 32, 48]

function smallMaster(dev, size) {
  const inset = size <= 16 ? 0.5 : 1
  const radius = size <= 16 ? 3.5 : size * 0.23
  const stroke = size <= 16 ? 1.5 : size <= 24 ? 2 : 3
  const orbit = size <= 16 ? 'M3 11 C4 7.5 7.5 5.5 10.5 5.3' : 'M3 12 C4.5 8 8 6 11.5 6'
  const moonX = size <= 16 ? 11 : 12
  const moonY = size <= 16 ? 6 : 7
  const moonR = size <= 16 ? 2.5 : 3
  const bg = dev ? '#1b1a18' : '#f3f1ec'
  const arc = dev ? '#f3f1ec' : '#b3492b'
  const marker = dev ? `<path d="M${size-5} ${inset} H${size-inset-radius} Q${size-inset} ${inset} ${size-inset} ${inset+radius} V${inset+radius+1} Z" fill="#b3492b"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect x="${inset}" y="${inset}" width="${size-2*inset}" height="${size-2*inset}" rx="${radius}" fill="${bg}"/><path d="${orbit}" fill="none" stroke="${arc}" stroke-width="${stroke}" stroke-linecap="round"/><circle cx="${moonX}" cy="${moonY}" r="${moonR}" fill="#d9633e"/>${marker}</svg>`
}

async function makeIcon(name, dev) {
  const svg = await readFile(join(resources, `${name}.svg`))
  const master = await sharp(svg).resize(1024, 1024).png().toBuffer()
  await writeFile(join(resources, `${name}.png`), master)
  const images = await Promise.all(sizes.map(async size => {
    if (smallSizes.includes(size)) {
      const file = `${name}-${size}.svg`
      await writeFile(join(resources, file), smallMaster(dev, size))
      return sharp(Buffer.from(smallMaster(dev, size))).png().toBuffer()
    }
    return sharp(svg).resize(size, size).png().toBuffer()
  }))
  await writeFile(join(resources, `${name}.ico`), await pngToIco(images))
  return master
}

await mkdir(resources, { recursive: true })
const [prod, dev] = await Promise.all([makeIcon('icon', false), makeIcon('icon-dev', true)])
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
  }
}
const preview = join(tmpdir(), 'veyra-orbit-icon-preview.png')
await sharp({ create: { width: cell * 7, height: 710, channels: 4, background: '#e8e5de' } }).composite(overlays).png().toFile(preview)
console.log(`Generated PNG and ICO assets. Preview: ${preview}`)
