// The village as the shared server runs it: one world, its chat, and the model calls it hands to sessions.
// Pure logic, no `$` and no Node: web/server.mjs drives it with a timer, a save file and HTTP. Only a Claude
// Code session can call a model, so a wish or a diary becomes a job that a connected session takes, runs
// and answers. Sessions say hello, report what their real work is doing, and read the pane's picture back.

import type { LogLine } from '../types'
import {
  applyDiary, createWorld, DIARY_SYSTEM, diaryPrompt, echoTests, echoTool, echoTurn, encode, enqueue, frame, heardWish, MAX_VIEW,
  memoryText, parseActions, postcard, restore, sayPlayer, snapshot, step, summary, systemPrompt, ticker, VILLAGERS,
} from './game'
import type { World } from './game'
import { joinOffice, leaveOffice, officeWork } from './office'
import { CHORES, infoPayload } from './web'

/**
 * A model call the village waits for; `system` and `prompt` go to the model as they are. A wish typed in a
 * session's pane is `for` that session, so its own model setting answers it; any session takes it once that
 * one is gone.
 */
export type Job = { id: number; kind: 'wish' | 'diary'; system: string; prompt: string; maxTokens: number; day?: number; at: number; for?: string }
/** What a pane or a browser asks the village for; `session` names the pane's session. */
export type HostAction = { kind?: unknown; text?: unknown; key?: unknown; session?: unknown }
/** A Claude Code session connected to the village, and what its real work is doing. */
export type Session = { id: string; repo: string; branch: string; since: number; seen: number; status: 'idle' | 'working'; tool: string }
/** What a session reports: a tool call starting, a turn ending, a test or build run finishing. */
export type SessionEvent = { type?: unknown; tool?: unknown; seconds?: unknown; outcome?: unknown; passed?: unknown }

/** A taken job that is not answered in this long goes back on the list (the model call times out at 60 s). */
export const LEASE_MS = 90_000
/** A wish no session took in this long is dropped (a diary waits: the day stays due in the save). */
export const WISH_WAIT_MS = 120_000
/** A session not heard from in this long is gone (its pane polls several times a second, its job poll every few). */
export const SESSION_STALE_MS = 60_000
const CHAT_LINES = 60
const NAMED = 120
/** A short line from a session, never more than `max` characters. */
const short = (v: unknown, max = NAMED) => (typeof v === 'string' ? v.slice(0, max) : '')

export type Host = {
  world: World
  /** The last lines of the village's chat, for panes and browsers. */
  chat: LogLine[]
  /** The latest headlines, numbered, for the sessions' toasts; each pane asks for those after the last it saw. */
  announce: { seq: number; text: string }[]
  announced: number
  sessions: Map<string, Session>
  jobs: Job[]
  /** When each job was handed out, by id; a job that is not in here waits for a session. */
  taken: Map<number, number>
  nextId: number
  savedHour: number
}

export function createHost(save: unknown, options: { adults?: boolean } = {}): Host {
  const world = createWorld()
  world.adults = options.adults === true
  restore(world, save)
  return {
    world, chat: [], announce: [], announced: 0, sessions: new Map(), jobs: [], taken: new Map(), nextId: 1, savedHour: Math.floor(world.minutes / 60),
  }
}

/** One tick of the village; true when it is time to save (every in-game hour). */
export function tickHost(h: Host, now: number): boolean {
  const w = h.world
  step(w)
  for (const j of h.jobs) {
    if (j.kind === 'wish' && !h.taken.has(j.id) && now - j.at > WISH_WAIT_MS) finishJob(h, j.id, null, 'no session was around to think')
  }
  const lines = w.log.splice(0)
  if (lines.length) h.chat = [...h.chat, ...lines].slice(-CHAT_LINES)
  for (const text of w.announce.splice(0)) h.announce.push({ seq: ++h.announced, text })
  h.announce = h.announce.slice(-10)
  for (const s of h.sessions.values()) if (now - s.seen > SESSION_STALE_MS) bye(h, s.id)
  const day = w.diaryDue[0]
  if (day !== undefined && !h.jobs.some(j => j.kind === 'diary')) {
    const prompt = diaryPrompt(w, day)
    if (prompt) h.jobs.push({ id: h.nextId++, kind: 'diary', system: DIARY_SYSTEM, prompt, maxTokens: 1200, day, at: now })
    else w.diaryDue.shift()
  }
  const hour = Math.floor(w.minutes / 60)
  if (hour === h.savedHour) return false
  h.savedHour = hour
  return true
}

