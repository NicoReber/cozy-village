// The office: a desk and an apprentice for every Claude Code session that is connected to the village.
// The apprentice walks in when its session says hello, sits at its desk and types while the session runs
// tools, cheers when a turn is done, sighs at errors, fetches coffee when idle and walks out when the session
// ends. Pure logic, no `$`.

export const OW = 40
export const OH = 12
type Pt = { x: number; y: number }
type OTile = 'wall' | 'window' | 'floor' | 'carpet' | 'desk' | 'door' | 'plant' | 'coffee' | 'board'
/** What a session's tool call looks like at a desk; the same kinds the village Claude mirrors. */
export type ToolKind = 'edit' | 'shell' | 'read' | 'web' | 'agent' | 'other'
export type Status = 'idle' | 'working' | 'done' | 'error'

export type Apprentice = Pt & {
  /** The session's id. */
  id: string
  name: string
  repo: string
  branch: string
  /** Index into DESKS, or -1 standing by the wall when every desk is taken. */
  desk: number
  path: Pt[]
  bubble?: { text: string; ticks: number }
  status: Status
  kind: ToolKind
  tool: string
  /** Ticks left before `done` or `error` calms down to `idle`. */
  calm: number
  /** Ticks left at the coffee machine; 0 when not on a coffee break. */
  coffee: number
  /** Ticks spent idle at the desk; a coffee break only comes after a while. */
  rest: number
  leaving: boolean
  /** Picks the apprentice's colours from LOOKS. */
  look: number
}
export type Office = { staff: Apprentice[] }

const grid: OTile[] = Array(OW * OH).fill('floor')
const titles: Record<number, string> = {}
const at = (x: number, y: number) => y * OW + x
const fill = (x0: number, y0: number, x1: number, y1: number, t: OTile) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[at(x, y)] = t
}

fill(0, 0, OW - 1, 0, 'wall'); fill(0, OH - 1, OW - 1, OH - 1, 'wall'); fill(0, 0, 0, OH - 1, 'wall'); fill(OW - 1, 0, OW - 1, OH - 1, 'wall')
for (const x of [4, 8, 30, 34]) grid[at(x, 0)] = 'window'
' OFFICE '.split('').forEach((c, k) => { titles[at(16 + k, 0)] = c })
fill(1, 5, OW - 2, 6, 'carpet')
grid[at(20, OH - 1)] = 'door'
grid[at(2, 1)] = 'coffee'
grid[at(OW - 3, 1)] = 'board'; grid[at(OW - 4, 1)] = 'board'
for (const [x, y] of [[1, 10], [OW - 2, 10], [12, 1], [26, 1]]) grid[at(x, y)] = 'plant'

/** Each desk's left cell (the screen); the keyboard is the cell to its right and the chair below the screen. */
export const DESKS: Pt[] = [3, 8].flatMap(y => [4, 11, 18, 25, 32].map(x => ({ x, y })))
for (const d of DESKS) { grid[at(d.x, d.y)] = 'desk'; grid[at(d.x + 1, d.y)] = 'desk' }
/** Where an apprentice sits at desk `k`, and where a visitor stands to talk with them. */
export const seat = (k: number): Pt => (k >= 0 ? { x: DESKS[k].x, y: DESKS[k].y + 1 } : { x: 5 + ((-k) % 12) * 2, y: OH - 2 })
export const visitSpot = (k: number): Pt => { const s = seat(k); return { x: s.x + 1, y: s.y } }
export const OFFICE_ENTRANCE: Pt = { x: 20, y: OH - 2 }
const COFFEE_SPOT: Pt = { x: 2, y: 2 }

const walkableIn = (x: number, y: number) => x >= 0 && y >= 0 && x < OW && y < OH && (grid[at(x, y)] === 'floor' || grid[at(x, y)] === 'carpet')

export function officePath(from: Pt, to: Pt): Pt[] {
  const prev = new Int32Array(OW * OH).fill(-2)
  const start = at(from.x, from.y)
  prev[start] = -1
  const queue = [start]
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]
    const p = { x: cur % OW, y: Math.floor(cur / OW) }
    if (p.x === to.x && p.y === to.y) {
      const path: Pt[] = []
      for (let c = cur; c !== start; c = prev[c]) path.unshift({ x: c % OW, y: Math.floor(c / OW) })
      return path
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = p.x + dx
      const ny = p.y + dy
      if (!walkableIn(nx, ny) || prev[at(nx, ny)] !== -2) continue
      prev[at(nx, ny)] = cur
      queue.push(at(nx, ny))
    }
  }
  return []
}

/** One interior tile, `void` outside the walls. */
export const officeTile = (x: number, y: number): OTile | 'void' => (x < 0 || y < 0 || x >= OW || y >= OH ? 'void' : grid[at(x, y)])
/** The letters of the sign over the room, for renderers that draw them as words. */
export const OFFICE_TITLE = { x: 16, y: 0, text: 'OFFICE' }

// ---------- the apprentices ----------

