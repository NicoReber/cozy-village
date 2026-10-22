// Renders docs/browser.gif: films the real browser view while it replays the scripted scenes in tools/browser_scene.ts.
// With `office` it renders docs/office.gif from tools/office_scene.ts instead.
//
// Copies the scene script into tests/ for one run of `claude plugin test`, serves the browser view from a small replay
// server of its own (the page and its /events stream, as web/server.mjs serves them), opens the page in headless
// Chrome, sends the recorded ticks at the game's pace and screenshots the page over the DevTools protocol, then hands
// the frames to Python with Pillow to write the GIF. Run from the repository root:
//
//     node tools/render_browser_gif.mjs
//     node tools/render_browser_gif.mjs office
//
// Needs Node 22+, Chrome (CHROME to point elsewhere) and Python with Pillow.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Which film: `browser` (the default) or `office`; it names the scene script and the GIF. */
const FILM = process.argv[2] ?? 'browser'
const WIDTH = 1280
const HEIGHT = 720
/** The GIF is the page scaled down to this. */
const SCALE = 0.55
const TICK_MS = 150
/** Screenshots per game tick; the page glides between ticks, so two keep the walking smooth. */
const SHOTS_PER_TICK = 2
const PORT = 4899
const DEBUG_PORT = 9339
const CHROME = process.env.CHROME ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(existsSync)

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 1. record the scenes
const copy = join(ROOT, 'tests', 'zz_browser_scene.test.ts')
copyFileSync(join(ROOT, 'tools', `${FILM}_scene.ts`), copy)
let output
try {
  // the test runner prints a test's console lines on stderr
  const run = spawnSync('claude', ['plugin', 'test', '.'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, shell: process.platform === 'win32' })
  output = `${run.stdout}
${run.stderr}`
} finally {
  rmSync(copy)
}
const ticks = []
let label = ''
for (const line of output.split(/\r?\n/)) {
  if (line.startsWith('SCENE ')) label = line.slice(6)
  else if (line.startsWith('TICK ')) ticks.push({ label, body: line.slice(5) })
}
if (!ticks.length) throw new Error('the scene script printed no ticks')
console.log(`${ticks.length} ticks recorded`)

// 2. the replay server and the browser
const token = 'gif'
const PAGES = { '/': ['index.html', 'text/html; charset=utf-8'], '/village.js': ['village.js', 'text/javascript; charset=utf-8'] }
const streams = new Set()
const last = {}
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const page = PAGES[url.pathname]
  if (page) return res.writeHead(200, { 'content-type': page[1] }).end(readFileSync(join(ROOT, 'web', page[0])))
  if (url.pathname !== '/events') return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  for (const [event, data] of Object.entries(last)) res.write(`event: ${event}\ndata: ${data}\n\n`)
  streams.add(res)
  req.on('close', () => streams.delete(res))
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
/** Sends one recorded tick (its state, and its map and info when they changed) to the page. */
const post = async body => {
  const tick = JSON.parse(body)
  for (const event of ['map', 'info', 'state']) {
    if (!tick[event]) continue
    last[event] = JSON.stringify(tick[event])
    for (const res of streams) res.write(`event: ${event}\ndata: ${last[event]}\n\n`)
  }
}
await post(ticks[0].body)

const profile = mkdtempSync(join(tmpdir(), 'village-gif-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then(r => r.json()).then(list => list.find(t => t.type === 'page')).catch(() => undefined)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let nextId = 1
const pending = new Map()
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id) }
})
const cdp = (method, params = {}) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/?k=${token}` })
for (let i = 0; i < 6; i++) { await post(ticks[0].body); await sleep(TICK_MS) }

// 3. film: post each tick at the game's pace, screenshot in between
const frames = mkdtempSync(join(tmpdir(), 'village-frames-'))
let n = 0
let started = 0
for (const [k, tick] of ticks.entries()) {
  if (k === 0 || tick.label !== ticks[k - 1].label) {
    // a new scene: let the camera find Claude, then hold it still (a small drag stops following), so a frame
    // only differs from the one before where something moves; the office film shows the whole room instead
    await cdp('Runtime.evaluate', { expression: `document.getElementById('${FILM === 'office' ? 'fit' : 'follow'}').click()` })
    for (let i = 0; i < 6; i++) { await post(tick.body); await sleep(TICK_MS) }
    if (FILM !== 'office') {
      const at = { x: WIDTH / 2, y: HEIGHT / 2, button: 'left', clickCount: 1 }
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...at })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, x: at.x + 6 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, x: at.x })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at })
    }
    started = Date.now() - k * TICK_MS
  }
  await post(tick.body)
  for (let s = 0; s < SHOTS_PER_TICK; s++) {
    const due = started + k * TICK_MS + (s * TICK_MS) / SHOTS_PER_TICK
    await sleep(Math.max(0, due - Date.now()))
    const shot = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(frames, `${String(n++).padStart(4, '0')}.png`), Buffer.from(shot.data, 'base64'))
  }
}
ws.close()
chrome.kill()
server.closeAllConnections()
server.close()
console.log(`${n} frames filmed`)

// 4. the GIF
mkdirSync(join(ROOT, 'docs'), { recursive: true })
const out = join(ROOT, 'docs', `${FILM}.gif`)
// one palette for every frame and no dithering, so pixel art stays crisp and a pixel that did not change keeps its
// index; those pixels then become transparent, which the GIF's compression all but erases
const py = `
import glob, sys
from PIL import Image, ImageChops
paths = sorted(glob.glob(sys.argv[1] + '/*.png'))
size = (${Math.round(WIDTH * SCALE)}, ${Math.round(HEIGHT * SCALE)})
frames = [Image.open(p).convert('RGB').resize(size, Image.LANCZOS) for p in paths]
sample = frames[::max(1, len(frames) // 16)][:16]
sheet = Image.new('RGB', (size[0], size[1] * len(sample)))
for k, f in enumerate(sample):
    sheet.paste(f, (0, size[1] * k))
palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
indexed = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
plane = lambda im: Image.frombytes('L', size, im.tobytes())
out = [indexed[0]]
for prev, cur in zip(indexed, indexed[1:]):
    same = ImageChops.difference(plane(cur), plane(prev)).point(lambda v: 255 if v == 0 else 0)
    delta = cur.copy()
    delta.paste(255, mask=same)
    out.append(delta)
out[0].save(sys.argv[2], save_all=True, append_images=out[1:], duration=${Math.round(TICK_MS / SHOTS_PER_TICK)}, loop=0, optimize=False, transparency=255, disposal=1)
`
execFileSync(process.env.PYTHON ?? 'python', ['-c', py, frames, out], { stdio: 'inherit' })
rmSync(frames, { recursive: true, force: true })
rmSync(profile, { recursive: true, force: true })
console.log(`wrote ${out}`)