/** A wish, a chore or the museum button; anything else is ignored. */
export function act(h: Host, a: HostAction, now: number) {
  const w = h.world
  if (a.kind === 'wish' && typeof a.text === 'string') {
    const text = a.text.trim().slice(0, 500)
    if (!text || w.thinking) return
    w.log.push({ who: 'you', text })
    heardWish(w, text)
    w.thinking = true
    const session = typeof a.session === 'string' && h.sessions.has(a.session) ? a.session : undefined
    h.jobs.push({ id: h.nextId++, kind: 'wish', system: systemPrompt(w), prompt: summary(w, text), maxTokens: 1200, at: now, for: session })
  } else if (a.kind === 'chore' && typeof a.key === 'string' && Object.hasOwn(CHORES, a.key)) {
    enqueue(w, CHORES[a.key].plan as Parameters<typeof enqueue>[1])
  } else if (a.kind === 'museum' && w.projects.museum.done) {
    enqueue(w, [{ do: w.scene === 'museum' ? 'exit' : 'tour' }])
  } else if (a.kind === 'office') {
    enqueue(w, [{ do: w.scene === 'office' ? 'exit' : 'office' }])
  }
}

/** Hands `session` the oldest job waiting for it, or one whose taker never answered; null when none waits. */
export function takeJob(h: Host, now: number, session?: string): Job | null {
  const job = h.jobs.find(j => (!h.taken.has(j.id) || now - (h.taken.get(j.id) ?? 0) > LEASE_MS)
    && (!j.for || j.for === session || !h.sessions.has(j.for)))
  if (!job) return null
  h.taken.set(job.id, now)
  return job
}

/** A session answers a job: the model's text, or null when the call failed. False for a job nobody waits for. */
export function finishJob(h: Host, id: number, text: string | null, reason = 'no answer'): boolean {
  const job = h.jobs.find(j => j.id === id)
  if (!job) return false
  h.jobs = h.jobs.filter(j => j !== job)
  h.taken.delete(id)
  const w = h.world
  if (job.kind === 'wish') {
    w.thinking = false
    if (text === null) sayPlayer(w, `Sorry, my head feels foggy... (${reason})`)
    else {
      const actions = parseActions(text)
      if (actions.length === 0) sayPlayer(w, "Hmm, I'm not sure how to do that.")
      else enqueue(w, actions)
    }
  } else if (job.day !== undefined) {
    applyDiary(w, job.day, text)
    if (w.diaryDue[0] === job.day) w.diaryDue.shift()
    w.log.push({ who: 'event', text: `Everyone wrote in their diary about day ${job.day}.` })
  }
  return true
}

/** What the save file holds. */
export const saveOf = (h: Host) => snapshot(h.world)

// ---------- the sessions ----------

/** A session connects, or says it is still there; true when it is new. Its apprentice comes to the office. */
export function hello(h: Host, id: string, about: { repo?: unknown; branch?: unknown }, now: number): boolean {
  const known = h.sessions.get(id)
  if (known) {
    known.seen = now
    if (about.repo === undefined && about.branch === undefined) return false
    if (about.repo !== undefined) known.repo = short(about.repo)
    if (about.branch !== undefined) known.branch = short(about.branch)
    joinOffice(h.world.office, id, { repo: known.repo, branch: known.branch })
    return false
  }
  const s: Session = { id, repo: short(about.repo), branch: short(about.branch), since: now, seen: now, status: 'idle', tool: '' }
  h.sessions.set(id, s)
  joinOffice(h.world.office, id, { repo: s.repo, branch: s.branch })
  return true
}

/** A session leaves, or went quiet: its apprentice clocks out. */
export function bye(h: Host, id: string) {
  h.sessions.delete(id)
  leaveOffice(h.world.office, id)
}

/** What a session's real work is doing; the village mirrors it the way it mirrored its own session before. */
export function sessionEvent(h: Host, id: string, e: SessionEvent, now: number) {
  hello(h, id, {}, now)
  const s = h.sessions.get(id)!
  const w = h.world
  if (e.type === 'tool' && typeof e.tool === 'string') {
    s.status = 'working'
    s.tool = short(e.tool, 60)
    echoTool(w, s.tool)
    officeWork(w.office, id, { type: 'tool', tool: s.tool })
  } else if (e.type === 'turn') {
    s.status = 'idle'
    s.tool = ''
    const outcome = e.outcome === 'answer' || e.outcome === 'aborted' ? e.outcome : 'error'
    const seconds = typeof e.seconds === 'number' && e.seconds >= 0 ? e.seconds : 0
    echoTurn(w, seconds, outcome)
    officeWork(w.office, id, { type: 'turn', seconds, outcome })
  } else if (e.type === 'tests' && typeof e.passed === 'boolean') {
    echoTests(w, e.passed)
    officeWork(w.office, id, { type: 'tests', passed: e.passed })
  }
}