const NAMES = ['Ada', 'Alan', 'Grace', 'Linus', 'Ken', 'Barbara', 'Edsger', 'Margaret', 'Dennis', 'Radia', 'Guido', 'Hedy', 'Donald', 'Frances', 'Tim', 'Anita']
/** Hair, shirt and trousers per look; the terminal draws an apprentice in its shirt's colour. */
export const LOOKS: { hair: number; shirt: number; pants: number }[] = [
  { hair: 0x3e2723, shirt: 0x4fc3f7, pants: 0x37474f }, { hair: 0xffb74d, shirt: 0xaed581, pants: 0x5d4037 },
  { hair: 0x212121, shirt: 0xf06292, pants: 0x455a64 }, { hair: 0x8d6e63, shirt: 0xffd54f, pants: 0x3949ab },
  { hair: 0xbdbdbd, shirt: 0x9575cd, pants: 0x4e342e }, { hair: 0xd84315, shirt: 0x4db6ac, pants: 0x263238 },
  { hair: 0x5d4037, shirt: 0xff8a65, pants: 0x1a237e }, { hair: 0xfff176, shirt: 0x90a4ae, pants: 0x6d4c41 },
]
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0 }
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

const TYPING: Record<ToolKind, string[]> = {
  edit: ['tap tap tap', 'writing code...', 'one more line'],
  shell: ['running a command', 'whirr...', 'compiling!'],
  read: ['reading the code', 'hmm, interesting', 'looking around'],
  web: ['looking it up', 'searching the web'],
  agent: ['asking a helper', 'teamwork!'],
  other: ['busy busy', 'working on it'],
}
const IDLE = ['stretching...', '*sip*', 'waiting for the next task', 'hmm hm hmm']

export const toolKind = (tool: string): ToolKind => (/edit|write|notebook/i.test(tool) ? 'edit'
  : /bash|powershell|shell/i.test(tool) ? 'shell'
    : /read|grep|glob|lsp/i.test(tool) ? 'read'
      : /web|fetch|search/i.test(tool) ? 'web'
        : /agent|task|workflow/i.test(tool) ? 'agent' : 'other')

const say = (a: Apprentice, text: string, ticks = 30) => { a.bubble = { text, ticks } }
const goTo = (a: Apprentice, to: Pt) => { a.path = officePath(a, to) }
/** Whether the apprentice sits at their desk (facing the screen), not walking or on a break. */
export const atSeat = (a: Apprentice) => { const s = seat(a.desk); return a.x === s.x && a.y === s.y && !a.path.length }

/** A session connects: its apprentice comes in through the door and goes to a free desk. */
export function joinOffice(o: Office, id: string, about: { repo: string; branch: string }): Apprentice {
  const known = o.staff.find(a => a.id === id)
  if (known) {
    Object.assign(known, about)
    if (known.leaving) { known.leaving = false; goTo(known, seat(known.desk)) }
    return known
  }
  const taken = new Set(o.staff.map(a => a.desk))
  const free = DESKS.findIndex((_, k) => !taken.has(k))
  const standing = -1 - o.staff.filter(a => a.desk < 0).length
  const names = new Set(o.staff.map(a => a.name))
  const h = hash(id)
  const name = [...NAMES.slice(h % NAMES.length), ...NAMES].find(n => !names.has(n)) ?? `Intern ${o.staff.length + 1}`
  const a: Apprentice = {
    id, name, ...about, desk: free >= 0 ? free : standing, ...OFFICE_ENTRANCE, path: [],
    status: 'idle', kind: 'other', tool: '', calm: 0, coffee: 0, rest: 0, leaving: false, look: h % LOOKS.length,
  }
  goTo(a, seat(a.desk))
  say(a, about.repo ? `Hi! I'm on ${about.repo} today.` : 'Hi! Reporting for work.', 40)
  o.staff.push(a)
  return a
}

/** A session ends: its apprentice says goodbye and walks out; runOffice lets them go at the door. */
export function leaveOffice(o: Office, id: string) {
  const a = o.staff.find(s => s.id === id)
  if (!a || a.leaving) return
  a.leaving = true
  a.coffee = 0
  say(a, pick(['See you tomorrow!', 'Clocking out!', 'Bye everyone!']), 30)
  goTo(a, OFFICE_ENTRANCE)
}

/** What the apprentice's session is doing, as the session reports it. */
export type OfficeEvent =
  | { type: 'tool'; tool: string }
  | { type: 'turn'; seconds: number; outcome: 'answer' | 'aborted' | 'error' }
  | { type: 'tests'; passed: boolean }

export function officeWork(o: Office, id: string, e: OfficeEvent) {
  const a = o.staff.find(s => s.id === id)
  if (!a || a.leaving) return
  if (e.type === 'tool') {
    const kind = toolKind(e.tool)
    if (a.status !== 'working' || a.kind !== kind) say(a, pick(TYPING[kind]), 25)
    a.status = 'working'
    a.kind = kind
    a.tool = e.tool
    a.calm = 0
    if (a.coffee || !atSeat(a)) { a.coffee = 0; goTo(a, seat(a.desk)) }
  } else if (e.type === 'turn') {
    a.tool = ''
    if (e.outcome === 'answer') {
      a.status = 'done'
      a.calm = 60
      say(a, e.seconds >= 20 ? pick(['Phew, done!', 'Finished it!', 'Ta-da!']) : 'Done!', 30)
    } else if (e.outcome === 'aborted') {
      a.status = 'idle'
      say(a, 'Okay, stopping.', 25)
    } else {
      a.status = 'error'
      a.calm = 120
      say(a, 'Hmm, that broke...', 35)
    }
  } else {
    a.status = e.passed ? 'done' : 'error'
    a.calm = e.passed ? 80 : 120
    say(a, e.passed ? 'Tests are green!' : 'Tests are red...', 35)
  }
}

