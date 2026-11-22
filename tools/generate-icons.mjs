// Draws the Veyra Orbit app icon (a moon travelling its orbit) and writes every file the build uses:
//   resources/icon.svg, icon.png (1024), icon.ico   (Prod)
//   resources/icon-dev.svg, icon-dev.png, icon-dev.ico   (Dev: ink tile, clay corner wedge from 96 px)
// Every size keeps the same drawing; small sizes get a heavier orbit, a stronger trail and no
// shadow, so the taskbar, Start menu and desktop icons match the window icon. The .ico carries
// every size Windows asks for at 100-200% scaling, so it never has to stretch one. The Dev mark
// (clay corner wedge) only appears from 96 px; below that the dark tile alone says Dev.
// Run with `npm run icons:generate`.
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const resources = join(resolve(import.meta.dirname, '..'), 'resources')
const ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]

const clay = '#d9633e'
const clayDeep = '#b3492b'

/** 0 at 16 px .. 1 at 96 px and up: how much fine detail the size can carry. */
const detail = (size) => Math.min(1, Math.max(0, (size - 16) / 80))
const lerp = (a, b, t) => a + (b - a) * t

/** One icon as SVG on a 128-unit grid, tuned for the pixel size it will be drawn at. */
function icon({ dev, size }) {
  const t = detail(size)
  // Tile: Windows 11 app icons sit inside a ~112/128 rounded square.
  const tile = { x: 8, y: 8, w: 112, r: 26 }
  const orbit = 'M30 96 C34 66 55 44 84 39'
  const moon = { cx: 89, cy: 39, r: +lerp(20, 17, t).toFixed(2) }
  const orbitWidth = +lerp(12, 8, t).toFixed(2)
  const fine = size >= 48
  const trailStart = +lerp(dev ? 0.4 : 0.32, dev ? 0.1 : 0.08, t).toFixed(3)
  const trailEnd = +lerp(0.95, dev ? 0.75 : 0.85, t).toFixed(3)

  const tileFill = dev ? 'url(#tileDev)' : 'url(#tile)'
  const edge = dev ? 'rgba(243,241,236,0.14)' : 'rgba(27,26,24,0.12)'
  const defs = `<defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfbf7"/><stop offset="1" stop-color="#ebe6dc"/></linearGradient>
    <linearGradient id="tileDev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2925"/><stop offset="1" stop-color="#161513"/></linearGradient>
    <linearGradient id="trail" gradientUnits="userSpaceOnUse" x1="30" y1="96" x2="84" y2="39">
      <stop offset="0" stop-color="${dev ? '#f3f1ec' : clayDeep}" stop-opacity="${trailStart}"/>
      <stop offset="1" stop-color="${dev ? '#f3f1ec' : clayDeep}" stop-opacity="${trailEnd}"/>
    </linearGradient>
    <radialGradient id="moon" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="#f08a64"/><stop offset="0.55" stop-color="${clay}"/><stop offset="1" stop-color="${clayDeep}"/></radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#1b1a18" flood-opacity="${dev ? 0.45 : 0.2}"/></filter>
    <clipPath id="clip"><rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.w}" rx="${tile.r}"/></clipPath>
  </defs>`
  const wedge = dev && size >= 96 ? `<g clip-path="url(#clip)"><path d="M120 86 V120 H86 Z" fill="${clayDeep}"/></g>` : ''
  const highlight = fine ? `<circle cx="${moon.cx - 6}" cy="${moon.cy - 6.5}" r="4.5" fill="#fff" fill-opacity="0.22"/>` : ''
  const moonFilter = fine ? ' filter="url(#soft)"' : ''
  const orbitFill = 'url(#trail)'
  const moonFill = 'url(#moon)'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  ${defs}
  <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.w}" rx="${tile.r}" fill="${tileFill}"/>
  ${wedge}
  <path d="${orbit}" fill="none" stroke="${orbitFill}" stroke-width="${orbitWidth}" stroke-linecap="round"/>
  <circle cx="${moon.cx}" cy="${moon.cy}" r="${moon.r}" fill="${moonFill}"${moonFilter}/>
  ${highlight}
  <rect x="${tile.x + 0.5}" y="${tile.y + 0.5}" width="${tile.w - 1}" height="${tile.w - 1}" rx="${tile.r - 0.5}" fill="none" stroke="${edge}" stroke-width="1"/>
</svg>
`
}

const render = (opts) => sharp(Buffer.from(icon(opts))).png().toBuffer()

async function make(name, dev) {
  await writeFile(join(resources, `${name}.svg`), icon({ dev, size: 1024 }))
  await writeFile(join(resources, `${name}-small.svg`), icon({ dev, size: 32 }))
  await writeFile(join(resources, `${name}.png`), await render({ dev, size: 1024 }))
  const frames = await Promise.all(ICO_SIZES.map((size) => render({ dev, size })))
  await writeFile(join(resources, `${name}.ico`), await pngToIco(frames))
}

await make('icon', false)
await make('icon-dev', true)
console.log('Generated resources/icon(.svg/.png/.ico) and resources/icon-dev(.svg/.png/.ico).')
