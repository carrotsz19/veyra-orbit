import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = resolve(import.meta.dirname, '..')
const resources = join(root, 'resources')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const previewPath = 'C:/Users/garre/AppData/Local/Temp/veyra-orbit-icon-final.png'

async function raster(svg, size) {
  // Supersample every master so small icons get stable coverage and crisp pixel edges.
  return sharp(svg).resize(size * 4, size * 4, { fit: 'contain' }).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
}

async function makeIcon(name) {
  const svg = await readFile(join(resources, `${name}.svg`))
  const master = await sharp(svg).resize(1024, 1024).png().toBuffer()
  await writeFile(join(resources, `${name}.png`), master)
  const images = await Promise.all(sizes.map((size) => raster(svg, size)))
  await writeFile(join(resources, `${name}.ico`), await pngToIco(images))
  return { master, images }
}

await mkdir(resources, { recursive: true })
const [prod, dev] = await Promise.all([makeIcon('icon'), makeIcon('icon-dev')])

const W = 1600, H = 1160
const layers = []
const svgText = (width, height, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)
layers.push({ input: svgText(W, H, `<rect width="100%" height="100%" fill="#eeeae2"/><text x="45" y="48" font-family="Segoe UI,Arial" font-size="26" fill="#1b1a18">VEYRA ORBIT  /  FINAL ICONS</text>`), left: 0, top: 0 })
const colW = 220, startX = 50, rowY = [95, 500]
for (let theme = 0; theme < 2; theme++) {
  const bg = theme ? '#242321' : '#f3f1ec'
  layers.push({ input: svgText(1500, 350, `<rect width="100%" height="100%" rx="24" fill="${bg}"/><text x="24" y="36" font-family="Segoe UI,Arial" font-size="18" fill="${theme ? '#f3f1ec' : '#1b1a18'}">${theme ? 'DARK TASKBAR' : 'LIGHT SURFACE'}</text>`), left: 50, top: rowY[theme] })
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i], x = startX + i * colW
    for (let v = 0; v < 2; v++) {
      const img = (v ? dev : prod).images[i]
      const scaled = await sharp(img).resize(92, 92, { kernel: 'nearest' }).png().toBuffer()
      layers.push({ input: scaled, left: x + 12 + v * 100, top: rowY[theme] + 65 })
    }
    layers.push({ input: svgText(190, 28, `<text x="8" y="20" font-family="Segoe UI,Arial" font-size="15" fill="${theme ? '#eeeae2' : '#514d46'}">${size}px  PROD / DEV</text>`), left: x, top: rowY[theme] + 140 })
  }
}
// Taskbar mock, with the two app icons beside generic placeholders.
layers.push({ input: svgText(1500, 150, `<rect width="100%" height="100%" rx="26" fill="#242321"/><circle cx="56" cy="75" r="18" fill="#72706c"/><rect x="99" y="56" width="38" height="38" rx="10" fill="#7b98a6"/><rect x="158" y="56" width="38" height="38" rx="10" fill="#8b9b73"/><text x="225" y="85" font-family="Segoe UI,Arial" font-size="20" fill="#eeeae2">Windows taskbar preview</text>`), left: 50, top: 925 })
for (let i = 0; i < 2; i++) layers.push({ input: await sharp((i ? dev : prod).master).resize(56, 56).png().toBuffer(), left: 580 + i * 76, top: 972 })
await sharp({ create: { width: W, height: H, channels: 4, background: '#eeeae2' } }).composite(layers).png().toFile(previewPath)
console.log(`Generated Prod and Dev PNG/ICO assets and preview: ${previewPath}`)