/** One tick of office life. */
export function runOffice(o: Office, tick: number) {
  for (const a of o.staff) {
    if (a.bubble && --a.bubble.ticks <= 0) a.bubble = undefined
    if (a.path.length) {
      if (tick % 2 === 0) { const next = a.path.shift()!; a.x = next.x; a.y = next.y }
      continue
    }
    if (a.leaving) continue
    if (a.calm > 0 && --a.calm === 0) a.status = 'idle'
    if (a.coffee > 0) {
      if (--a.coffee === 0) goTo(a, seat(a.desk))
      continue
    }
    if (!atSeat(a)) { goTo(a, seat(a.desk)); continue }
    a.rest = a.status === 'idle' ? a.rest + 1 : 0
    if (a.status === 'working') {
      if (!a.bubble && tick % 45 === 0 && Math.random() < 0.5) say(a, pick(TYPING[a.kind]), 20)
    } else if (a.status === 'idle' && a.rest > 400 && Math.random() < 0.003) {
      a.rest = 0
      a.coffee = 60
      goTo(a, COFFEE_SPOT)
      say(a, 'Coffee time!', 20)
    } else if (a.status === 'idle' && !a.bubble && Math.random() < 0.002) {
      say(a, pick(IDLE), 20)
    }
  }
  o.staff = o.staff.filter(a => !(a.leaving && !a.path.length && a.x === OFFICE_ENTRANCE.x && a.y === OFFICE_ENTRANCE.y))
}

/** How an apprentice describes their work, for a chat with Claude and the planner's prompt. */
export function workLine(a: Apprentice): string {
  const on = a.repo ? ` on ${a.repo}${a.branch ? ` (${a.branch})` : ''}` : ''
  if (a.status === 'working') return `I'm busy${on}, ${a.kind === 'edit' ? 'writing code' : a.kind === 'shell' ? 'running commands' : a.kind === 'read' ? 'reading code' : a.kind === 'web' ? 'searching the web' : a.kind === 'agent' ? 'with helpers' : 'working'}.`
  if (a.status === 'done') return `Just finished a task${on}!`
  if (a.status === 'error') return `Something went wrong${on}... I'll sort it out.`
  return `Waiting for the next task${on}.`
}

// ---------- drawing ----------

/** The screen on each desk, by desk index: its owner's status, or null for a free desk. */
export const deskStatus = (o: Office): (Status | null)[] => DESKS.map((_, k) => o.staff.find(a => a.desk === k && !a.leaving)?.status ?? null)

const FLOOR = [0xd7dde0, 0xcfd6da]
const CARPET = [0x5c6bc0, 0x5363b5]
const DESK_BG = 0x8d6e63

/** One interior cell: [code point, foreground, background]; outside the walls is dark. */
export function officeCell(x: number, y: number, desks: (Status | null)[], tick: number): [number, number, number] {
  const cp = (s: string) => s.codePointAt(0)!
  if (x < 0 || y < 0 || x >= OW || y >= OH) return [32, 0, 0x14171c]
  const i = at(x, y)
  const floor = FLOOR[(x + y) % 2]
  switch (grid[i]) {
    case 'wall': return titles[i] ? [cp(titles[i]), 0xeceff1, 0x37474f] : [32, 0, 0x37474f]
    case 'window': return [cp('▒'), 0x81d4fa, 0x37474f]
    case 'door': return [cp('▒'), 0x3e2723, 0x8d6e63]
    case 'carpet': return [32, 0, CARPET[(x + y) % 2]]
    case 'plant': return [cp('♣'), 0x2e7d32, floor]
    case 'coffee': return [cp('¤'), 0xffffff, 0x6d4c41]
    case 'board': return [cp('═'), 0x1565c0, 0xfafafa]
    case 'desk': {
      const k = DESKS.findIndex(d => d.x === x && d.y === y)
      if (k < 0) return [cp('═'), 0xd7ccc8, DESK_BG]
      const s = desks[k]
      if (s === 'working') return [cp('■'), tick % 6 < 3 ? 0x69f0ae : 0x00c853, DESK_BG]
      if (s === 'done') return [cp('*'), 0xffd54f, DESK_BG]
      if (s === 'error') return [cp('!'), tick % 8 < 4 ? 0xff5252 : 0xb71c1c, DESK_BG]
      if (s === 'idle') return [cp('■'), 0x607d8b, DESK_BG]
      return [cp('░'), 0xa1887f, DESK_BG]
    }
    default: return [32, 0, floor]
  }
}