// ---------- what panes show ----------

/** The pane's picture at `cols` wide (empty without `cells`), its chat, the headlines after `since`; the tab panels with `info`. */
export function pane(h: Host, cols: number, since: number, info: boolean, cells = true) {
  const w = h.world
  const width = Math.max(24, Math.min(MAX_VIEW, Math.floor(cols) || MAX_VIEW))
  return {
    cols: width,
    cells: cells ? encode(frame(w, width)) : '',
    chat: h.chat,
    thinking: w.thinking,
    scene: w.scene,
    museumOpen: w.projects.museum.done,
    staff: w.office.staff.filter(a => !a.leaving).length,
    ticker: ticker(w),
    announce: h.announce.filter(a => a.seq > since).map(a => a.text),
    seq: h.announced,
    info: info ? infoPayload(w) : undefined,
  }
}

/** A postcard of the scene; the picture flashes as if a photo was taken. */
export function takePostcard(h: Host, cols: number): string {
  h.world.flash = 3
  return postcard(h.world, Math.max(24, Math.min(MAX_VIEW, Math.floor(cols) || MAX_VIEW)))
}

export function memoryReport(h: Host): string {
  const w = h.world
  const blocks = [`Claude\n${memoryText(w, 'claude', 10)}`]
  for (const v of VILLAGERS) blocks.push(`${v.name} (friendship ${w.friendship[v.id] ?? 0})\n${memoryText(w, v.id, 5)}`)
  return blocks.join('\n\n')
}

/** Everyone forgets everything: memories, friendships and the diaries still to write. */
export function forget(h: Host) {
  const fresh = createWorld()
  h.world.memory = fresh.memory
  h.world.friendship = fresh.friendship
  h.world.diaryDue = []
  for (const j of h.jobs.filter(j => j.kind === 'diary')) h.taken.delete(j.id)
  h.jobs = h.jobs.filter(j => j.kind !== 'diary')
}

// ---------- the sessions' API ----------

/** One request to the village's API, as web/server.mjs hands it over (the token already checked). */
export type ApiRequest = { method: string; path: string; query: (name: string) => string | null; body: unknown }
/** The answer: a status and maybe a JSON body; `save` when the world must be saved right away. */
export type ApiAnswer = { status: number; json?: unknown; save?: boolean }

/** The session a request comes from, by its `session` field or parameter; empty when it names none. */
const sessionOf = (v: unknown) => (typeof v === 'string' ? v.slice(0, 80) : '')
const field = (body: unknown, key: string): unknown => (body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined)

/** Answers a request to the API; null for a path it does not know. */
export function api(h: Host, r: ApiRequest, now: number): ApiAnswer | null {
  const { method, path, query, body } = r
  if (method === 'POST' && path === '/api/do') {
    if (!body || typeof body !== 'object') return { status: 400 }
    act(h, body as HostAction, now)
    return { status: 204 }
  }
  if (method === 'POST' && (path === '/api/hello' || path === '/api/bye' || path === '/api/event')) {
    const id = sessionOf(field(body, 'session'))
    if (!id) return { status: 400 }
    if (path === '/api/hello') return { status: 200, json: { isNew: hello(h, id, { repo: field(body, 'repo'), branch: field(body, 'branch') }, now) } }
    if (path === '/api/bye') bye(h, id)
    else sessionEvent(h, id, body as SessionEvent, now)
    return { status: 204 }
  }
  const session = sessionOf(query('session'))
  if (method === 'GET' && path === '/api/pane') {
    if (session) hello(h, session, {}, now)
    return { status: 200, json: pane(h, Number(query('cols')), Number(query('since')) || 0, query('info') === '1', query('cells') !== '0') }
  }
  if (method === 'GET' && path === '/api/postcard') return { status: 200, json: { text: takePostcard(h, Number(query('cols'))) } }
  if (method === 'GET' && path === '/api/memory') return { status: 200, json: { text: memoryReport(h) } }
  if (method === 'POST' && path === '/api/forget') {
    forget(h)
    return { status: 204, save: true }
  }
  if (method === 'GET' && path === '/api/jobs') {
    if (session) hello(h, session, {}, now)
    const job = takeJob(h, now, session || undefined)
    return job ? { status: 200, json: job } : { status: 204 }
  }
  const answer = /^\/api\/jobs\/(\d+)$/.exec(path)
  if (method === 'POST' && answer) {
    const text = field(body, 'text')
    const reason = field(body, 'reason')
    const known = finishJob(h, Number(answer[1]), typeof text === 'string' ? text : null, typeof reason === 'string' ? reason.slice(0, 200) : undefined)
    return { status: known ? 204 : 404 }
  }
  return null
}
