// The village's browser view: a tiny local web server, started by the mod for the session's life.
// The mod posts the world to /api/state every tick; browsers get it over Server-Sent Events from /events and
// draw it on a canvas. What a browser asks for (a wish, a chore, a reply) waits in an inbox that the mod's
// next post collects. It listens on the loopback addresses only (127.0.0.1, and ::1 so `localhost` works
// everywhere), and every request but the page itself needs the session token.
//
// Usage: node server.mjs   (VILLAGE_TOKEN and optionally VILLAGE_PORT from the environment)

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const TOKEN = process.env.VILLAGE_TOKEN ?? ''
const FIRST_PORT = Number(process.env.VILLAGE_PORT) || 4850
/** Without a post from the mod for this long the session is gone, so the server goes too. */
const IDLE_MS = 60_000
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/village.js': ['village.js', 'text/javascript; charset=utf-8'],
}

let map = ''
let state = ''
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
    if (state) send(res, 'state', state)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/state') {
    try {
      const parsed = JSON.parse(await body(req))
      lastPost = Date.now()
      if (parsed.map) { map = JSON.stringify(parsed.map); broadcast('map', map) }
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
    setTimeout(() => process.exit(0), 50)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/do') {
    try {
      const action = JSON.parse(await body(req, 4000))
      if (action && typeof action.kind === 'string' && inbox.length < 20) inbox.push(action)
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
setInterval(() => { if (Date.now() - lastPost > IDLE_MS) process.exit(0) }, 5_000).unref()

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
  })
}
listen(FIRST_PORT, 30)
