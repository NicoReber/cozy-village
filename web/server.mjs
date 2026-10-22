// The shared village: one local server that runs the world (hooks/host.ts) for every Claude Code session.
// It saves the world to its own file, feeds the browser view over Server-Sent Events from /events, and serves
// the sessions' API: they find it through server.json next to the save, say hello, report their real work,
// poll the pane's picture and take the model calls the village needs, since only a session can call a model.
// Only one runs at a time; it saves and leaves once no session has been around for five minutes. It listens
// on the loopback addresses only (127.0.0.1, and ::1 so `localhost` works everywhere), and every request but
// the page itself needs the token from server.json.
//
// Usage: node server.mjs   (web/launch.mjs starts it for a session; from the environment, all optional:
//                           VILLAGE_HOME for the save's folder, by default cozy-village in the Claude config
//                           folder; VILLAGE_PORT, the first port to try; VILLAGE_TOKEN; VILLAGE_ADULTS=1)

import { createServer } from 'node:http'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const DIR = dirname(fileURLToPath(import.meta.url))
const TOKEN = process.env.VILLAGE_TOKEN || randomBytes(16).toString('hex')
const FIRST_PORT = Number(process.env.VILLAGE_PORT) || 4850
/** With no session around for this long, the village saves and the server goes. */
const EMPTY_MS = 5 * 60_000
const HOME = process.env.VILLAGE_HOME || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'cozy-village')
/** Where sessions find the server: its port, token and process id. */
const SERVER_FILE = join(HOME, 'server.json')
const SAVE_FILE = join(HOME, 'world.json')
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/village.js': ['village.js', 'text/javascript; charset=utf-8'],
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`the village needs Node.js 22.18 or newer to run the game (this is ${process.version})`)
  process.exit(1)
}
// the game imports its modules without an extension, the way the plugin's bundler wants them; Node strips the types
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

let saved
try { saved = JSON.parse(await readFile(SAVE_FILE, 'utf8')) } catch { /* a fresh village */ }
const h = host.createHost(saved, { adults: process.env.VILLAGE_ADULTS === '1' })

let map = ''
let state = ''
let info = ''
const clients = new Set()

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`)
const broadcast = (event, data) => { for (const res of clients) send(res, event, data) }
const json = (res, value) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))

async function body(req, limit) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > limit) throw new Error('too large')
  }
  return text
}

/** The request's JSON body, or undefined when it is not JSON. */
async function bodyJson(req, limit) {
  try { return JSON.parse(await body(req, limit)) } catch { return undefined }
}

let saving = Promise.resolve()
const save = () => (saving = saving.then(async () => {
  await mkdir(HOME, { recursive: true })
  // written aside and renamed over, so a crash mid-write never leaves half a save
  await writeFile(`${SAVE_FILE}.tmp`, JSON.stringify(host.saveOf(h)))
  await rename(`${SAVE_FILE}.tmp`, SAVE_FILE)
}).catch(err => console.error(`cannot save the village: ${err.message}`)))

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const q = url.searchParams
  const file = FILES[path]
  if (req.method === 'GET' && file) {
    try {
      res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' })
      res.end(await readFile(join(DIR, file[0])))
    } catch {
      res.writeHead(500).end()
    }
    return
  }
  const token = q.get('k') ?? req.headers['x-village-token']
  if (token !== TOKEN) { res.writeHead(403).end(); return }
  const now = Date.now()

  if (req.method === 'GET' && path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 1000\n\n')
    if (map) send(res, 'map', map)
    if (info) send(res, 'info', info)
    if (state) send(res, 'state', state)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'GET' && path === '/api/ping') return json(res, { pid: process.pid, sessions: [...h.sessions.values()].map(({ repo, branch, status, tool }) => ({ repo, branch, status, tool })) })
  if (req.method === 'POST' && path === '/api/stop') {
    res.writeHead(204).end()
    await save()
    await releaseServerFile(true)
    setTimeout(() => process.exit(0), 50)
    return
  }
  // everything else is the sessions' and browsers' API (hooks/host.ts)
  const answer = host.api(h, { method: req.method ?? 'GET', path, query: name => q.get(name), body: req.method === 'POST' ? await bodyJson(req, 20_000) : undefined }, now)
  if (!answer) return res.writeHead(404).end()
  if (answer.save) await save()
  if (answer.json === undefined) return res.writeHead(answer.status).end()
  res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.json))
}

/** Claims server.json for this server; false when another live server holds it. */
async function claimServerFile(port) {
  await mkdir(HOME, { recursive: true })
  const mine = JSON.stringify({ port, token: TOKEN, pid: process.pid })
  try {
    await writeFile(SERVER_FILE, mine, { flag: 'wx', mode: 0o600 })
    return true
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
  let other
  try { other = JSON.parse(await readFile(SERVER_FILE, 'utf8')) } catch { /* half written or unreadable: take it over */ }
  if (other && !other.stopped && other.pid !== process.pid && isAlive(other.pid)) return false
  await writeFile(SERVER_FILE, mine, { mode: 0o600 })
  return true
}

/**
 * Removes server.json when it is still this server's. A `stopped` one stays behind with only that mark, so
 * the other sessions stop their villages too instead of starting a new server; `/village` starts one again.
 */
async function releaseServerFile(stopped = false) {
  try {
    const held = JSON.parse(await readFile(SERVER_FILE, 'utf8'))
    if (held.pid !== process.pid) return
    if (stopped) await writeFile(SERVER_FILE, JSON.stringify({ stopped: true }), { mode: 0o600 })
    else await unlink(SERVER_FILE)
  } catch { /* already gone */ }
}

function isAlive(pid) {
  if (typeof pid !== 'number') return false
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/** The village's clock, started once this server holds server.json. */
function run() {
  let mapAt = -1
  let infoAt = -1
  setInterval(() => {
    if (host.tickHost(h, Date.now())) void save()
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

  // keep each browser's stream open through proxies and sleep
  setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 15_000).unref()

  let lastSession = Date.now()
  const quit = () => { void save().then(() => releaseServerFile()).then(() => process.exit(0)) }
  setInterval(() => {
    if (h.sessions.size) lastSession = Date.now()
    else if (Date.now() - lastSession > EMPTY_MS) quit()
  }, 5_000).unref()
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, quit)
}

const server = createServer(handle)
function listen(port, triesLeft) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) listen(port + 1, triesLeft - 1)
    else { console.error(`cannot listen: ${err.message}`); process.exit(1) }
  })
  server.listen(port, '127.0.0.1', async () => {
    if (!(await claimServerFile(port))) {
      // another village server got there first: the sessions read server.json and connect to that one
      console.log('RUNNING')
      process.exit(0)
    }
    // the same port on IPv6 loopback, where `localhost` may resolve first; fine to go without
    const v6 = createServer(handle)
    v6.once('error', () => {})
    v6.listen(port, '::1', () => {})
    run()
    console.log(`LISTENING ${port}`)
    console.log(`the village: http://localhost:${port}/?k=${TOKEN}`)
  })
}
listen(FIRST_PORT, 30)
