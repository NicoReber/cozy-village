// The village's browser view: a tiny local web server, started by the mod for the session's life.
// The mod posts the world to /api/state every tick; browsers get it over Server-Sent Events from /events and
// draw it on a canvas. What a browser asks for (a wish, a chore, a reply) waits in an inbox that the mod's
// next post collects. It listens on the loopback addresses only (127.0.0.1, and ::1 so `localhost` works
// everywhere), and every request but the page itself needs the session token.
//
// With --world the server runs the village itself instead (hooks/host.ts): one world for every session, saved
// to its own file, with the browsers fed straight from it. Until the sessions connect to it, a wish waits
// for a session to think it through and is dropped after two minutes.
//
// Usage: node server.mjs           (VILLAGE_TOKEN and optionally VILLAGE_PORT from the environment)
//        node server.mjs --world   (VILLAGE_TOKEN optional, a random one otherwise; VILLAGE_HOME for the save's
//                                   folder, by default cozy-village in the Claude config folder; VILLAGE_ADULTS=1)

import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const DIR = dirname(fileURLToPath(import.meta.url))
const WORLD_MODE = process.argv.includes('--world')
const TOKEN = process.env.VILLAGE_TOKEN || (WORLD_MODE ? randomBytes(16).toString('hex') : '')
const FIRST_PORT = Number(process.env.VILLAGE_PORT) || 4850
/** Without a post from the mod for this long the session is gone, so the server goes too. */
const IDLE_MS = 60_000
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/village.js': ['village.js', 'text/javascript; charset=utf-8'],
}

let map = ''
let state = ''
let info = ''
let inbox = []
let lastPost = Date.now()
const clients = new Set()

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`)
const broadcast = (event, data) => { for (const res of clients) send(res, event, data) }

async function body(req, limit = 2_000_000) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > limit) throw new Error('too large')
  }
  return text
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const file = FILES[url.pathname]
  if (req.method === 'GET' && file) {
    try {
      res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' })
      res.end(await readFile(join(DIR, file[0])))
    } catch {
      res.writeHead(500).end()
    }
    return
  }
  const token = url.searchParams.get('k') ?? req.headers['x-village-token']
  if (!TOKEN || token !== TOKEN) { res.writeHead(403).end(); return }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 1000\n\n')
    if (map) send(res, 'map', map)
    if (info) send(res, 'info', info)
    if (state) send(res, 'state', state)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/state' && !village) {
    try {
      const parsed = JSON.parse(await body(req))
      lastPost = Date.now()
      if (parsed.map) { map = JSON.stringify(parsed.map); broadcast('map', map) }
      if (parsed.info) { info = JSON.stringify(parsed.info); broadcast('info', info) }
      if (parsed.state) { state = JSON.stringify(parsed.state); broadcast('state', state) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ inbox, viewers: clients.size }))
      inbox = []
    } catch {
      res.writeHead(400).end()
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    res.writeHead(204).end()
    await village?.save()
    setTimeout(() => process.exit(0), 50)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/do') {
    try {
      const action = JSON.parse(await body(req, 4000))
      if (village) { if (action && typeof action === 'object') village.act(action) }
      else if (action && typeof action.kind === 'string' && inbox.length < 20) inbox.push(action)
      res.writeHead(204).end()
    } catch {
      res.writeHead(400).end()
    }
    return
  }
  res.writeHead(404).end()
}
const server = createServer(handle)

// keep each browser's stream open through proxies and sleep
setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 15_000).unref()
setInterval(() => { if (!village && Date.now() - lastPost > IDLE_MS) process.exit(0) }, 5_000).unref()

/** The village this server runs in world mode; null when a session posts it instead. */
const village = WORLD_MODE ? await runVillage() : null

/** Loads the game's TypeScript modules (Node strips the types), restores the save and ticks the world. */
async function runVillage() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(`the village needs Node.js 22.18 or newer to run the game (this is ${process.version})`)
    process.exit(1)
  }
  // the game imports its modules without an extension, the way the plugin's bundler wants them
  registerHooks({
    resolve(specifier, context, next) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        try { return next(`${specifier}.ts`, context) } catch { /* not a TypeScript module */ }
      }
      return next(specifier, context)
    },
  })
  const hooks = join(DIR, '..', 'hooks')
  const host = await import(pathToFileURL(join(hooks, 'host.ts')).href)
  const view = await import(pathToFileURL(join(hooks, 'web.ts')).href)

  const home = process.env.VILLAGE_HOME || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'cozy-village')
  const file = join(home, 'world.json')
  let saved
  try { saved = JSON.parse(await readFile(file, 'utf8')) } catch { /* a fresh village */ }
  const h = host.createHost(saved, { adults: process.env.VILLAGE_ADULTS === '1' })

  let saving = Promise.resolve()
  const write = () => (saving = saving.then(async () => {
    await mkdir(home, { recursive: true })
    // written aside and renamed over, so a crash mid-write never leaves half a save
    await writeFile(`${file}.tmp`, JSON.stringify(host.saveOf(h)))
    await rename(`${file}.tmp`, file)
  }).catch(err => console.error(`cannot save the village: ${err.message}`)))

  let mapAt = -1
  let infoAt = -1
  setInterval(() => {
    if (host.tickHost(h, Date.now())) void write()
    const w = h.world
    if (w.tick - mapAt >= 10) {
      mapAt = w.tick
      const next = JSON.stringify(view.mapPayload(w))
      if (next !== map) { map = next; broadcast('map', map) }
    }
    if (w.tick - infoAt >= 10) {
      infoAt = w.tick
      const next = JSON.stringify(view.infoPayload(w))
      if (next !== info) { info = next; broadcast('info', info) }
    }
    state = JSON.stringify(view.statePayload(w, h.chat))
    broadcast('state', state)
  }, 150)

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void write().then(() => process.exit(0)) })
  return { host: h, act: action => host.act(h, action, Date.now()), save: write }
}

function listen(port, triesLeft) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) listen(port + 1, triesLeft - 1)
    else { console.error(`cannot listen: ${err.message}`); process.exit(1) }
  })
  server.listen(port, '127.0.0.1', () => {
    // the same port on IPv6 loopback, where `localhost` may resolve first; fine to go without
    const v6 = createServer(handle)
    v6.once('error', () => {})
    v6.listen(port, '::1', () => {})
    console.log(`LISTENING ${port}`)
    if (village) console.log(`the village: http://localhost:${port}/?k=${TOKEN}`)
  })
}
listen(FIRST_PORT, 30)
