// The village as the shared server runs it: one world, its chat, and the model calls it hands to sessions.
// Pure logic, no `$` and no Node: web/server.mjs drives it with a timer, a save file and HTTP. Only a Claude
// Code session can call a model, so a wish or a diary becomes a job that a connected session takes, runs
// and answers.

import type { LogLine } from '../types'
import { applyDiary, createWorld, DIARY_SYSTEM, diaryPrompt, enqueue, heardWish, parseActions, restore, sayPlayer, snapshot, step, summary, systemPrompt } from './game'
import type { World } from './game'
import { CHORES } from './web'

/** A model call the village waits for; `system` and `prompt` go to the model as they are. */
export type Job = { id: number; kind: 'wish' | 'diary'; system: string; prompt: string; maxTokens: number; day?: number; at: number }
/** What a pane or a browser asks the village for. */
export type HostAction = { kind?: unknown; text?: unknown; key?: unknown }

/** A taken job that is not answered in this long goes back on the list (the model call times out at 60 s). */
export const LEASE_MS = 90_000
/** A wish no session took in this long is dropped (a diary waits: the day stays due in the save). */
export const WISH_WAIT_MS = 120_000
const CHAT_LINES = 60

export type Host = {
  world: World
  /** The last lines of the village's chat, for panes and browsers. */
  chat: LogLine[]
  /** Headlines since the last look, for the sessions' toasts. */
  announce: string[]
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
  return { world, chat: [], announce: [], jobs: [], taken: new Map(), nextId: 1, savedHour: Math.floor(world.minutes / 60) }
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
  h.announce.push(...w.announce.splice(0))
  h.announce = h.announce.slice(-10)
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
    h.jobs.push({ id: h.nextId++, kind: 'wish', system: systemPrompt(w), prompt: summary(w, text), maxTokens: 1200, at: now })
  } else if (a.kind === 'chore' && typeof a.key === 'string' && Object.hasOwn(CHORES, a.key)) {
    enqueue(w, CHORES[a.key].plan as Parameters<typeof enqueue>[1])
  } else if (a.kind === 'museum' && w.projects.museum.done) {
    enqueue(w, [{ do: w.scene === 'museum' ? 'exit' : 'tour' }])
  }
}

/** Hands the oldest waiting job to a session, or one whose session never answered; null when none waits. */
export function takeJob(h: Host, now: number): Job | null {
  const job = h.jobs.find(j => !h.taken.has(j.id) || now - (h.taken.get(j.id) ?? 0) > LEASE_MS)
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
