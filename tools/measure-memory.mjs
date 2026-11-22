#!/usr/bin/env node
/**
 * Dev-only memory measurement harness for Veyra Orbit.
 *
 * Launches Orbit with a clean scratch profile (VEYRA_USERDATA / VEYRA_DOWNLOADS under %TEMP%),
 * --remote-debugging-port, and VEYRA_MEASURE_MEMORY=1 (disabled in packaged builds).
 * Opens 1, 10, and 30 tabs across real web pages, waits for them to load and settle,
 * and prints total and per-process memory from Electron's app.getAppMetrics().
 *
 * Usage:
 *   npm run build && node tools/measure-memory.mjs
 *   node tools/measure-memory.mjs --counts 1,10,30 --settle-ms 5000 --port 9339
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

const DEFAULT_URLS = [
  'https://example.com',
  'https://www.iana.org/domains/reserved',
  'https://info.cern.ch/',
  'https://en.wikipedia.org/wiki/Electron_(software_framework)',
  'https://developer.mozilla.org/en-US/docs/Web/HTML',
  'https://news.ycombinator.com/'
]

function parseArgs(argv) {
  const opts = {
    port: 9339,
    counts: [1, 10, 30],
    settleMs: 5000,
    loadTimeoutMs: 30_000,
    json: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port' && argv[i + 1]) opts.port = Number(argv[++i]) || opts.port
    else if (a === '--counts' && argv[i + 1]) {
      const parsed = argv[++i]
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
      if (parsed.length) opts.counts = parsed
    } else if (a === '--settle-ms' && argv[i + 1]) opts.settleMs = Math.max(500, Number(argv[++i]) || opts.settleMs)
    else if (a === '--load-timeout-ms' && argv[i + 1]) opts.loadTimeoutMs = Math.max(3000, Number(argv[++i]) || opts.loadTimeoutMs)
    else if (a === '--json') opts.json = true
  }
  return opts
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const kbToMb = (kb) => (kb / 1024).toFixed(1)

function urlForTabIndex(idx) {
  const base = DEFAULT_URLS[idx % DEFAULT_URLS.length]
  if (idx < DEFAULT_URLS.length) return base
  const u = new URL(base)
  u.searchParams.set('orbit_bench', String(idx + 1))
  return u.toString()
}

async function waitForMainTarget(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (res.ok) {
        const list = await res.json()
        const mainUi = list.find(
          (t) => t.type === 'page' && typeof t.url === 'string' && t.url.includes('index.html') && !t.url.includes('view=')
        )
        if (mainUi?.webSocketDebuggerUrl) return mainUi.webSocketDebuggerUrl
      }
    } catch {
      /* server still starting */
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for Orbit CDP main UI target on port ${port}`)
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolveOpen, rejectOpen) => {
      const onOpen = () => {
        cleanup()
        resolveOpen()
      }
      const onErr = (err) => {
        cleanup()
        rejectOpen(err)
      }
      const cleanup = () => {
        this.ws.removeEventListener('open', onOpen)
        this.ws.removeEventListener('error', onErr)
      }
      this.ws.addEventListener('open', onOpen)
      this.ws.addEventListener('error', onErr)
    })
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) rej(new Error(msg.error.message || 'CDP error'))
          else res(msg.result)
        }
      } catch {
        /* ignore */
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evalJs(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || 'Evaluation failed')
    }
    return res.result?.value
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }
}

function printSnapshot(snap) {
  console.log(`\n=== ${snap.label} ===`)
  console.log(
    `Windows: ${snap.windowCount} | WebContents: ${snap.webContentsCount} | Tabs: ${snap.tabs.total} (loading: ${snap.tabs.loading}, sleeping: ${snap.tabs.sleeping}) | Processes: ${snap.processCount}`
  )
  console.log(
    `Total Working Set: ${kbToMb(snap.totalWorkingSetKB)} MB | Total Private Bytes: ${kbToMb(snap.totalPrivateKB)} MB`
  )
  const byType = new Map()
  for (const p of snap.processes) {
    const cur = byType.get(p.type) ?? { count: 0, ws: 0, priv: 0 }
    cur.count++
    cur.ws += p.workingSetKB
    cur.priv += p.privateKB
    byType.set(p.type, cur)
  }
  console.log('By process type:')
  for (const [type, info] of [...byType.entries()].sort((a, b) => b[1].ws - a[1].ws)) {
    console.log(
      `  ${type.padEnd(18)} x${String(info.count).padEnd(3)} WS: ${kbToMb(info.ws).padStart(7)} MB   Private: ${kbToMb(info.priv).padStart(7)} MB`
    )
  }
  console.log('Per-process breakdown (sorted by Working Set):')
  const sorted = [...snap.processes].sort((a, b) => b.workingSetKB - a.workingSetKB)
  for (const p of sorted) {
    const label = p.targets.length
      ? p.targets.slice(0, 2).join(', ') + (p.targets.length > 2 ? ` (+${p.targets.length - 2})` : '')
      : p.name || ''
    console.log(
      `  pid ${String(p.pid).padEnd(6)} ${p.type.padEnd(16)} WS: ${kbToMb(p.workingSetKB).padStart(7)} MB   Priv: ${kbToMb(p.privateKB).padStart(7)} MB   ${label}`
    )
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repoRoot = resolve(import.meta.dirname, '..')
  if (!existsSync(join(repoRoot, 'out/main/index.js'))) {
    console.error('Build missing: run `npm run build` first.')
    process.exit(1)
  }

  const electronBin = require('electron')
  const scratchRoot = mkdtempSync(join(tmpdir(), 'orbit-measure-'))
  const userDataDir = join(scratchRoot, 'userdata')
  const downloadsDir = join(scratchRoot, 'downloads')
  const ipcDir = join(scratchRoot, 'ipc')
  mkdirSync(ipcDir, { recursive: true })

  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  childEnv.VEYRA_USERDATA = userDataDir
  childEnv.VEYRA_DOWNLOADS = downloadsDir
  childEnv.VEYRA_MEASURE_IPC_DIR = ipcDir

  const child = spawn(electronBin, ['.', `--remote-debugging-port=${opts.port}`], {
    cwd: repoRoot,
    env: childEnv,
    stdio: 'ignore'
  })

  let reqSeq = 1
  const sendIpc = (payload) => {
    const tmp = join(ipcDir, 'req.tmp')
    const out = join(ipcDir, 'req.json')
    writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    renameSync(tmp, out)
  }

  const requestMetrics = async (label, timeoutMs = 15_000) => {
    const id = String(reqSeq++)
    const resFile = join(ipcDir, `res-${id}.json`)
    sendIpc({ id, cmd: 'metrics', label })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (existsSync(resFile)) {
        const data = JSON.parse(readFileSync(resFile, 'utf8'))
        try {
          unlinkSync(resFile)
        } catch {
          /* ignore */
        }
        return data
      }
      await sleep(50)
    }
    throw new Error(`Timed out waiting for metrics (${label})`)
  }

  let cdp = null
  const results = []

  try {
    const wsUrl = await waitForMainTarget(opts.port)
    cdp = new CdpClient(wsUrl)
    await cdp.connect()

    // Wait for Orbit UI bridge + initial tab restoration.
    const readyDeadline = Date.now() + 15_000
    while (Date.now() < readyDeadline) {
      const hasBridge = await cdp.evalJs('typeof window.veyra === "object" && typeof window.veyra.newTab === "function"')
      if (hasBridge) break
      await sleep(200)
    }
    await sleep(2500)

    const startupSnap = await requestMetrics('startup (start page)')
    results.push(startupSnap)
    printSnapshot(startupSnap)

    let openedWebTabs = 0
    for (const targetCount of opts.counts) {
      while (openedWebTabs < targetCount) {
        const url = urlForTabIndex(openedWebTabs)
        if (openedWebTabs === 0) {
          await cdp.evalJs(`window.veyra.navigate(1, ${JSON.stringify(url)})`)
        } else {
          await cdp.evalJs(`window.veyra.newTab(${JSON.stringify(url)})`)
        }
        openedWebTabs++
        await sleep(120)
      }

      // Wait until tabs finish loading (or timeout).
      const loadDeadline = Date.now() + opts.loadTimeoutMs
      while (Date.now() < loadDeadline) {
        const probe = await requestMetrics('probe')
        if (probe.tabs.total >= targetCount && probe.tabs.loading === 0) break
        await sleep(500)
      }

      // Let memory settle after loads finish.
      await sleep(opts.settleMs)
      const snap = await requestMetrics(`${targetCount} ${targetCount === 1 ? 'tab' : 'tabs'}`)
      results.push(snap)
      printSnapshot(snap)
    }

    console.log('\n=== Summary ===')
    console.log('Stage                  | Procs | Wins | WCs | Working Set | Private Bytes')
    console.log('-----------------------|-------|------|-----|-------------|--------------')
    for (const r of results) {
      console.log(
        `${r.label.padEnd(22)} | ${String(r.processCount).padStart(5)} | ${String(r.windowCount).padStart(4)} | ${String(r.webContentsCount).padStart(3)} | ${(kbToMb(r.totalWorkingSetKB) + ' MB').padStart(11)} | ${(kbToMb(r.totalPrivateKB) + ' MB').padStart(13)}`
      )
    }

    if (opts.json) {
      console.log('\n' + JSON.stringify(results, null, 2))
    }
  } finally {
    cdp?.close()
    try {
      sendIpc({ cmd: 'quit' })
    } catch {
      /* ignore */
    }
    await sleep(800)
    if (!child.killed) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    await sleep(500)
    try {
      rmSync(scratchRoot, { recursive: true, force: true })
    } catch {
      /* ignore locked files on Windows exit */
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
