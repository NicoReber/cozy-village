// Starts the shared village server (server.mjs) on its own, so it outlives the session that started it: a
// child the mod spawned itself would die with that session's module. Waits until the server holds
// server.json, prints that file's content and exits; the server writes what it says to server.log.
//
// Usage: node launch.mjs   (the server's environment: VILLAGE_HOME and the rest, see server.mjs)

import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.VILLAGE_HOME || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'cozy-village')
const SERVER_FILE = join(HOME, 'server.json')
const WAIT_MS = 15_000

function isAlive(pid) {
  if (typeof pid !== 'number') return false
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/** server.json when a live server holds it, else null. */
function held() {
  try {
    const s = JSON.parse(readFileSync(SERVER_FILE, 'utf8'))
    return !s.stopped && s.port && isAlive(s.pid) ? s : null
  } catch {
    return null
  }
}

let found = held()
if (!found) {
  mkdirSync(HOME, { recursive: true })
  const log = openSync(join(HOME, 'server.log'), 'w')
  const child = spawn(process.execPath, [join(DIR, 'server.mjs')], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env })
  let exited = false
  child.on('exit', () => { exited = true })
  child.unref()
  const until = Date.now() + WAIT_MS
  // a server that lost the race to another prints RUNNING and exits: then the other one's file is the answer
  while (!found && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 100))
    found = held()
    if (exited && !found) {
      await new Promise(resolve => setTimeout(resolve, 300))
      found = held()
      break
    }
  }
}
if (!found) {
  console.error(`the village server did not start; see ${join(HOME, 'server.log')}`)
  process.exit(1)
}
console.log(JSON.stringify({ port: found.port, token: found.token, pid: found.pid }))
