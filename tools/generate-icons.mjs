// Draws the Veyra Orbit app icon (a moon travelling its orbit) and writes every file the build uses:
//   resources/icon.svg, icon.png (1024), icon.ico   (Prod)
//   resources/icon-dev.svg, icon-dev.png, icon-dev.ico   (Dev: ink tile, clay corner wedge)
// Sizes up to 48 px use a simplified drawing (no gradients, heavier orbit) so the taskbar icon
// stays crisp. Run with `npm run icons:generate`.
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const resources = join(resolve(import.meta.dirname, '..'), 'resources')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const SMALL = 48

const clay = '#d9633e'
const clayDeep = '#b3492b'

/** One icon as SVG on a 128-unit grid. `small` drops gradients and thickens the orbit for ≤48 px. */
function icon({ dev, small, size }) {
  // Tile: Windows 11 app icons sit inside a ~112/128 rounded square.
  const tile = { x: 8, y: 8, w: 112, r: 26 }
  const orbit = 'M30 96 C34 66 55 44 84 39'
  const moon = small ? { cx: 89, cy: 39, r: 20 } : { cx: 89, cy: 39, r: 17 }
  const orbitWidth = small ? 13 : 8

  const tileFill = dev ? (small ? '#1d1b18' : 'url(#tileDev)') : small ? '#f3f1ec' : 'url(#tile)'
  const edge = dev ? 'rgba(243,241,236,0.14)' : 'rgba(27,26,24,0.12)'
  const orbitFill = small ? (dev ? '#cfc8bb' : '#e3a68f') : 'url(#trail)'
  const moonFill = small ? clay : 'url(#moon)'

  const defs = small
    ? ''
    : `<defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfbf7"/><stop offset="1" stop-color="#ebe6dc"/></linearGradient>
    <linearGradient id="tileDev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2925"/><stop offset="1" stop-color="#161513"/></linearGradient>
    <linearGradient id="trail" gradientUnits="userSpaceOnUse" x1="30" y1="96" x2="84" y2="39">
      <stop offset="0" stop-color="${dev ? '#f3f1ec' : clayDeep}" stop-opacity="${dev ? 0.1 : 0.08}"/>
      <stop offset="1" stop-color="${dev ? '#f3f1ec' : clayDeep}" stop-opacity="${dev ? 0.75 : 0.85}"/>
    </linearGradient>
    <radialGradient id="moon" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="#f08a64"/><stop offset="0.55" stop-color="${clay}"/><stop offset="1" stop-color="${clayDeep}"/></radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#1b1a18" flood-opacity="${dev ? 0.45 : 0.2}"/></filter>
    <clipPath id="clip"><rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.w}" rx="${tile.r}"/></clipPath>
  </defs>`
  const clipAttr = small ? '' : ' clip-path="url(#clip)"'
  const wedge = dev
    ? small
      ? `<path d="M120 70 V94 A26 26 0 0 1 94 120 H70 Z" fill="${clayDeep}"/>`
      : `<g${clipAttr}><path d="M120 82 V120 H82 Z" fill="${clayDeep}"/></g>`
    : ''
  const highlight = small ? '' : `<circle cx="${moon.cx - 6}" cy="${moon.cy - 6.5}" r="4.5" fill="#fff" fill-opacity="0.22"/>`
  const moonFilter = small ? '' : ' filter="url(#soft)"'

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
  await writeFile(join(resources, `${name}.svg`), icon({ dev, small: false, size: 1024 }))
  await writeFile(join(resources, `${name}-small.svg`), icon({ dev, small: true, size: 48 }))
  await writeFile(join(resources, `${name}.png`), await render({ dev, small: false, size: 1024 }))
  const frames = await Promise.all(ICO_SIZES.map((size) => render({ dev, small: size <= SMALL, size })))
  await writeFile(join(resources, `${name}.ico`), await pngToIco(frames))
}

await make('icon', false)
await make('icon-dev', true)
console.log('Generated resources/icon(.svg/.png/.ico) and resources/icon-dev(.svg/.png/.ico).')
