// The village simulation: map, villagers, their memories, the action queue and the frame drawn into a Raster.
// Pure logic, no `$`: register.tsx drives it.

import type { LogLine } from '../types'
import {
  BUGS, CROPS, DECOR, FISH_KINDS, FISH_SIZE, FOSSILS, isCrop, isFish, isProject, isSellable, KEEPSAKES, MUSEUM, MUSEUM_PIECES, MUSEUM_REWARD,
  PRICES, PROJECTS, RECIPES, SEASON_DAYS, SEASON_FESTIVALS, SEASONAL_FISH, SEASONS, SECTION_REWARD, SHOP, WANTS,
} from './catalog'
import type { BugHabitat, CropKind, ProjectId, Season } from './catalog'
import { CURATOR_SPOT, ENTRANCE, FACTS, hint, IH, indoorPath, IW, museumCell, viewSpot } from './museum'

export const W = 96
export const H = 24
export const VIEW_H = 18
/** HUD row + visible map rows + bag row. */
export const ROWS = VIEW_H + 2
export const MAX_VIEW = 80

export type Pt = { x: number; y: number }
type Tile =
  | 'grass' | 'tuft' | 'path' | 'plaza' | 'bridge' | 'water' | 'fountain' | 'tree' | 'apple'
  | 'roof' | 'wall' | 'door' | 'fence' | 'soil' | 'flower' | 'item'
type Crop = { stage: number; watered: boolean; kind?: CropKind }
type Bubble = { text: string; ticks: number }
type Mover = Pt & { path: Pt[]; bubble?: Bubble }
type Npc = Mover & { hold: number; cooldown: number; nap: number; chat: number; asleep: boolean }

export type VillagerId = 'tom' | 'rosa' | 'bruno' | 'pip' | 'mabel'
type Who = VillagerId | 'mochi' | 'kiki'
type Villager = {
  id: VillagerId
  name: string
  color: number
  home: string
  hangout: string
  likes: string[]
  personality: string
  lines: string[]
}

export const VILLAGERS: readonly Villager[] = [
  {
    id: 'tom', name: 'Tom', color: 0xff8a65, home: 'tomhouse', hangout: 'pond', likes: ['sea bass', 'koi', 'carp', 'bluegill', 'goldfish'],
    personality: 'easygoing fisherman next door, tells tall fishing stories',
    lines: ['Nice weather for fishing, yes?', 'I almost caught a koi this big!', 'Hello, neighbor!', 'The pond is calm today.'],
  },
  {
    id: 'rosa', name: 'Rosa', color: 0xf48fb1, home: 'florist', hangout: 'flowers', likes: ['flower'],
    personality: 'dreamy florist who talks about colors, scents and seasons',
    lines: ['The tulips smell lovely today.', 'Every flower has a story, you know.', 'Pink is the color of the week!', 'Hi there, sunshine!'],
  },
  {
    id: 'bruno', name: 'Bruno', color: 0xbcaaa4, home: 'workshop', hangout: 'bridge', likes: ['wood', 'apple'],
    personality: 'gruff but kind carpenter, always planning the next build',
    lines: ['That bridge needs a new plank.', 'Hmph. Good wood is hard to find.', 'Measure twice, cut once.', 'Oh. Hey.'],
  },
  {
    id: 'pip', name: 'Pip', color: 0x81c784, home: 'piphouse', hangout: 'orchard', likes: ['apple', 'goldfish', 'old boot'],
    personality: 'energetic kid who loves bugs, games, apples and silly jokes',
    lines: ['Tag, you are it!', 'I found a beetle! Wanna see?', 'Apples are the best food ever!', 'Hehe, hi Claude!'],
  },
  {
    id: 'mabel', name: 'Mabel', color: 0xce93d8, home: 'cafe', hangout: 'plaza', likes: ['turnip', 'apple', 'flower'],
    personality: 'warm old cafe owner who bakes turnip pie and remembers everyone',
    lines: ['Come by the cafe for pie, dear.', 'You look thin, have you eaten?', 'Back in my day this was all fields.', 'Hello, sweetheart!'],
  },
]
const IDS = VILLAGERS.map(v => v.id)
const villager = (id: VillagerId) => VILLAGERS.find(v => v.id === id)!

type WorkKind =
  | 'plant' | 'water' | 'harvest' | 'fish' | 'chop' | 'shake' | 'pick' | 'sell' | 'sleep' | 'pet' | 'gift' | 'buy' | 'trade'
  | 'shop' | 'cook' | 'fund' | 'donate' | 'place' | 'dig' | 'club' | 'pedal' | 'lock' | 'unlock'
export type Action =
  | { do: 'walk'; to: string }
  | { do: 'say'; text: string }
  | { do: 'npc_say'; who: Who; text: string }
  | { do: 'wait'; seconds: number }
  | { do: 'gift'; to: Who; item?: string; count?: number }
  | { do: 'remember'; who: 'claude' | VillagerId; text: string }
  | { do: 'search' }
  | { do: 'plant'; crop?: CropKind }
  | { do: 'shop'; item: string; count: number }
  | { do: 'cook'; recipe: string; count: number }
  | { do: 'fund'; project: ProjectId }
  | { do: 'donate' }
  | { do: 'place'; item: string; at?: string }
  | { do: 'catch'; bug?: string; count?: number }
  | { do: 'mail' }
  | { do: 'enter' }
  | { do: 'tour' }
  | { do: 'look'; item: string }
  | { do: 'exit' }
  | { do: Exclude<WorkKind, 'gift' | 'plant' | 'shop' | 'cook' | 'fund' | 'donate' | 'place'>; count?: number }

export type EventKind = 'rain' | 'merchant' | 'festival' | 'lost' | 'tournament' | 'meteor' | 'birthday' | 'season'
/** A happening of the day, from `start` to `end` in minutes after midnight. */
export type VillageEvent = {
  kind: EventKind
  start: number
  end: number
  started?: boolean
  ended?: boolean
  who?: VillagerId
  item?: string
  best?: string
  attended?: boolean
  /** The biggest fish of a contest, in cm. */
  size?: number
}
type Pickup = Pt & { item: string; kind: 'lost' | 'star' }
/** A villager asking for `amount` of an item today; `fish` means any fish. */
export type Request = { who: VillagerId; item: string; amount: number; given: number; reward: number; done?: boolean }
type Project = { bells: number; items: Record<string, number>; done: boolean }
/** `locked`: Claude has chained up the bikes, so nobody can pedal until he unlocks them. */
export type DataCenter = { battery: number; evil: boolean; duty: boolean; warned: boolean; locked: boolean }
type Critter = Pt & { kind: string; color: number; ttl: number; home: Pt }
export type Letter = { from: VillagerId; text: string; item?: string; count?: number; bells?: number; day: number; read?: boolean }
type Step =
  | Action
  | { do: '_goto'; x: number; y: number; npc?: Who }
  | { do: '_work'; kind: WorkKind; x: number; y: number; ticks: number; item?: string }
  | { do: '_hunt'; bug?: string; tries?: number }
  | { do: '_enter' }
  | { do: '_exit' }
  | { do: '_iwalk'; x: number; y: number }
  | { do: '_look'; piece: string }

export type Memory = { day: number; time: string; text: string; kind: 'event' | 'fact' | 'diary' }

export type World = {
  tiles: Tile[]
  deco: Record<number, [string, number]>
  paint: Record<number, [number, number]>
  crops: (Crop | null)[]
  fruit: Record<number, number>
  picked: number[]
  places: Record<string, Pt>
  player: Mover
  npcs: Record<VillagerId, Npc>
  mochi: Npc
  queue: Step[]
  current?: Step & { started?: boolean; left?: number }
  idle: number
  day: number
  minutes: number
  bells: number
  inv: Record<string, number>
  friendship: Record<string, number>
  memory: Record<string, Memory[]>
  diaryDue: number[]
  /** Conversations the diary call wrote for villagers to have, two lines each. */
  chatPool: { a: VillagerId; b: VillagerId; lines: [string, string] }[]
  /** Lines someone says a little later: the second half of a conversation. */
  later: { who: VillagerId; text: string; at: number }[]
  gazette: { day: number; headlines: string[] } | null
  /** How each villager feels today, -2 (sulking) to 2 (beaming). */
  mood: Record<string, number>
  /** The biggest of each fish Claude ever caught, in cm. */
  records: Record<string, number>
  /** What the real Claude Code session is doing, mirrored in the village. */
  echo: { kind: 'edit' | 'shell' | 'read' | 'web' | 'agent' | 'other'; tool: string; until: number } | null
  /** A villager just spoke to Claude: the replies on offer until `until`. */
  reply: PendingReply | null
  /** A villager asked to say more: the host asks the model for their answer. */
  askMore: { who: VillagerId; line: string } | null
  /** The day each villager last got a friendly reply, so replies cannot be farmed. */
  replied: Record<string, number>
  /** Whether the adults-only Velvet Club is part of this village (a setting). */
  adults: boolean
  cheer: number
  cloud: number
  /** Ticks left of the bomb factory's blast animation. */
  boom: number
  /** Ticks until Bruno has patched up the bomb factory after a blast. */
  rubble: number
  /** The AI data center: its battery (0-100), whether it has turned evil, and whether villagers are on pedal duty. */
  dc: DataCenter
  rainbow: number
  flash: number
  events: VillageEvent[]
  weather: 'clear' | 'rain'
  merchant?: Npc
  pickups: Pickup[]
  projects: Record<ProjectId, Project>
  museum: string[]
  decor: (Pt & { item: string })[]
  requests: Request[]
  critters: Critter[]
  digSpots: Pt[]
  mail: Letter[]
  /** The friendship tier each villager has written to Claude about. */
  milestones: Record<string, number>
  /** Where Claude is: out in the village, or inside the museum (`inside` is the position there). */
  scene: 'village' | 'museum'
  inside: Mover
  curator: Mover
  /** Headlines for the host to show as toasts. */
  announce: string[]
  tick: number
  thinking: boolean
  label: string
  log: LogLine[]
}

const idx = (x: number, y: number) => y * W + x
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H
const WALKABLE = new Set<Tile>(['grass', 'tuft', 'path', 'plaza', 'bridge', 'soil', 'flower'])
const walkable = (w: World, x: number, y: number) => inMap(x, y) && WALKABLE.has(w.tiles[idx(x, y)])
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]
const isVillager = (v: unknown): v is VillagerId => IDS.includes(v as VillagerId)

const PLACE_SPOTS: Record<string, Pt> = {
  home: { x: 12, y: 6 }, shop: { x: 40, y: 6 }, farm: { x: 8, y: 13 }, pond: { x: 68, y: 19 },
  orchard: { x: 23, y: 5 }, flowers: { x: 66, y: 7 }, plaza: { x: 50, y: 11 }, cafe: { x: 40, y: 15 },
  river: { x: 55, y: 13 }, bridge: { x: 61, y: 9 }, workshop: { x: 84, y: 6 }, florist: { x: 67, y: 6 },
  tomhouse: { x: 20, y: 15 }, piphouse: { x: 82, y: 15 }, board: { x: 47, y: 12 }, museum: { x: 27, y: 15 }, club: { x: 88, y: 15 },
  factory: { x: 68, y: 15 }, datacenter: { x: 37, y: 19 },
}
const APPLE_TREES = [[20, 3], [23, 2], [26, 4], [21, 6], [25, 7], [28, 2], [88, 20], [91, 21], [86, 13]]
const TREES = [
  [3, 20], [5, 21], [7, 20], [9, 22], [11, 21], [13, 20], [4, 22], [15, 22], [89, 19], [92, 20], [93, 22],
  [34, 7], [47, 4], [53, 3], [74, 4], [90, 13], [27, 12], [33, 21], [45, 21], [74, 14], [62, 13], [2, 4], [93, 6],
]
const FLOWERS = [
  [62, 6], [63, 7], [65, 6], [64, 7], [69, 6], [70, 7], [72, 6], [73, 7], [71, 6],
  [20, 20], [22, 21], [24, 20], [26, 21], [46, 7], [54, 7], [78, 20], [80, 21], [36, 20], [38, 21],
]
const WORK_TEXT: Record<WorkKind, string> = {
  plant: 'dig dig', water: 'splish~', harvest: 'pluck!', fish: '~ fishing ~', chop: 'chop! chop!',
  shake: 'shake shake', pick: '♪', sell: 'ka-ching', sleep: 'Zzz...', pet: 'pat pat', gift: 'here you go!', buy: 'hmm, this one!', trade: 'deal?',
  shop: 'let me see...', cook: 'smells great!', fund: 'for the village!', donate: 'for science!', place: 'right there!', dig: 'dig dig dig', club: '♪ ♫ ♪', pedal: 'pedal pedal!', lock: 'click!', unlock: 'click-clack',
}
const LABELS: Record<WorkKind, string> = {
  plant: 'planting', water: 'watering', harvest: 'harvesting', fish: 'fishing', chop: 'chopping wood',
  shake: 'shaking a tree', pick: 'picking flowers', sell: 'shopping', sleep: 'sleeping', pet: 'petting Mochi', gift: 'giving a gift', buy: 'shopping with Kiki', trade: 'trading with Kiki',
  shop: 'shopping', cook: 'cooking with Mabel', fund: 'funding a project', donate: 'at the museum', place: 'decorating', dig: 'digging', club: 'at the Velvet Club', pedal: 'pedaling for the data center', lock: 'locking the bikes', unlock: 'unlocking the bikes',
}
const IDLE_LINES = [
  'What a lovely day!', 'I should water the turnips...', 'Hmm hm hmm ♪', 'Mochi! Where are you?',
  'The river sparkles today.', 'I wonder what everyone is up to.', 'Smells like apples around here.',
]
const NIGHT_LINES = ['The stars are pretty tonight.', '*yawn*', 'Getting sleepy...']
const THANKS = ['Wow, for me?! Thanks!', 'Oh! How thoughtful!', "You're the best!", 'Aww, thank you!']
const REPLIES = ['Oh, hello!', 'Fancy meeting you here.', 'Lovely day, isn\'t it?', 'Hehe, hi!', 'Good to see you!']

// ---------- the map ----------

export function createWorld(): World {
  const tiles: Tile[] = Array(W * H).fill('grass')
  const deco: World['deco'] = {}
  const paint: World['paint'] = {}
  const set = (x: number, y: number, t: Tile) => { if (inMap(x, y)) tiles[idx(x, y)] = t }
  const rect = (x0: number, y0: number, x1: number, y1: number, t: Tile) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t)
  }
  const building = (x0: number, y0: number, x1: number, doorX: number, roof: number, wall: number, sign?: string) => {
    rect(x0, y0, x1, y0 + 1, 'roof')
    rect(x0, y0 + 2, x1, y0 + 3, 'wall')
    for (let y = y0; y <= y0 + 3; y++) for (let x = x0; x <= x1; x++) paint[idx(x, y)] = y < y0 + 2 ? [roof, roof] : [0, wall]
    set(doorX, y0 + 3, 'door')
    if (sign) {
      const sx = Math.round((x0 + x1 + 1 - sign.length) / 2)
      for (let i = 0; i < sign.length; i++) deco[idx(sx + i, y0 + 2)] = [sign[i], 0x5d4037]
    } else {
      deco[idx(x0 + 1, y0 + 2)] = ['■', 0x81d4fa]
      deco[idx(x1 - 1, y0 + 2)] = ['■', 0x81d4fa]
    }
  }

  for (let i = 0; i < W * H; i++) if ((Math.imul(i, 2654435761) >>> 0) % 97 < 9) tiles[i] = 'tuft'
  rect(0, 0, W - 1, 0, 'tree'); rect(0, H - 1, W - 1, H - 1, 'tree')
  rect(0, 0, 0, H - 1, 'tree'); rect(W - 1, 0, W - 1, H - 1, 'tree')

  // roads, river and bridges
  rect(2, 9, 93, 9, 'path'); rect(2, 18, 93, 18, 'path')
  rect(3, 9, 3, 18, 'path'); rect(31, 9, 31, 18, 'path'); rect(76, 9, 76, 18, 'path'); rect(92, 9, 92, 18, 'path')
  rect(57, 1, 59, 22, 'water')
  rect(57, 9, 59, 9, 'bridge'); rect(57, 18, 59, 18, 'bridge')

  // buildings and the paths to their doors
  building(8, 2, 16, 12, 0xb03a2e, 0xf5e6c8); rect(12, 6, 12, 8, 'path')
  building(36, 2, 45, 40, 0x4a90d9, 0xfff3d6, 'SHOP'); rect(40, 6, 40, 8, 'path')
  building(17, 11, 23, 20, 0x558b2f, 0xf1f8e9); rect(20, 15, 20, 17, 'path')
  building(36, 11, 44, 40, 0x8e44ad, 0xfdf2e9, 'CAFE'); rect(40, 15, 40, 17, 'path')
  building(63, 2, 71, 67, 0xd81b60, 0xfce4ec, 'FLOWERS'); rect(67, 6, 67, 8, 'path')
  building(80, 2, 89, 84, 0x6d4c41, 0xefebe9, 'WORKSHOP'); rect(84, 6, 84, 8, 'path')
  building(79, 11, 85, 82, 0xef6c00, 0xfff8e1); rect(82, 15, 82, 17, 'path')

  // farm, plaza, pond
  rect(5, 11, 12, 15, 'fence'); rect(6, 12, 11, 14, 'soil'); set(8, 15, 'path'); rect(8, 16, 8, 17, 'path')
  rect(46, 11, 54, 15, 'plaza'); set(50, 13, 'fountain'); rect(50, 6, 50, 10, 'path'); rect(50, 16, 50, 17, 'path')
  for (let y = 19; y <= 22; y++) {
    for (let x = 60; x <= 76; x++) if (((x - 68) / 6.5) ** 2 + ((y - 21) / 1.8) ** 2 <= 1) set(x, y, 'water')
  }
  for (const [x, y] of TREES) set(x, y, 'tree')
  for (const [x, y] of APPLE_TREES) set(x, y, 'apple')
  for (const [x, y] of FLOWERS) if (tiles[idx(x, y)] === 'grass' || tiles[idx(x, y)] === 'tuft') set(x, y, 'flower')

  // the mailbox by Claude's house
  set(MAILBOX.x, MAILBOX.y, 'item'); deco[idx(MAILBOX.x, MAILBOX.y)] = ['Π', 0xe53935]; paint[idx(MAILBOX.x, MAILBOX.y)] = [0, GRASS]
  // the community project board at the plaza
  set(47, 11, 'item'); deco[idx(47, 11)] = ['¶', 0x795548]; paint[idx(47, 11)] = [0, 0xd7ccc8]

  const fruit: Record<number, number> = {}
  for (const [x, y] of APPLE_TREES) fruit[idx(x, y)] = 3
  const crops: (Crop | null)[] = Array(W * H).fill(null)
  for (const [x, y] of [[6, 12], [7, 12], [8, 13]]) crops[idx(x, y)] = { stage: 2, watered: false, kind: 'turnip' }

  const w: World = {
    tiles, deco, paint, crops, fruit, picked: [], places: {},
    player: { x: 12, y: 6, path: [] },
    npcs: {} as Record<VillagerId, Npc>,
    mochi: { x: 14, y: 7, path: [], hold: 0, cooldown: 0, nap: 0, chat: 0, asleep: false },
    queue: [], idle: 0, day: 1, minutes: 8 * 60, bells: 100, inv: { turnip: 1 },
    friendship: Object.fromEntries(IDS.map(id => [id, 0])), memory: { claude: [], ...Object.fromEntries(IDS.map(id => [id, []])) },
    diaryDue: [], chatPool: [], later: [], gazette: null, mood: {}, records: {},
    echo: null, reply: null, askMore: null, replied: {}, adults: false, cheer: 0, cloud: 0, boom: 0, rubble: 0, dc: { battery: 80, evil: false, duty: false, warned: false, locked: false }, rainbow: 0, flash: 0, events: [], weather: 'clear', pickups: [], announce: [],
    projects: Object.fromEntries(Object.keys(PROJECTS).map(id => [id, { bells: 0, items: {}, done: false }])) as Record<ProjectId, Project>,
    museum: [], decor: [], requests: [], critters: [], digSpots: [], mail: [], milestones: {},
    scene: 'village', inside: { ...ENTRANCE, path: [] }, curator: { ...CURATOR_SPOT, path: [] },
    tick: 0, thinking: false, label: 'strolling', log: [],
  }
  for (const [name, spot] of Object.entries(PLACE_SPOTS)) w.places[name] = nearestWalkable(w, spot)
  for (const v of VILLAGERS) {
    const at = w.places[v.home]
    w.npcs[v.id] = { x: at.x, y: at.y, path: [], hold: 0, cooldown: 60 + Math.floor(Math.random() * 200), nap: 0, chat: 200, asleep: false }
  }
  scheduleDay(w)
  return w
}

function nearestWalkable(w: World, p: Pt): Pt {
  for (let r = 0; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) === r && walkable(w, p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy }
      }
    }
  }
  return p
}

// ---------- memory ----------

const LIMITS: Record<Memory['kind'], number> = { event: 40, fact: 25, diary: 20 }

export function remember(w: World, who: string, text: string, kind: Memory['kind'] = 'event') {
  const list = (w.memory[who] ??= [])
  const clean_ = clean(text, 200)
  if (!clean_ || list.some(m => m.kind === kind && m.text === clean_ && m.day === w.day)) return
  list.push({ day: w.day, time: clock(w), text: clean_, kind })
  const ofKind = list.filter(m => m.kind === kind)
  if (ofKind.length > LIMITS[kind]) list.splice(list.indexOf(ofKind[0]), 1)
}

const nameOf = (who: string) =>
  who === 'claude' ? 'Claude' : who === 'mochi' ? 'Mochi' : who === 'kiki' ? 'Kiki' : villager(who as VillagerId).name

/** Everyone within earshot of `at` remembers a line `speaker` said. */
function overhear(w: World, speaker: string, at: Pt, text: string) {
  if (speaker !== 'claude' && dist(w.player, at) <= 5) remember(w, 'claude', `${nameOf(speaker)} said: "${text}"`)
  for (const id of IDS) {
    if (id === speaker || w.npcs[id].asleep || dist(w.npcs[id], at) > 5) continue
    remember(w, id, `${nameOf(speaker)} said: "${text}"`)
  }
}

export function memoryText(w: World, who: string, recent: number): string {
  const list = w.memory[who] ?? []
  const facts = list.filter(m => m.kind === 'fact').map(m => `- ${m.text}`)
  const diary = list.filter(m => m.kind === 'diary').slice(-4).map(m => `- Day ${m.day}: ${m.text}`)
  const events = list.filter(m => m.kind === 'event').slice(-recent).map(m => `- Day ${m.day} ${m.time}: ${m.text}`)
  return [
    facts.length ? `  Knows:\n${facts.join('\n')}` : '',
    diary.length ? `  Diary:\n${diary.join('\n')}` : '',
    events.length ? `  Recently:\n${events.join('\n')}` : '',
  ].filter(Boolean).join('\n').replace(/^- /gm, '    - ') || '  (no memories yet)'
}

/** The prompt that turns a finished day's events into diary entries and lasting facts, or null when nothing happened. */
export function diaryPrompt(w: World, day: number): string | null {
  const parts: string[] = []
  for (const who of ['claude', ...IDS]) {
    const events = (w.memory[who] ?? []).filter(m => m.kind === 'event' && m.day === day)
    if (events.length === 0) continue
    const about = who === 'claude' ? 'the cheerful villager the player guides' : villager(who as VillagerId).personality
    parts.push(`## ${who} (${nameOf(who)}, ${about})\n${events.map(m => `- ${m.time} ${m.text}`).join('\n')}`)
  }
  if (parts.length === 0) return null
  const writers = IDS.filter(id => (w.friendship[id] ?? 0) >= 3).map(id => villager(id).name)
  return `Day ${day} in the village just ended. For each character below, write a diary entry in their own voice (1-2 sentences, first person) and 0-2 lasting facts worth remembering for weeks (likes, promises, relationships, what the player told them).
Answer ONLY with JSON like {"claude":{"diary":"...","facts":["..."]},"tom":{"diary":"...","facts":[]}}, one key per character listed.
Also add these top-level keys:
"chats": up to 3 short conversations two villagers (tom, rosa, bruno, pip, mabel) might have tomorrow about today's happenings - gossip, teasing and rumours welcome - as {"a":"tom","b":"rosa","lines":["what a says","what b answers"]}, each line at most 60 characters. Never bring Pip, a child, into anything about the Velvet Club.
"gazette": 2-3 punchy, funny village newspaper headlines about today, at most 60 characters each.
"letters": ${writers.length ? `0-2 warm letters to Claude, only from villagers who did something with Claude today, chosen from ${writers.join(', ')}, as {"from":"rosa","text":"at most 200 characters, signed with their name"}` : 'an empty list'}.

${parts.join('\n\n')}`
}

/** Gossip, letters and the morning paper that ride on the diary call. */
function readExtras(w: World, day: number, parsed: Record<string, unknown>) {
  const pipSafe = (lines: string[]) => !lines.some(l => /velvet|club/i.test(l))
  if (Array.isArray(parsed.chats)) {
    for (const c of parsed.chats.slice(0, 3) as { a?: unknown; b?: unknown; lines?: unknown }[]) {
      if (!isVillager(c?.a) || !isVillager(c?.b) || c.a === c.b || !Array.isArray(c.lines) || c.lines.length < 2) continue
      const lines = [clean(String(c.lines[0]), 90), clean(String(c.lines[1]), 90)] as [string, string]
      if ((c.a === 'pip' || c.b === 'pip') && !pipSafe(lines)) continue
      w.chatPool.push({ a: c.a, b: c.b, lines })
    }
    w.chatPool = w.chatPool.slice(-8)
  }
  if (Array.isArray(parsed.gazette)) {
    const headlines = parsed.gazette.filter((h): h is string => typeof h === 'string').slice(0, 3).map(h => clean(h, 70))
    if (headlines.length) {
      w.gazette = { day, headlines }
      w.announce.push(`The Village Gazette: ${headlines[0]}`)
      for (const h of headlines) w.log.push({ who: 'event', text: `Gazette: ${h}` })
      for (const h of headlines) rememberAll(w, `The Gazette wrote: "${h}"`)
    }
  }
  if (Array.isArray(parsed.letters)) {
    for (const l of parsed.letters.slice(0, 2) as { from?: unknown; text?: unknown }[]) {
      if (!isVillager(l?.from) || typeof l.text !== 'string' || (w.friendship[l.from] ?? 0) < 3) continue
      w.mail.push({ from: l.from, text: clean(l.text, 240), day: w.day })
      remember(w, l.from, `I wrote Claude a letter: "${clean(l.text, 120)}"`)
    }
  }
}

export const DIARY_SYSTEM = 'You keep the diaries of characters in a cozy village game. Answer only with JSON.'

export function applyDiary(w: World, day: number, reply: string | null) {
  let parsed: Record<string, { diary?: unknown; facts?: unknown }> = {}
  if (reply) {
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    try { parsed = JSON.parse(reply.slice(start, end + 1)) } catch { parsed = {} }
  }
  readExtras(w, day, parsed as Record<string, unknown>)
  for (const who of ['claude', ...IDS]) {
    const events = (w.memory[who] ?? []).filter(m => m.kind === 'event' && m.day === day)
    if (events.length === 0) continue
    const entry = parsed[who]
    const diary = typeof entry?.diary === 'string' ? entry.diary : events.slice(0, 3).map(m => m.text).join(' ')
    w.memory[who].push({ day, time: '23:59', text: clean(diary, 240), kind: 'diary' })
    if (Array.isArray(entry?.facts)) for (const f of entry.facts.slice(0, 2)) if (typeof f === 'string') remember(w, who, f, 'fact')
    // the diary now carries that day; keep only the last two days of raw events
    w.memory[who] = w.memory[who].filter(m => m.kind !== 'event' || m.day > day - 2)
    const diaries = w.memory[who].filter(m => m.kind === 'diary')
    if (diaries.length > LIMITS.diary) w.memory[who].splice(w.memory[who].indexOf(diaries[0]), 1)
  }
}

/** Every remembered line, for the memory view. */
export function memoryLines(w: World): LogLine[] {
  const lines: LogLine[] = []
  for (const who of ['claude', ...IDS]) {
    const list = w.memory[who] ?? []
    const facts = list.filter(m => m.kind === 'fact').slice(-3).map(m => m.text)
    const diary = list.filter(m => m.kind === 'diary').slice(-1).map(m => `Day ${m.day}: ${m.text}`)
    const last = list.filter(m => m.kind === 'event').slice(-1).map(m => m.text)
    const heart = who === 'claude' ? '' : ` ♥${w.friendship[who] ?? 0}`
    const text = [...diary, ...facts, ...(diary.length ? [] : last)].join(' · ') || 'nothing yet'
    lines.push({ who, text: `${heart ? heart.trim() + ' ' : ''}${text}` })
  }
  return lines
}

// ---------- persistence ----------

export function snapshot(w: World) {
  return {
    version: 2, chatPool: w.chatPool, gazette: w.gazette, mood: w.mood, records: w.records, mail: w.mail, milestones: w.milestones, digSpots: w.digSpots, projects: w.projects, dc: w.dc, museum: w.museum, decor: w.decor, requests: w.requests, events: w.events, weather: w.weather, pickups: w.pickups, hasMerchant: !!w.merchant, crops: w.crops, fruit: w.fruit, picked: w.picked, day: w.day, minutes: w.minutes, bells: w.bells,
    inv: w.inv, friendship: w.friendship, memory: w.memory, diaryDue: w.diaryDue, player: { x: w.player.x, y: w.player.y },
  }
}

export function restore(w: World, raw: unknown) {
  const s = raw as (Partial<ReturnType<typeof snapshot>> & { friendship?: unknown }) | null
  if (!s || typeof s !== 'object') return
  if (typeof s.day === 'number') w.day = s.day
  if (typeof s.minutes === 'number') w.minutes = s.minutes
  if (typeof s.bells === 'number') w.bells = s.bells
  if (s.inv) w.inv = s.inv
  if (typeof s.friendship === 'number') w.friendship.tom = s.friendship
  if (s.version !== 2) return
  if (s.friendship && typeof s.friendship === 'object') Object.assign(w.friendship, s.friendship)
  if (s.memory) Object.assign(w.memory, s.memory)
  if (Array.isArray(s.diaryDue)) w.diaryDue = s.diaryDue
  if (Array.isArray(s.events) && s.events.length) w.events = s.events
  if (s.weather === 'rain' || s.weather === 'clear') w.weather = s.weather
  if (Array.isArray(s.pickups)) w.pickups = s.pickups
  if (s.hasMerchant) spawnMerchant(w)
  if (Array.isArray(s.crops) && s.crops.length === W * H) w.crops = s.crops
  if (s.fruit) w.fruit = s.fruit
  if (Array.isArray(s.picked)) {
    w.picked = s.picked
    for (const i of s.picked) w.tiles[i] = 'grass'
  }
  if (s.projects) {
    for (const id of Object.keys(PROJECTS) as ProjectId[]) {
      if (!s.projects[id]) continue
      w.projects[id] = s.projects[id]
      if (w.projects[id].done && (id !== 'club' || w.adults)) applyProject(w, id)
    }
  }
  if (s.dc && typeof s.dc.battery === 'number') w.dc = { ...w.dc, ...s.dc, battery: Math.max(0, Math.min(100, s.dc.battery)) }
  if (Array.isArray(s.museum)) w.museum = s.museum
  if (Array.isArray(s.mail)) w.mail = s.mail
  if (Array.isArray(s.chatPool)) w.chatPool = s.chatPool
  if (s.gazette) w.gazette = s.gazette
  if (s.mood) w.mood = s.mood
  if (s.records) w.records = s.records
  if (s.milestones) w.milestones = s.milestones
  if (Array.isArray(s.digSpots)) w.digSpots = s.digSpots
  if (Array.isArray(s.requests)) w.requests = s.requests
  if (Array.isArray(s.decor)) for (const d of s.decor) if (placeThing(w, d.x, d.y, ...DECOR[d.item])) w.decor.push(d)
  if (s.player && walkable(w, s.player.x, s.player.y)) { w.player.x = s.player.x; w.player.y = s.player.y }
}

// ---------- path finding ----------

function bfs(w: World, from: Pt, goal: (p: Pt) => boolean): Pt[] | null {
  const prev = new Int32Array(W * H).fill(-2)
  const start = idx(from.x, from.y)
  prev[start] = -1
  const queue = [start]
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]
    const p = { x: cur % W, y: Math.floor(cur / W) }
    if (goal(p)) {
      const path: Pt[] = []
      for (let c = cur; c !== start; c = prev[c]) path.unshift({ x: c % W, y: Math.floor(c / W) })
      return path
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = p.x + dx
      const ny = p.y + dy
      if (!walkable(w, nx, ny) || prev[idx(nx, ny)] !== -2) continue
      prev[idx(nx, ny)] = cur
      queue.push(idx(nx, ny))
    }
  }
  return null
}

/** Path to `target`, or next to it when it cannot be stood on. */
function pathTo(w: World, from: Pt, target: Pt): Pt[] | null {
  if (walkable(w, target.x, target.y)) return bfs(w, from, p => p.x === target.x && p.y === target.y)
  return bfs(w, from, p => dist(p, target) === 1)
}

function nearestTile(w: World, from: Pt, test: (i: number) => boolean): Pt | null {
  let best: Pt | null = null
  for (let i = 0; i < W * H; i++) {
    if (!test(i)) continue
    const p = { x: i % W, y: Math.floor(i / W) }
    const isInner = p.x > 0 && p.y > 0 && p.x < W - 1 && p.y < H - 1
    if (isInner && (!best || dist(from, p) < dist(from, best))) best = p
  }
  return best
}

// ---------- the agent's plan ----------

const CLUB_RULES = `{"do":"club"}    spends an evening at the Velvet Club (adults-only strip club, once built, open 21:00-03:00; about 150 Bells)
Keep anything about the Velvet Club tasteful and non-explicit (music, neon, dancing, chatting at the bar), and never involve Pip, who is a child.`

/** The planner's instructions; the club's lines only where the club is allowed. */
export const systemPrompt = (w: World) => (w.adults ? `${SYSTEM}\n${CLUB_RULES}` : SYSTEM)

export const SYSTEM = `You are Claude, a cheerful villager in a cozy Animal-Crossing / Stardew-Valley style village.
The player types a wish; you answer ONLY with a JSON array of actions (max 12), no prose, no code fence.
Actions:
{"do":"walk","to":"home|shop|farm|pond|orchard|flowers|plaza|cafe|river|bridge|workshop|florist|tomhouse|piphouse|board|museum|datacenter|tom|rosa|bruno|pip|mabel|mochi"}
{"do":"say","text":"<= 60 chars, shown in your speech bubble"}
{"do":"npc_say","who":"tom|rosa|bruno|pip|mabel|mochi","text":"<= 60 chars, what that villager answers, in their own voice"}
{"do":"plant","crop":"turnip|carrot|strawberry|pumpkin"}  plants on every empty farm soil; turnip seeds are free, other seeds come from the shop
{"do":"water"}   waters all crops (watered crops grow every day until ripe)
{"do":"harvest"} harvests ripe crops
{"do":"fish"}    fishes once at the pond
{"do":"chop"}    chops wood from the nearest tree
{"do":"shake"}   shakes apples from an apple tree
{"do":"pick"}    picks a flower
{"do":"sell"}    sells the whole bag at the shop for Bells
{"do":"gift","to":"tom|rosa|bruno|pip|mabel|mochi","item":"<an item from the bag>","count":1}
{"do":"shop","item":"<shop item>","count":1}   buys at the shop with Bells (seeds, tools, decorations)
{"do":"cook","recipe":"<recipe>","count":1}   Mabel cooks at the cafe from your ingredients; dishes sell well and everyone loves them as gifts
{"do":"fund","project":"benches|park|lamps|pier|museum|factory|datacenter"}   pays Bells and materials toward a community project at the plaza board (the bomb factory makes fireworks and blows up now and then)
{"do":"lock"} / {"do":"unlock"}   chains up / frees the data center's bikes; while they are locked nobody can pedal, so the battery runs flat and the data center turns evil
{"do":"pedal"}   rides one of the fixed bikes at the AI data center (once built) to charge its battery; kept above half it is kind and computes Bells and apples, run flat it turns evil and blows up the bomb factory
{"do":"donate"}  donates every new fish, star fragment and boot to the museum (once it is built)
{"do":"place","item":"<decoration from the bag>","at":"<place>"}   sets a decoration down outside
{"do":"catch","bug":"<bug kind or any>"}   catches a nearby bug with the bug net (bugs depend on season, time and place)
{"do":"dig"}     digs up the nearest cracked spot with the shovel (fossils, gems, buried Bells)
{"do":"mail"}    goes home and reads the letters in the mailbox (villagers often send gifts)
{"do":"tour"}    goes inside the museum (once built) and walks past every donated piece while Hoot the curator explains it
{"do":"look","item":"<museum piece>"}   goes inside the museum to one case; for a missing piece Hoot tells where to find it
{"do":"enter"} / {"do":"exit"}   go into / out of the museum (other actions leave it by themselves)
{"do":"pet"}     pets Mochi the cat
{"do":"sleep"}   goes home and sleeps until the next morning
{"do":"wait","seconds":3}
{"do":"remember","who":"claude|tom|rosa|bruno|pip|mabel","text":"a lasting fact this character should keep"}
{"do":"buy"}     buys a lucky charm (500 Bells) from Kiki, the traveling merchant, while she is in town (everyone loves a lucky charm as a gift)
{"do":"trade"}   sells the whole bag to Kiki for 1.5x the shop price, while she is in town
{"do":"search"}  walks to a lost item or a fallen star fragment and picks it up
Kiki can be walked to ("to":"kiki") and talked for ("who":"kiki") while she is in town.
Today's events (below) are what makes this day special: take part, help out, and talk about them.
The world changes with the seasons (crops do not grow in winter; each season has its own fish, bugs and festival).
Bells and items have uses (below): grow better crops, cook dishes, build community projects, fill the museum,
decorate the village and answer villager requests (gift them what they ask for; it pays well).
Every character has a memory (below). Use it: refer back to earlier days, keep promises, give villagers things they like,
and greet friends warmly. When the player tells you something worth keeping, add a "remember" action.
Walk to a villager before talking with them. Speak in the user's language, warm and playful. Answer questions with "say".`

export function summary(w: World, wish: string): string {
  const crops = w.crops.filter(Boolean) as Crop[]
  const ripe = crops.filter(c => c.stage >= 3).length
  const dry = crops.filter(c => !c.watered && c.stage < 3).length
  const kinds = Object.entries(crops.reduce<Record<string, number>>((n, c) => ({ ...n, [c.kind ?? 'turnip']: (n[c.kind ?? 'turnip'] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${n} ${k}`).join(', ')
  const empty = w.tiles.filter((t, i) => t === 'soil' && !w.crops[i]).length
  const apples = Object.values(w.fruit).filter(n => n > 0).length
  const bag = Object.entries(w.inv).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'empty'
  const where = (p: Pt) => Object.entries(w.places).sort(([, a], [, b]) => dist(a, p) - dist(b, p))[0][0]
  const people = VILLAGERS.map(v => {
    const n = w.npcs[v.id]
    const mood = w.mood[v.id] ?? 0
    const feeling = mood <= -2 ? 'sulking (a visit and a gift would cheer them up)' : mood < 0 ? 'a bit down' : mood > 0 ? 'happy' : 'fine'
    return `### ${v.name} (${v.id}): ${v.personality}. Likes: ${v.likes.join(', ')}. Friendship ${w.friendship[v.id] ?? 0}. Mood: ${feeling}. `
      + `Now ${n.asleep ? 'asleep at home' : `near the ${where(n)}`}, ${dist(n, w.player)} steps away.\n${memoryText(w, v.id, 3)}`
  })
  return [
    `Day ${w.day}, ${clock(w)}. ${w.scene === 'museum' ? 'You are inside the museum.' : `You are near the ${where(w.player)}.`} Bells: ${w.bells}. Bag: ${bag}.`,
    `## Season and nature\n${natureText(w)}`,
    `Farm: ${crops.length} crops${kinds ? ` (${kinds})` : ''}, ${ripe} ripe, ${dry} need water, ${empty} empty soil. Apple trees with fruit: ${apples}.`,
    `## What Bells and items are for\n${economyText(w)}`,
    `## Today's events\n${eventsText(w)}`,
    `## Your memory\n${memoryText(w, 'claude', 12)}`,
    `## Villagers\n${people.join('\n')}`,
    `The player wishes: ${wish}`,
  ].join('\n')
}

type SimpleWork = Exclude<WorkKind, 'gift' | 'plant' | 'shop' | 'cook' | 'fund' | 'donate' | 'place'>
const WORK = new Set<string>(['water', 'harvest', 'fish', 'chop', 'shake', 'pick', 'sell', 'sleep', 'pet', 'buy', 'trade'])

const amount = (v: unknown) => Math.min(20, Math.max(1, Math.round(Number(v)) || 1))

export function parseActions(text: string): Action[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let raw: unknown
  try { raw = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(raw)) return []
  const out: Action[] = []
  for (const a of raw.slice(0, 16)) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const kind = String(o.do ?? '')
    const to = String(o.to ?? '')
    const who = String(o.who ?? '')
    if (kind === 'walk' && (to in PLACE_SPOTS || isVillager(to) || to === 'mochi' || to === 'kiki')) out.push({ do: 'walk', to })
    else if (kind === 'say' && typeof o.text === 'string') out.push({ do: 'say', text: o.text })
    else if (kind === 'npc_say' && typeof o.text === 'string' && (isVillager(who) || who === 'mochi' || who === 'kiki')) out.push({ do: 'npc_say', who, text: o.text })
    else if (kind === 'wait') out.push({ do: 'wait', seconds: Math.min(10, Math.max(1, Number(o.seconds) || 2)) })
    else if (kind === 'gift' && (isVillager(to) || to === 'mochi')) out.push({ do: 'gift', to, item: typeof o.item === 'string' ? o.item : undefined, count: amount(o.count) })
    else if (kind === 'remember' && typeof o.text === 'string' && (isVillager(who) || who === 'claude')) out.push({ do: 'remember', who, text: o.text })
    else if (kind === 'search') out.push({ do: 'search' })
    else if (kind === 'plant') out.push(isCrop(o.crop) ? { do: 'plant', crop: o.crop } : { do: 'plant' })
    else if (kind === 'shop' && typeof o.item === 'string' && o.item in SHOP) out.push({ do: 'shop', item: o.item, count: amount(o.count) })
    else if (kind === 'cook' && typeof o.recipe === 'string' && o.recipe in RECIPES) out.push({ do: 'cook', recipe: o.recipe, count: amount(o.count) })
    else if (kind === 'fund' && isProject(o.project)) out.push({ do: 'fund', project: o.project })
    else if (kind === 'donate') out.push({ do: 'donate' })
    else if (kind === 'catch') out.push({ do: 'catch', bug: typeof o.bug === 'string' && o.bug in BUGS ? o.bug : undefined, count: o.count === undefined ? undefined : amount(o.count) })
    else if (kind === 'dig') out.push({ do: 'dig' })
    else if (kind === 'club') out.push({ do: 'club' })
    else if (kind === 'pedal') out.push({ do: 'pedal' })
    else if (kind === 'lock' || kind === 'unlock') out.push({ do: kind })
    else if (kind === 'mail') out.push({ do: 'mail' })
    else if (kind === 'enter' || kind === 'tour' || kind === 'exit') out.push({ do: kind })
    else if (kind === 'look' && typeof o.item === 'string' && MUSEUM_PIECES.includes(o.item)) out.push({ do: 'look', item: o.item })
    else if (kind === 'place' && typeof o.item === 'string' && o.item in DECOR) {
      out.push({ do: 'place', item: o.item, at: typeof o.at === 'string' && o.at in PLACE_SPOTS ? o.at : undefined })
    }
    else if (WORK.has(kind)) out.push(o.count === undefined ? { do: kind as SimpleWork } : { do: kind as SimpleWork, count: amount(o.count) })
  }
  return out
}

/** Replaces whatever the villager was idly doing with the player's plan. */
export function enqueue(w: World, actions: Action[]) {
  w.queue = [...actions]
  w.current = undefined
  w.player.path = []
  w.idle = 0
}

/** Notes the player's wish in Claude's memory. */
export function heardWish(w: World, wish: string) {
  remember(w, 'claude', `The player asked me: "${wish}"`)
}

export function sayPlayer(w: World, text: string) {
  w.player.bubble = { text: clean(text, 90), ticks: bubbleTicks(text) }
  w.log.push({ who: 'claude', text: clean(text, 200) })
}

// ---------- simulation ----------

const bubbleTicks = (text: string) => 22 + Math.min(60, Math.round(text.length * 0.9))
export const clock = (w: World) => {
  const m = Math.floor(w.minutes / 10) * 10
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function newDay(w: World) {
  for (const e of w.events) if (e.started && !e.ended) endEvent(w, e)
  for (const r of w.requests) if (!r.done && r.given === 0) feel(w, r.who, -1, `Claude never brought the ${r.item} I asked for.`)
  for (const id of IDS) {
    const m = w.mood[id] ?? 0
    if (m > 0) w.mood[id] = m - 1
    else if (m < 0 && w.day % 2 === 0) w.mood[id] = m + 1
  }
  w.diaryDue.push(w.day)
  w.day += 1
  w.minutes = 6 * 60
  for (const c of w.crops) {
    if (c && c.watered && c.stage < 3 && season(w) !== 'winter') c.stage = Math.min(3, c.stage + CROPS[c.kind ?? 'turnip'].growth)
    if (c) c.watered = false
  }
  for (const k of Object.keys(w.fruit)) w.fruit[+k] = Math.min(3, w.fruit[+k] + 1)
  for (const i of w.picked) w.tiles[i] = 'flower'
  w.picked = []
  w.log.push({ who: 'event', text: `A new day begins - Day ${w.day}.` })
  newSeasonDay(w)
  scheduleDay(w)
}

function moveAlong(m: Mover) {
  const next = m.path.shift()
  if (next) { m.x = next.x; m.y = next.y }
}

function decay(m: Mover) {
  if (m.bubble && --m.bubble.ticks <= 0) m.bubble = undefined
}

function npcSay(w: World, who: Who, text: string, isPlanned = false) {
  const npc = npcOf(w, who)
  if (!npc) return
  npc.bubble = { text: clean(text, 90), ticks: bubbleTicks(text) }
  npc.hold = Math.max(npc.hold, 30)
  npc.asleep = false
  w.log.push({ who, text: clean(text, 200) })
  if (who === 'mochi' || who === 'kiki') return
  if (isPlanned) remember(w, who, `I told Claude: "${text}"`)
  overhear(w, who, npc, text)
}

function npcOf(w: World, who: Who): Npc | undefined {
  return who === 'mochi' ? w.mochi : who === 'kiki' ? w.merchant : w.npcs[who]
}

/** Expands a work action into walking plus working steps, from the world as it is now. */
function expand(w: World, a: Step): Step[] {
  const p = w.player
  const go = (t: Pt): Step => ({ do: '_goto', x: t.x, y: t.y })
  const work = (kind: WorkKind, t: Pt, ticks: number, item?: string): Step => ({ do: '_work', kind, x: t.x, y: t.y, ticks, item })
  const farmTiles = (test: (i: number) => boolean) => {
    const list: Pt[] = []
    for (let y = 12; y <= 14; y++) {
      const xs = y % 2 ? [11, 10, 9, 8, 7, 6] : [6, 7, 8, 9, 10, 11]
      for (const x of xs) if (test(idx(x, y))) list.push({ x, y })
    }
    return list
  }
  const none = (text: string): Step[] => [{ do: 'say', text }]
  const leave: Step[] = [{ do: '_iwalk', ...ENTRANCE }, { do: '_exit' }]
  const goIn: Step[] = w.scene === 'museum' ? [] : [go(w.places.museum), { do: '_enter' }]
  if (w.scene === 'museum' && !INDOOR.has(a.do)) return [...leave, a]
  switch (a.do) {
    case 'enter': {
      if (!w.projects.museum.done) return none("There's no museum yet - we could fund one at the plaza board.")
      return goIn
    }
    case 'exit': return w.scene === 'museum' ? leave : []
    case 'tour': {
      if (!w.projects.museum.done) return none("There's no museum yet - we could fund one at the plaza board.")
      const shown = MUSEUM_PIECES.filter(m => w.museum.includes(m))
      const missing = MUSEUM_PIECES.filter(m => !w.museum.includes(m))
      const steps: Step[] = shown.flatMap(m => [{ do: '_iwalk', ...viewSpot(m) } as Step, { do: '_look', piece: m } as Step])
      if (!shown.length) steps.push({ do: '_look', piece: '' })
      const tip = missing.length ? pick(missing) : undefined
      if (tip) steps.push({ do: '_iwalk', ...viewSpot(tip) }, { do: '_look', piece: tip })
      return [...goIn, ...steps]
    }
    case 'look': {
      if (!w.projects.museum.done) return none("There's no museum yet - we could fund one at the plaza board.")
      return [...goIn, { do: '_iwalk', ...viewSpot(a.item) }, { do: '_look', piece: a.item }]
    }
    case 'walk': {
      if (isVillager(a.to) || a.to === 'mochi' || a.to === 'kiki') {
        const n = npcOf(w, a.to)
        if (!n) return none("Kiki isn't in town today.")
        return [{ do: '_goto', x: n.x, y: n.y, npc: a.to }]
      }
      return [go(w.places[a.to] ?? w.places.plaza)]
    }
    case 'plant': {
      if (season(w) === 'winter') return none('Too cold to plant now - wait for spring!')
      const crop = a.crop ?? 'turnip'
      const seeds = CROPS[crop].seeds
      let tiles = farmTiles(i => w.tiles[i] === 'soil' && !w.crops[i])
      if (seeds) tiles = tiles.slice(0, w.inv[seeds] ?? 0)
      if (tiles.length) return tiles.flatMap(t => [go(t), work('plant', t, 4, crop)])
      return none(seeds && !(w.inv[seeds] ?? 0) ? `I need ${seeds} from the shop first.` : 'The field is already full!')
    }
    case 'water': {
      const tiles = farmTiles(i => !!w.crops[i] && !w.crops[i]!.watered && w.crops[i]!.stage < 3)
      return tiles.length ? tiles.flatMap(t => [go(t), work('water', t, 3)]) : none('Everything is watered already.')
    }
    case 'harvest': {
      const tiles = farmTiles(i => !!w.crops[i] && w.crops[i]!.stage >= 3)
      return tiles.length ? tiles.flatMap(t => [go(t), work('harvest', t, 3)]) : none('Nothing is ripe yet...')
    }
    case 'fish': {
      const times = 'count' in a && a.count ? a.count : 1
      return [go(w.places.pond), ...Array.from({ length: times }, () => work('fish', w.places.pond, 25 + Math.floor(Math.random() * 30)))]
    }
    case 'chop': {
      const t = nearestTile(w, p, i => w.tiles[i] === 'tree')
      const times = 'count' in a && a.count ? a.count : 1
      return t ? [go(t), ...Array.from({ length: times }, () => work('chop', t, 14))] : none('No trees around?')
    }
    case 'shake': {
      const times = 'count' in a && a.count ? a.count : 1
      const trees: Pt[] = []
      let from: Pt = p
      for (let k = 0; k < times; k++) {
        const t = nearestTile(w, from, i => w.tiles[i] === 'apple' && (w.fruit[i] ?? 0) > 0 && !trees.some(q => idx(q.x, q.y) === i))
        if (!t) break
        trees.push(t)
        from = t
      }
      return trees.length ? trees.flatMap(t => [go(t), work('shake', t, 8)]) : none('No apples left... maybe tomorrow.')
    }
    case 'pick': {
      if (season(w) === 'winter') return none('The flowers are sleeping under the snow.')
      const t = nearestTile(w, p, i => w.tiles[i] === 'flower')
      return t ? [go(t), work('pick', t, 5)] : none('All the flowers are picked.')
    }
    case 'sell': return [go(w.places.shop), work('sell', w.places.shop, 10)]
    case 'buy': case 'trade': {
      const k = w.merchant
      return k ? [{ do: '_goto', x: k.x, y: k.y, npc: 'kiki' }, work(a.do, k, 8)] : none("Kiki isn't in town today.")
    }
    case 'shop': return [go(w.places.shop), work('shop', w.places.shop, 10, `${a.item}:${a.count}`)]
    case 'cook': {
      const h = w.minutes / 60
      if (h < 7 || h >= 21) return none('The cafe is closed right now.')
      return [go(w.places.cafe), work('cook', w.places.cafe, 12, `${a.recipe}:${a.count}`)]
    }
    case 'fund': {
      if (a.project === 'club' && !w.adults) return none("That's not something this village builds.")
      if (w.projects[a.project].done) return none(`The ${PROJECTS[a.project].name} are already built!`)
      return [go(w.places.board), work('fund', w.places.board, 8, a.project)]
    }
    case 'lock':
    case 'unlock': {
      if (!w.projects.datacenter.done) return none("There's no data center yet - it's a project at the plaza board.")
      if (w.dc.locked === (a.do === 'lock')) return none(a.do === 'lock' ? 'The bikes are already locked.' : 'The bikes are not locked.')
      return [go(w.places.datacenter), work(a.do, w.places.datacenter, 10)]
    }
    case 'pedal': {
      if (!w.projects.datacenter.done) return none("There's no data center yet - it's a project at the plaza board.")
      if (w.dc.locked) return none('The bikes are locked - I would have to unlock them first.')
      const seat = BIKES.find(b => !IDS.some(id => dist(w.npcs[id], b) === 0)) ?? BIKES[BIKES.length - 1]
      return [go(seat), work('pedal', seat, PEDAL_TICKS)]
    }
    case 'club': {
      if (!w.adults) return none("There's no club in this village.")
      if (!w.projects.club.done) return none("There's no club yet - it's a project at the plaza board.")
      const h = w.minutes / 60
      if (h >= 3 && h < 21) return none('The Velvet Club opens at 21:00.')
      return [go(w.places.club), work('club', w.places.club, 45)]
    }
    case 'donate': {
      if (!w.projects.museum.done) return none("There's no museum yet - we could fund one at the plaza board.")
      if (w.scene === 'museum') return [work('donate', p, 10)]
      return [go(w.places.museum), work('donate', w.places.museum, 10)]
    }
    case 'place': {
      if (!(w.inv[a.item] ?? 0)) return none(`I don't have a ${a.item}. The shop sells them!`)
      const there = a.at ? w.places[a.at] : undefined
      return [...(there ? [go(there)] : []), work('place', there ?? p, 5, a.item)]
    }
    case 'catch': {
      if (!(w.inv['bug net'] ?? 0)) return none('I need a bug net from the shop first.')
      if (!w.critters.some(c => (!a.bug || c.kind === a.bug) && dist(c, p) <= 30)) return none(a.bug ? `I don't see any ${a.bug}s around.` : "I don't see any bugs around.")
      return Array.from({ length: a.count ?? 1 }, () => ({ do: '_hunt', bug: a.bug }) as Step)
    }
    case 'dig': {
      if (!(w.inv.shovel ?? 0)) return none('I need a shovel from the shop first.')
      const spots = [...w.digSpots].sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 'count' in a && a.count ? a.count : 1)
      return spots.length ? spots.flatMap(t => [go(t), work('dig', t, 10)]) : none('No cracked spots left today.')
    }
    case 'mail': return [go(w.places.home)]
    case 'search': {
      const t = [...w.pickups].sort((a, b) => dist(a, p) - dist(b, p))[0]
      return t ? [go(t)] : none("I don't see anything special around.")
    }
    case 'sleep': return [go(w.places.home), work('sleep', w.places.home, 16)]
    case 'pet': return [{ do: '_goto', x: w.mochi.x, y: w.mochi.y, npc: 'mochi' }, work('pet', w.mochi, 8)]
    case 'gift': {
      const item = a.item && (w.inv[a.item] ?? 0) > 0 ? a.item : Object.keys(w.inv).find(k => w.inv[k] > 0)
      if (!item) return none('My bag is empty... nothing to give.')
      const n = npcOf(w, a.to)
      if (!n) return none("Kiki isn't in town today.")
      return [{ do: '_goto', x: n.x, y: n.y, npc: a.to }, work('gift', n, 6, `${a.to}:${item}:${a.count ?? 1}`)]
    }
    default: return [a]
  }
}

function finishWork(w: World, s: Extract<Step, { do: '_work' }>) {
  const i = idx(s.x, s.y)
  const add = (item: string, n = 1) => { w.inv[item] = (w.inv[item] ?? 0) + n }
  const event = (text: string, memory = text) => { w.log.push({ who: 'event', text }); remember(w, 'claude', memory) }
  switch (s.kind) {
    case 'plant': {
      const crop = isCrop(s.item) ? s.item : 'turnip'
      const seeds = CROPS[crop].seeds
      if (seeds) {
        if ((w.inv[seeds] ?? 0) <= 0) break
        w.inv[seeds] -= 1
      }
      w.crops[i] = { stage: 0, watered: w.weather === 'rain', kind: crop }
      break
    }
    case 'water': if (w.crops[i]) w.crops[i]!.watered = true; break
    case 'harvest': {
      const kind = w.crops[i]?.kind ?? 'turnip'
      w.crops[i] = null
      add(kind)
      event(`Harvested a ${kind}.`)
      break
    }
    case 'fish': {
      const fish = pick(fishPool(w))
      add(fish)
      const range = FISH_SIZE[fish]
      const boost = (w.inv['golden rod'] ?? 0) > 0 || w.places.pond.x === 68 ? 0.15 : 0
      const size = range ? Math.round(range[0] + (range[1] - range[0]) * Math.min(1, Math.random() ** 1.6 + boost)) : 0
      const contest = active(w, 'tournament')
      if (contest && size > (contest.size ?? 0)) { contest.size = size; contest.best = `${size} cm ${fish}` }
      const isRecord = size > 0 && size > (w.records[fish] ?? 0)
      if (isRecord) w.records[fish] = size
      const what = fish === 'old boot' ? 'an old boot' : `a ${size} cm ${fish}`
      event(`Caught ${what}!${isRecord ? ' New record!' : ''}`, `I caught ${what} at the pond.${isRecord ? ' My biggest one yet!' : ''}`)
      if (isRecord && (w.records[fish] ?? 0) >= range[0] + (range[1] - range[0]) * 0.8) w.announce.push(`New record: a ${size} cm ${fish}!`)
      w.player.bubble = { text: fish === 'old boot' ? 'An old boot... again.' : `A ${size} cm ${fish}!${isRecord ? ' Record!' : ''}`, ticks: 30 }
      break
    }
    case 'chop': add('wood'); event('Got some wood.'); break
    case 'shake': {
      const n = w.fruit[i] ?? 0
      w.fruit[i] = 0
      add('apple', n)
      event(`${n} apples fell from the tree!`)
      break
    }
    case 'pick': w.tiles[i] = 'grass'; w.picked.push(i); add('flower'); event('Picked a flower.'); break
    case 'sell': {
      let total = 0
      for (const [k, n] of Object.entries(w.inv)) {
        const sold = isSellable(k) ? Math.max(0, n - keep(w, k)) : 0
        total += (PRICES[k] ?? 10) * sold
        w.inv[k] = n - sold
      }
      w.bells += total
      event(total ? `Sold the bag for ${total} Bells.` : 'Nothing to sell.')
      if (total) w.player.bubble = { text: `+${total} Bells!`, ticks: 25 }
      break
    }
    case 'sleep': remember(w, 'claude', 'I went to bed.'); newDay(w); w.player.bubble = { text: 'Good morning!', ticks: 25 }; break
    case 'pet': w.mochi.bubble = { text: 'purr ♥', ticks: 25 }; w.mochi.nap = 0; remember(w, 'claude', 'I petted Mochi.'); break
    case 'gift': {
      const [who, item, countText] = (s.item ?? 'mochi:').split(':') as [Who, string, string]
      const given = Math.min(w.inv[item] ?? 0, Math.max(1, Number(countText) || 1))
      if (given <= 0) break
      w.inv[item] -= given
      if (who === 'mochi' || who === 'kiki') {
        const n = npcOf(w, who)
        if (n) n.bubble = { text: who === 'mochi' ? 'mrrp! ♥' : 'For me? How kind!', ticks: 25 }
        event(`Gave ${nameOf(who)} a ${item}.`)
        break
      }
      const v = villager(who)
      const isLost = item.startsWith(`${v.name}'s `)
      const loved = isLost || v.likes.includes(item) || item === 'lucky charm' || item === 'star fragment' || item in RECIPES
      const isBirthday = active(w, 'birthday')?.who === who
      if (isBirthday) active(w, 'birthday')!.attended = true
      const wasSulking = (w.mood[who] ?? 0) < 0
      feel(w, who, loved ? 2 : 1)
      w.friendship[who] = (w.friendship[who] ?? 0) + (isLost ? 3 : loved ? 2 : 1) * (isBirthday ? 2 : 1)
      const what = given > 1 ? `${given} ${item}` : `a ${item}`
      event(`Gave ${v.name} ${what}.`, `I gave ${v.name} ${what}${loved ? ' - they loved it' : ''}.`)
      remember(w, who, `Claude gave me ${what}${loved ? ' - I love those!' : '.'}`)
      if (fulfil(w, who, item, given)) break
      const thanks = isLost ? `My ${item.slice(v.name.length + 3)}! You found it! Thank you!`
        : isBirthday ? `A birthday ${item}! You remembered!` : loved ? `A ${item}! I LOVE these!` : pick(THANKS)
      const softened = wasSulking ? `Oh... you remembered me after all. ${thanks}` : thanks
      if (!w.queue.some(q => q.do === 'npc_say' && q.who === who)) npcSay(w, who, softened)
      if (isLost) remember(w, who, `Claude found my lost ${item.slice(v.name.length + 3)} and brought it back!`, 'fact')
      break
    }
    case 'buy': {
      if (w.bells < 500) { w.player.bubble = { text: 'I need 500 Bells for that...', ticks: 30 }; break }
      w.bells -= 500
      add('lucky charm')
      event('Bought a lucky charm from Kiki.')
      if (w.merchant) w.merchant.bubble = { text: 'Good luck, friend!', ticks: 30 }
      break
    }
    case 'shop': {
      const [item, countText] = (s.item ?? '').split(':')
      const entry = SHOP[item]
      if (!entry) break
      if (entry.kind === 'tool' && (w.inv[item] ?? 0) > 0) { w.player.bubble = { text: 'I already have one of those.', ticks: 30 }; break }
      const n = Math.min(entry.kind === 'seeds' ? Math.max(1, Number(countText) || 1) : 1, Math.floor(w.bells / entry.price))
      if (n <= 0) { w.player.bubble = { text: `I need ${entry.price} Bells for that...`, ticks: 30 }; break }
      w.bells -= n * entry.price
      add(item, n)
      event(`Bought ${n > 1 ? `${n} ` : 'a '}${item} for ${n * entry.price} Bells.`)
      w.player.bubble = { text: `Got ${n > 1 ? n : 'a'} ${item}!`, ticks: 25 }
      break
    }
    case 'cook': {
      const [recipe, countText] = (s.item ?? '').split(':')
      const r = RECIPES[recipe]
      if (!r) break
      let made = 0
      while (made < Math.max(1, Number(countText) || 1) && takeIngredients(w, r.needs)) made += 1
      if (!made) {
        const needs = Object.entries(r.needs).map(([k, n]) => `${n} ${k}`).join(' and ')
        w.player.bubble = { text: `I need ${needs} for ${recipe}.`, ticks: 35 }
        break
      }
      add(recipe, made)
      event(`Mabel cooked ${made > 1 ? `${made} ` : ''}${recipe}${made > 1 ? 's' : ''} for me.`)
      npcSay(w, 'mabel', `Here's your ${recipe}, dear! Still warm.`)
      break
    }
    case 'fund': fund(w, s.item as ProjectId); break
    case 'dig': dig(w, { x: s.x, y: s.y }); break
    case 'club': nightOut(w); break
    case 'lock': {
      w.dc.locked = true
      event('Locked the bikes at the AI data center. Nobody can pedal now.')
      remember(w, 'claude', `I chained up the data center's bikes on day ${w.day}.`)
      rememberAll(w, `Claude locked the bikes at the AI data center on day ${w.day}. Nobody can charge it now.`)
      break
    }
    case 'unlock': {
      w.dc.locked = false
      event('Unlocked the bikes at the AI data center.')
      remember(w, 'claude', `I unlocked the data center's bikes on day ${w.day}.`)
      break
    }
    case 'pedal': {
      event(`Pedaled the AI data center up to ${Math.round(w.dc.battery)}%.`)
      remember(w, 'claude', `I pedaled the AI data center up to ${Math.round(w.dc.battery)}% on day ${w.day}.`)
      break
    }
    case 'donate': donate(w); break
    case 'place': {
      const spot = freeSpotNear(w, w.player)
      if (!spot || !(w.inv[s.item ?? ''] ?? 0)) { w.player.bubble = { text: 'No room here...', ticks: 25 }; break }
      placeThing(w, spot.x, spot.y, ...DECOR[s.item!])
      w.decor.push({ ...spot, item: s.item! })
      w.inv[s.item!] -= 1
      event(`Placed a ${s.item} near the ${nearestPlace(w, spot)}.`)
      break
    }
    case 'trade': {
      let total = 0
      for (const [k, n] of Object.entries(w.inv)) {
        const sold = isSellable(k) && k !== 'lucky charm' ? Math.max(0, n - keep(w, k)) : 0
        total += Math.round((PRICES[k] ?? 10) * sold * 1.5)
        w.inv[k] = n - sold
      }
      w.bells += total
      event(total ? `Kiki bought the bag for ${total} Bells!` : 'Nothing to trade.')
      if (total && w.merchant) w.merchant.bubble = { text: 'A pleasure doing business!', ticks: 30 }
      break
    }
  }
  if (['sleep', 'fish', 'sell', 'pet', 'buy', 'trade', 'shop', 'cook', 'dig', 'club'].includes(s.kind)) return
  if (w.player.bubble?.text === WORK_TEXT[s.kind]) w.player.bubble = undefined
}

function runPlayer(w: World) {
  const p = w.player
  if (!w.current) {
    const next = w.queue.shift()
    if (!next) return false
    const steps = expand(w, next)
    w.queue.unshift(...steps.slice(1))
    w.current = steps[0]
    if (!w.current) return true
  }
  const s = w.current
  switch (s.do) {
    case '_goto': {
      if (!s.started) {
        s.started = true
        if (s.npc) {
          const n = npcOf(w, s.npc)
          if (n) {
            n.hold = 80
            n.path = []
            s.x = n.x
            s.y = n.y
          }
        }
        p.path = pathTo(w, p, s) ?? []
        w.label = s.npc ? `visiting ${nameOf(s.npc)}` : 'walking'
      }
      if (p.path.length) moveAlong(p)
      else w.current = undefined
      return true
    }
    case '_work': {
      if (!s.started) {
        s.started = true
        s.left = s.ticks
        w.label = LABELS[s.kind]
        p.bubble = { text: WORK_TEXT[s.kind], ticks: s.ticks + 2 }
      }
      if (s.kind === 'pedal' && s.left! % CLAUDE_PEDAL === 0 && !w.dc.locked) charge(w, 1)
      if (--s.left! <= 0) { finishWork(w, s); w.current = undefined }
      return true
    }
    case 'say': {
      if (!s.started) {
        s.started = true
        s.left = Math.min(45, 14 + Math.round(s.text.length * 0.5))
        sayPlayer(w, s.text)
        overhear(w, 'claude', p, s.text)
        w.label = 'chatting'
      }
      if (--s.left! <= 0) w.current = undefined
      return true
    }
    case 'npc_say': {
      if (!s.started) {
        s.started = true
        s.left = Math.min(45, 14 + Math.round(s.text.length * 0.5))
        npcSay(w, s.who, s.text, true)
      }
      if (--s.left! <= 0) w.current = undefined
      return true
    }
    case '_enter': {
      w.scene = 'museum'
      w.inside = { ...ENTRANCE, path: [] }
      w.curator = { ...CURATOR_SPOT, path: [] }
      w.curator.bubble = { text: `Hoo! Welcome to the museum, Claude! ${w.museum.length} pieces on display.`, ticks: 45 }
      w.log.push({ who: 'hoot', text: `Welcome to the museum! ${w.museum.length} pieces on display.` })
      w.label = 'at the museum'
      remember(w, 'claude', 'I visited the museum.')
      w.current = undefined
      return true
    }
    case '_exit': {
      w.scene = 'village'
      w.label = 'strolling'
      w.current = undefined
      return true
    }
    case '_iwalk': {
      if (!s.started) { s.started = true; w.inside.path = indoorPath(w.inside, s) }
      if (w.inside.path.length) { if (w.tick % 2 === 0) moveAlong(w.inside) } else w.current = undefined
      return true
    }
    case '_look': {
      if (!s.started) {
        s.started = true
        s.left = 45
        const has = w.museum.includes(s.piece)
        const text = !s.piece ? 'Our halls are empty, hoo... Bring me fish, bugs and fossils!'
          : has ? FACTS[s.piece] ?? `Ah, the ${s.piece}. Splendid!`
          : `We're still missing a ${s.piece}. ${hint(s.piece)}`
        w.curator.bubble = { text, ticks: 50 }
        w.log.push({ who: 'hoot', text })
        if (has && w.records[s.piece]) w.curator.bubble = { text: `${text} Your best: ${w.records[s.piece]} cm!`, ticks: 55 }
        if (has) w.player.bubble = { text: `Look, our ${s.piece}!`, ticks: 20 }
        else if (s.piece) remember(w, 'claude', `Hoot told me: we still need a ${s.piece}. ${hint(s.piece)}`)
        w.label = s.piece ? `admiring the ${s.piece}` : 'at the museum'
      }
      if (--s.left! <= 0) w.current = undefined
      return true
    }
    case '_hunt': {
      s.left = (s.left ?? 400) - 1
      const target = w.critters.filter(c => !s.bug || c.kind === s.bug).sort((a, b) => dist(a, p) - dist(b, p))[0]
      if (!target || s.left <= 0) {
        p.bubble = { text: 'It got away...', ticks: 25 }
        w.current = undefined
        return true
      }
      w.label = `catching a ${target.kind}`
      if (dist(target, p) <= 1) {
        if (w.tick % 6) return true
        s.tries = (s.tries ?? 0) + 1
        if (Math.random() < 0.7) {
          w.critters = w.critters.filter(c => c !== target)
          w.inv[target.kind] = (w.inv[target.kind] ?? 0) + 1
          const text = `I caught a ${target.kind}!`
          p.bubble = { text, ticks: 30 }
          w.log.push({ who: 'event', text: `Caught a ${target.kind}.` })
          remember(w, 'claude', `I caught a ${target.kind} near the ${nearestPlace(w, target)}.`)
          w.current = undefined
        } else {
          p.bubble = { text: 'Missed!', ticks: 12 }
          target.x += pick([-3, 3])
          target.y += pick([-1, 1])
          if (s.tries >= 3) w.current = undefined
        }
        return true
      }
      if (w.tick % 2 === 0) {
        p.path = pathTo(w, p, target) ?? []
        moveAlong(p)
      }
      return true
    }
    case 'remember': {
      remember(w, s.who, s.text, 'fact')
      w.log.push({ who: 'event', text: `${nameOf(s.who)} will remember: ${clean(s.text, 120)}` })
      w.current = undefined
      return true
    }
    case 'wait': {
      if (!s.started) { s.started = true; s.left = Math.round(s.seconds * 6.7); w.label = 'relaxing' }
      if (--s.left! <= 0) w.current = undefined
      return true
    }
    default: {
      w.current = undefined
      w.queue.unshift(...expand(w, s))
      return true
    }
  }
}

function idle(w: World) {
  w.idle += 1
  if (w.thinking || w.idle < 55) return
  if (w.scene === 'museum') { w.idle = 0; w.queue.push({ do: 'say', text: 'What a lovely museum.' }, { do: 'exit' }); return }
  w.idle = 0
  const hour = w.minutes / 60
  if (hour >= 23 || hour < 5) { w.queue.push({ do: 'say', text: pick(NIGHT_LINES) }, { do: 'sleep' }); return }
  const req = w.requests.find(r => !r.done && (r.item === 'fish' ? FISH_KINDS.some(f => (w.inv[f] ?? 0) > 0) : (w.inv[r.item] ?? 0) >= r.amount - r.given))
  if (req && Math.random() < 0.6) {
    const item = req.item === 'fish' ? FISH_KINDS.find(f => (w.inv[f] ?? 0) > 0)! : req.item
    w.queue.push({ do: 'walk', to: req.who }, { do: 'gift', to: req.who, item, count: req.amount - req.given })
    return
  }
  if (w.mail.some(m => !m.read && m.day <= w.day) && Math.random() < 0.5) {
    w.queue.push({ do: 'say', text: 'I wonder if I got mail...' }, { do: 'mail' })
    return
  }
  if ((w.inv.shovel ?? 0) && w.digSpots.length && Math.random() < 0.25) { w.queue.push({ do: 'dig' }); return }
  const bug = w.critters.find(c => dist(c, w.player) <= 15)
  if ((w.inv['bug net'] ?? 0) && bug && Math.random() < 0.3) {
    w.queue.push({ do: 'say', text: `Ooh, a ${bug.kind}!` }, { do: 'catch', bug: bug.kind })
    return
  }
  const roll = Math.random()
  if (roll < 0.4) {
    w.queue.push({ do: 'walk', to: pick(Object.keys(PLACE_SPOTS)) })
    w.label = 'strolling'
  } else if (roll < 0.6) {
    w.player.bubble = { text: pick(hour >= 19 ? NIGHT_LINES : IDLE_LINES), ticks: 40 }
  } else if (roll < 0.7) {
    w.queue.push({ do: 'pet' })
  } else if (roll < 0.9) {
    const friend = pick(VILLAGERS.filter(v => !w.npcs[v.id].asleep))
    if (friend) w.queue.push({ do: 'walk', to: friend.id }, { do: 'say', text: `Hi ${friend.name}!` })
  } else {
    w.queue.push({ do: 'pick' })
  }
}

/** Where a villager wants to be at this hour; null at night. */
function scheduled(w: World, v: Villager): Pt | null {
  const h = w.minutes / 60
  if (goesOut(w, v) && h >= 21 && h < 23.5) return w.places.club
  if (h >= 22 || h < 6) return null
  if (h < 10) return w.places[v.home]
  if (active(w, 'festival')) return w.places.plaza
  if (active(w, 'season')) return w.places[SEASON_FESTIVALS[season(w)].place]
  if ((w.mood[v.id] ?? 0) <= -2 && h < 18) return w.places[v.home]
  if (active(w, 'rain') && h < 17) return w.places[v.home]
  if (h < 17) return w.places[v.hangout]
  return w.places[(v.id.charCodeAt(0) + w.day) % 2 ? 'plaza' : 'cafe']
}

/** A greeting that draws on what this villager remembers. */
function greeting(w: World, v: Villager): string {
  const list = w.memory[v.id] ?? []
  const gift = [...list].reverse().find(m => m.kind === 'event' && m.text.startsWith('Claude gave me a') && m.day < w.day)
  const fact = list.filter(m => m.kind === 'fact').slice(-1)[0]
  const options = [...v.lines]
  if (gift) options.push(`Thanks again for the ${gift.text.replace(/^Claude gave me a /, '').replace(/[ -].*$|\.$/, '')}!`)
  if (fact && Math.random() < 0.3) options.push(`I keep thinking... ${fact.text}`)
  if ((w.friendship[v.id] ?? 0) >= 6) options.push(`There's my favorite neighbor!`)
  const birthday = active(w, 'birthday')
  if (birthday?.who === v.id) return pick(["It's my birthday today!", 'Guess what day it is? My birthday!'])
  const lost = active(w, 'lost')
  if (lost?.who === v.id && w.pickups.some(p => p.kind === 'lost')) return `Have you seen my ${lost.item!.slice(v.name.length + 3)}?`
  const mood = w.mood[v.id] ?? 0
  if (mood <= -2) {
    const why = [...list].reverse().find(m => m.text.startsWith('Claude forgot') || m.text.startsWith('Claude never'))
    return why ? `Hmph. ${why.text.replace(/^Claude/, 'You')}` : pick(['Hmph.', "Oh. It's you.", "I'm not in the mood."])
  }
  if (mood === -1) options.length = 0, options.push('...hi.', 'Hm.', "I've had better days.")
  if (mood >= 2) options.push('What a wonderful day!', 'I feel like dancing!')
  const ask = w.requests.find(r => r.who === v.id && !r.done)
  if (ask && Math.random() < 0.5) return `Could you bring me ${ask.amount - ask.given} ${ask.item}? I'll pay ${ask.reward} Bells!`
  if (active(w, 'rain')) options.push('What a rainy day!', 'Good weather for the crops, at least.')
  if (active(w, 'festival')) options.push("Isn't the festival wonderful?", 'Dance with me!')
  if (active(w, 'merchant')) options.push("Have you seen Kiki's goods?")
  return pick(options)
}

function runVillager(w: World, v: Villager) {
  const n = w.npcs[v.id]
  decay(n)
  if (n.cooldown > 0) n.cooldown -= 1
  if (n.chat > 0) n.chat -= 1
  if (n.hold > 0) { n.hold -= 1; return }
  const target = scheduled(w, v)
  if (!target) {
    const home = w.places[v.home]
    if (dist(n, home) > 0) {
      if (!n.path.length) n.path = pathTo(w, n, home) ?? []
      if (w.tick % 2 === 0) moveAlong(n)
    } else if (!n.asleep) {
      n.asleep = true
      remember(w, v.id, 'I went home to sleep.')
    }
    if (n.asleep && w.tick % 120 === 0) n.bubble = { text: 'zZ', ticks: 30 }
    return
  }
  n.asleep = false
  const seat = bikeFor(w, v)
  if (seat) { ride(w, v, n, seat); return }
  if (n.path.length) { if (w.tick % 2 === 0) moveAlong(n); return }
  if (Math.random() < (dist(n, target) > 6 ? 0.2 : 0.03)) {
    const goal = { x: target.x - 4 + Math.floor(Math.random() * 9), y: target.y - 2 + Math.floor(Math.random() * 5) }
    if (walkable(w, goal.x, goal.y)) n.path = pathTo(w, n, goal) ?? []
  }
  if (n.cooldown === 0 && !n.bubble && dist(n, w.player) <= 3 && Math.random() < 0.05) {
    const said = greeting(w, v)
    npcSay(w, v.id, said)
    offerReplies(w, v.id, said)
    n.cooldown = 350
    return
  }
  if (n.chat > 0 || n.bubble) return
  const other = VILLAGERS.find(o => o.id !== v.id && !w.npcs[o.id].asleep && !w.npcs[o.id].bubble && dist(w.npcs[o.id], n) <= 2)
  if (other && Math.random() < 0.02) {
    const o = w.npcs[other.id]
    const chat = w.chatPool.find(c => (c.a === v.id && c.b === other.id) || (c.a === other.id && c.b === v.id))
      ?? w.chatPool.find(c => c.a === v.id && c.b !== 'pip')
    if (chat) {
      w.chatPool = w.chatPool.filter(c => c !== chat)
      const first = chat.a === other.id ? other.id : v.id
      const second = first === v.id ? other.id : v.id
      npcSay(w, first, chat.lines[0])
      w.later.push({ who: second, text: chat.lines[1], at: w.tick + 28 })
      n.hold = o.hold = 70
      n.chat = o.chat = 500
      return
    }
    n.bubble = { text: active(w, 'birthday')?.who === other.id ? `Happy birthday, ${other.name}!` : `Hi ${other.name}!`, ticks: 30 }
    o.bubble = { text: pick(REPLIES), ticks: 40 }
    n.hold = o.hold = 40
    n.chat = o.chat = 600
    remember(w, v.id, `Chatted with ${other.name} near the ${nearestPlace(w, n)}.`)
    remember(w, other.id, `Chatted with ${v.name} near the ${nearestPlace(w, n)}.`)
  }
}

/** Moves a villager's mood, -2..2, and keeps what upset them. */
// ---------- replying to villagers ----------

type ReplyKind = 'warm' | 'more' | 'brush' | 'gift' | 'promise' | 'sorry' | 'birthday'
export type ReplyOption = { kind: ReplyKind; label: string; say: string; item?: string }
export type PendingReply = { who: VillagerId; line: string; options: ReplyOption[]; until: number }

/** Lets the player answer what a villager just said: three replies, gone after about ten seconds. */
export function offerReplies(w: World, who: VillagerId, line: string) {
  const v = villager(who)
  const mood = w.mood[who] ?? 0
  const ask = w.requests.find(r => r.who === who && !r.done)
  const have = ask && (ask.item === 'fish' ? FISH_KINDS.find(f => (w.inv[f] ?? 0) > 0) : (w.inv[ask.item] ?? 0) > 0 ? ask.item : undefined)
  const liked = v.likes.find(item => (w.inv[item] ?? 0) > 0)
  const isBirthday = active(w, 'birthday')?.who === who
  const options: ReplyOption[] = []
  if (mood < 0) {
    options.push({ kind: 'sorry', label: "I'm sorry", say: `I'm sorry, ${v.name}. I should have been there for you.` })
  } else if (isBirthday) {
    options.push({ kind: 'birthday', label: 'Happy birthday!', say: `Happy birthday, ${v.name}! You deserve the best day.` })
  } else {
    options.push({ kind: 'warm', label: pick(["That's lovely!", 'Aww, nice!', 'Good to see you!']), say: pick([`That's lovely, ${v.name}!`, `Aww, nice! Good to see you, ${v.name}.`]) })
  }
  if (ask && have) options.push({ kind: 'gift', label: `Give ${have}`, say: `Here, I brought you ${have}!`, item: have })
  else if (ask) options.push({ kind: 'promise', label: "I'll get it!", say: `I'll bring you ${ask.amount - ask.given} ${ask.item}, promise!` })
  else if (liked && (isBirthday || mood < 0)) options.push({ kind: 'gift', label: `Give ${liked}`, say: `This ${liked} is for you!`, item: liked })
  else options.push({ kind: 'more', label: 'Tell me more', say: 'Ooh, tell me more!' })
  options.push({ kind: 'brush', label: 'Not now', say: pick(['Sorry, gotta run!', 'Not now, sorry!', 'Talk later!']) })
  w.reply = { who, line, options, until: w.tick + 70 }
}

/** The player picked reply `index` (0-2). */
export function chooseReply(w: World, index: number) {
  const r = w.reply
  if (!r || w.tick > r.until) { w.reply = null; return }
  const choice = r.options[index]
  if (!choice) return
  w.reply = null
  const v = villager(r.who)
  sayPlayer(w, choice.say)
  overhear(w, 'claude', w.player, choice.say)
  const friendly = w.replied[r.who] !== w.day
  const bond = (n: number) => {
    if (!friendly) return
    w.friendship[r.who] = (w.friendship[r.who] ?? 0) + n
    w.replied[r.who] = w.day
  }
  const answer = (text: string, delay = 25) => w.later.push({ who: r.who, text, at: w.tick + delay })
  switch (choice.kind) {
    case 'warm':
      bond(1)
      feel(w, r.who, 1)
      answer(pick(['Hehe, thanks!', 'You always make my day.', "You're sweet, Claude."]))
      break
    case 'birthday':
      bond(1)
      feel(w, r.who, 1, 'Claude wished me a happy birthday!')
      active(w, 'birthday')!.attended = true
      answer('You remembered! Thank you!')
      break
    case 'sorry':
      feel(w, r.who, 1, 'Claude apologised to me.')
      answer((w.mood[r.who] ?? 0) < 0 ? "...Okay. Thanks for saying that." : "Apology accepted. Let's forget it.")
      break
    case 'more':
      bond(1)
      w.askMore = { who: r.who, line: r.line }
      break
    case 'promise':
      remember(w, r.who, `Claude promised to bring me the ${w.requests.find(q => q.who === r.who && !q.done)?.item ?? 'things'} I asked for.`, 'fact')
      remember(w, 'claude', `I promised ${v.name} to bring what they asked for.`, 'fact')
      answer("You're a star! I'll be waiting.")
      break
    case 'gift':
      enqueue(w, [{ do: 'gift', to: r.who, item: choice.item }])
      break
    case 'brush':
      feel(w, r.who, -1)
      answer(pick(['Oh... okay.', 'Busy busy, huh?', 'Another time, then.']))
      break
  }
  remember(w, r.who, `When I said "${clean(r.line, 60)}", Claude answered: "${choice.say}"`)
}

/** The prompt for a villager's answer when the player asks them to tell more. */
export function moreContext(w: World, who: VillagerId, line: string): string {
  const v = villager(who)
  const mood = w.mood[who] ?? 0
  return `${v.name}: ${v.personality}. Likes ${v.likes.join(', ')}. Mood: ${mood < 0 ? 'a bit down' : mood > 0 ? 'happy' : 'fine'}. `
    + `${season(w)}, ${clock(w)}${eventLabels(w) ? `, today: ${eventLabels(w)}` : ''}.
Their memories:
${memoryText(w, who, 4)}
They just told Claude: "${line}". Claude asked them to tell more. What does ${v.name} say? One line, at most 90 characters, in character, no quotes.${who === 'pip' ? ' Pip is a child: keep it kid-friendly.' : ''}`
}

export const MORE_SYSTEM = 'You voice one villager in a cozy village game. Answer with a single short spoken line.'

/** The model's answer to "tell me more" arrives. */
export function answerMore(w: World, who: VillagerId, text: string | null) {
  w.askMore = null
  const line = clean(text ?? pick(['Oh, you know, the usual!', 'Hehe, maybe another time.']), 100).replace(/^"|"$/g, '')
  npcSay(w, who, line)
  remember(w, 'claude', `${villager(who).name} told me: "${line}"`)
}

function feel(w: World, id: VillagerId, delta: number, why?: string) {
  w.mood[id] = Math.max(-2, Math.min(2, (w.mood[id] ?? 0) + delta))
  if (why) remember(w, id, why, delta < 0 ? 'fact' : 'event')
}

/** How many of an item selling leaves in the bag: museum pieces not yet donated, and what villagers asked for. */
function keep(w: World, item: string): number {
  const forMuseum = w.projects.museum.done && MUSEUM_PIECES.includes(item) && !w.museum.includes(item) ? 1 : 0
  const asked = w.requests.filter(r => !r.done && (r.item === item || (r.item === 'fish' && isFish(item))))
    .reduce((n, r) => n + r.amount - r.given, 0)
  return Math.max(forMuseum, asked)
}

const ECHO_BUBBLES: Record<NonNullable<World['echo']>['kind'], string[]> = {
  edit: ['tap tap tap', 'fixing a plank...', 'hammer time!'],
  shell: ['clank! clank!', 'stoking the forge', 'whirr...'],
  read: ['hm, interesting...', 'reading up', 'let me look...'],
  web: ['checking the notice board', 'any news?'],
  agent: ['calling in help!', 'teamwork!'],
  other: ['busy busy', 'working on it'],
}

/** Called for every tool call of the real session: the village Claude mirrors the work when it is idle. */
export function echoTool(w: World, tool: string) {
  const kind = /edit|write|notebook/i.test(tool) ? 'edit'
    : /bash|powershell|shell/i.test(tool) ? 'shell'
    : /read|grep|glob|lsp/i.test(tool) ? 'read'
    : /web|fetch|search/i.test(tool) ? 'web'
    : /agent|task|workflow/i.test(tool) ? 'agent' : 'other'
  w.echo = { kind, tool, until: w.tick + 60 }
}

/** A turn of the real session ended: a cheer after real work, a pat on the back after trouble. */
export function echoTurn(w: World, seconds: number, outcome: 'answer' | 'aborted' | 'error') {
  if (outcome === 'answer' && seconds >= 20) {
    w.cheer = 35
    const near = VILLAGERS.filter(v => !w.npcs[v.id].asleep).sort((a, b) => dist(w.npcs[a.id], w.player) - dist(w.npcs[b.id], w.player))[0]
    if (near) npcSay(w, near.id, pick(['Nice work out there!', 'Done already? Impressive!', 'Phew, that was a big one!', 'Bravo, Claude!']))
    w.log.push({ who: 'event', text: `Claude wrapped up ${Math.round(seconds)}s of real work. The village cheers!` })
  } else if (outcome !== 'answer') {
    w.mochi.hold = 0
    w.mochi.bubble = { text: 'mrrp?', ticks: 30 }
    w.player.bubble = { text: outcome === 'aborted' ? 'Okay, stopping.' : 'Ouch, that went wrong...', ticks: 30 }
  }
  w.echo = null
}

/** A build or test run of the real session finished. */
export function echoTests(w: World, passed: boolean) {
  if (passed) {
    w.rainbow = 50
    w.cloud = 0
    w.announce.push('Tests passed! A rainbow over the village.')
    remember(w, 'claude', 'The tests passed and a rainbow appeared.')
  } else {
    w.cloud = 300
    w.player.bubble = { text: 'The tests failed... a little cloud follows me.', ticks: 40 }
    remember(w, 'claude', 'The tests failed today; a rain cloud followed me around.')
  }
}

function runEcho(w: World) {
  const e = w.echo
  if (!e) return
  if (w.tick > e.until) { w.echo = null; return }
  if (w.queue.length || w.current || w.thinking || w.scene !== 'village') return
  w.idle = 0
  w.label = `helping out (${e.tool})`
  if (!w.player.bubble && w.tick % 30 === 0) w.player.bubble = { text: pick(ECHO_BUBBLES[e.kind]), ticks: 20 }
}

/** A text postcard of what is on screen, with a caption. */
export function postcard(w: World, cols: number): string {
  const s = season(w)
  const happening = eventLabels(w)
  const near = VILLAGERS.filter(v => dist(w.npcs[v.id], w.player) <= 12).map(v => v.name)
  const caption = `Day ${w.day}, ${s} ${seasonDay(w)}, ${clock(w)}${w.weather === 'rain' ? (s === 'winter' ? ', snowing' : ', raining') : ''}`
    + `${happening ? ` - ${happening}` : ''}. Claude${near.length ? ` with ${near.join(', ')}` : ''}, ${w.label}.`
  return [`┌ Greetings from the village! ${'─'.repeat(Math.max(0, cols - 30))}┐`, ...frameText(frame(w, cols), cols).slice(1, ROWS - 1), `└ ${caption}`].join('\n')
}

/** One line for the status bar under the prompt. */
export function ticker(w: World): string {
  const s = season(w)
  const parts = [`${s[0].toUpperCase()}${s.slice(1)} ${seasonDay(w)} ${clock(w)}`, `${w.bells} Bells`]
  const happening = eventLabels(w)
  if (happening) parts.push(`★ ${happening}`)
  if (w.projects.datacenter.done) parts.push(`⚡ ${Math.round(w.dc.battery)}%${w.dc.evil ? ' EVIL' : ''}`)
  const ask = w.requests.find(r => !r.done)
  if (ask) parts.push(`${villager(ask.who).name} wants ${ask.amount - ask.given} ${ask.item}`)
  if (w.mail.some(m => !m.read && m.day <= w.day)) parts.push('mail!')
  return `Village: ${parts.join(' · ')}`
}

const nearestPlace = (w: World, p: Pt) => Object.entries(w.places).sort(([, a], [, b]) => dist(a, p) - dist(b, p))[0][0]

function runMochi(w: World) {
  const m = w.mochi
  decay(m)
  if (m.hold > 0) { m.hold -= 1; return }
  if (m.nap > 0) {
    m.nap -= 1
    if (m.nap % 40 === 0 && !m.bubble) m.bubble = { text: 'zZ', ticks: 20 }
    return
  }
  if (w.tick % 3) return
  if (dist(m, w.player) > 3) {
    const path = pathTo(w, m, w.player)
    if (path && path.length > 1) { m.x = path[0].x; m.y = path[0].y }
  } else if (Math.random() < 0.01) {
    m.nap = 120
  }
}

export function step(w: World) {
  w.tick += 1
  w.minutes += 0.5
  if (w.minutes >= 24 * 60) newDay(w)
  decay(w.player)
  if (!runPlayer(w)) { w.label = w.thinking ? 'thinking' : 'strolling'; idle(w) } else w.idle = 0
  for (const v of VILLAGERS) runVillager(w, v)
  runMochi(w)
  runEvents(w)
  runNature(w)
  if (w.reply && w.tick > w.reply.until) w.reply = null
  for (const l of w.later.filter(q => q.at <= w.tick)) npcSay(w, l.who, l.text)
  w.later = w.later.filter(q => q.at > w.tick)
  for (const k of ['cheer', 'cloud', 'boom', 'rainbow', 'flash'] as const) if (w[k] > 0) w[k] -= 1
  runFactory(w)
  runDataCenter(w)
  runEcho(w)
  if (w.scene === 'museum') {
    const h = w.curator
    if (h.bubble && --h.bubble.ticks <= 0) h.bubble = undefined
    if (w.tick % 3 === 0 && dist(h, w.inside) > 2) {
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: w.inside.x + dx, y: w.inside.y + dy }))
        .map(t => indoorPath(h, t)).filter(path => path.length).sort((a, b) => a.length - b.length)[0]
      if (near) { h.x = near[0].x; h.y = near[0].y }
    }
  }
}

/** Actions that can happen inside the museum without leaving it. */
const INDOOR = new Set<string>(['say', 'npc_say', 'wait', 'remember', 'enter', 'exit', 'tour', 'look', 'donate',
  '_iwalk', '_look', '_enter', '_exit', '_work'])

// ---------- events: at least one happening every day ----------

const LOST_ITEMS: Record<VillagerId, string> = {
  tom: "Tom's lucky lure", rosa: "Rosa's ribbon", bruno: "Bruno's hammer", pip: "Pip's toy frog", mabel: "Mabel's glasses",
}
const hours = (h: number) => Math.round(h * 60)
const WINDOWS: Record<Exclude<EventKind, 'season'>, () => [number, number]> = {
  rain: () => { const s = hours(7 + Math.random() * 8); return [s, s + hours(2 + Math.random() * 2)] },
  merchant: () => [hours(9), hours(17)],
  festival: () => [hours(18), hours(21)],
  lost: () => [hours(8 + Math.random() * 4), hours(23.9)],
  tournament: () => [hours(9), hours(16)],
  meteor: () => [hours(21), hours(23.5)],
  birthday: () => [hours(6.5), hours(22)],
}
/** Events that start in daylight, so a day never passes without one, however early Claude goes to bed. */
const DAYTIME: Exclude<EventKind, 'season'>[] = ['rain', 'merchant', 'lost', 'tournament', 'birthday']

export const active = (w: World, kind: EventKind) => w.events.find(e => e.kind === kind && e.started && !e.ended)

/** Plans the day's events: one daytime event for sure, often a second, sometimes a third. */
export function scheduleDay(w: World) {
  const first = pick(DAYTIME)
  const rest = (Object.keys(WINDOWS) as Exclude<EventKind, 'season'>[]).filter(k => k !== first).sort(() => Math.random() - 0.5)
  const extra = (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0)
  w.events = [first, ...rest.slice(0, extra)].map(kind => {
    const [start, end] = WINDOWS[kind]()
    const e: VillageEvent = { kind, start, end }
    if (kind === 'lost' || kind === 'birthday') e.who = pick(IDS)
    if (kind === 'lost') e.item = LOST_ITEMS[e.who!]
    return e
  }).sort((a, b) => a.start - b.start)
  if (seasonDay(w) === 4) {
    const f = SEASON_FESTIVALS[season(w)]
    w.events = [...w.events.filter(e => e.kind !== 'festival'), { kind: 'season' as const, start: hours(f.start), end: hours(f.end) }].sort((a, b) => a.start - b.start)
  }
  planRequests(w)
  planDigs(w)
}

export function spawnMerchant(w: World) {
  const at = nearestWalkable(w, { x: w.places.plaza.x + 3, y: w.places.plaza.y + 1 })
  w.merchant = { x: at.x, y: at.y, path: [], hold: 0, cooldown: 0, nap: 0, chat: 0, asleep: false }
}

function rememberAll(w: World, text: string) {
  remember(w, 'claude', text)
  for (const id of IDS) if (!w.npcs[id].asleep) remember(w, id, text)
}

function randomSpot(w: World, awayFrom: Pt, minDist: number): Pt {
  for (let tries = 0; tries < 400; tries++) {
    const p = { x: 2 + Math.floor(Math.random() * (W - 4)), y: 2 + Math.floor(Math.random() * (H - 4)) }
    const t = w.tiles[idx(p.x, p.y)]
    if ((t === 'grass' || t === 'tuft') && dist(p, awayFrom) >= minDist && !w.pickups.some(q => q.x === p.x && q.y === p.y)) return p
  }
  return nearestWalkable(w, { x: 50, y: 20 })
}

function startEvent(w: World, e: VillageEvent) {
  e.started = true
  const name = e.who ? villager(e.who).name : ''
  const thing = e.item?.slice(name.length + 3) ?? ''
  let headline = ''
  switch (e.kind) {
    case 'rain':
      w.weather = 'rain'
      if (season(w) === 'winter') {
        headline = "It's snowing! Everything is turning white."
        break
      }
      for (const c of w.crops) if (c) c.watered = true
      headline = 'It started to rain - the crops are getting watered!'
      break
    case 'season': {
      const f = SEASON_FESTIVALS[season(w)]
      headline = `${f.name} today at the ${f.place}: ${f.about}!`
      break
    }
    case 'merchant':
      spawnMerchant(w)
      headline = 'Kiki the traveling merchant set up shop at the plaza!'
      break
    case 'festival':
      headline = 'The evening festival is starting at the plaza!'
      break
    case 'lost':
      w.pickups.push({ ...randomSpot(w, w.places[villager(e.who!).home], 15), item: e.item!, kind: 'lost' })
      npcSay(w, e.who!, `Oh no, I lost my ${thing}!`)
      headline = `${name} lost their ${thing} somewhere in the village!`
      break
    case 'tournament':
      npcSay(w, 'tom', 'Fishing contest today! Best catch until 16:00 wins!')
      headline = 'Tom is hosting a fishing contest until 16:00 - the best catch wins 300 Bells!'
      break
    case 'meteor':
      for (let i = 0; i < 3; i++) w.pickups.push({ ...randomSpot(w, w.player, 6), item: 'star fragment', kind: 'star' })
      headline = 'A meteor shower! Star fragments are falling on the village.'
      break
    case 'birthday':
      headline = `It's ${name}'s birthday today!`
      break
  }
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  rememberAll(w, headline)
  react(w, e, name)
}

/** Claude notices the event and joins in, unless the player gave it something to do. */
function react(w: World, e: VillageEvent, name: string) {
  if (w.thinking || w.queue.length > 0 || (w.current && w.current.do !== '_goto')) return
  const plans: Record<EventKind, Action[]> = {
    rain: [{ do: 'say', text: 'Oh, rain! The crops will love this.' }],
    merchant: [{ do: 'say', text: 'A merchant in town? Let me take a look!' }, { do: 'walk', to: 'kiki' }],
    festival: [{ do: 'say', text: 'Festival time! To the plaza!' }, { do: 'walk', to: 'plaza' }],
    lost: [{ do: 'say', text: `Poor ${name}! I'll keep an eye out for it.` }],
    tournament: [{ do: 'say', text: 'A fishing contest? Count me in!' }, { do: 'fish' }],
    meteor: [{ do: 'say', text: 'Look, shooting stars! Make a wish!' }, { do: 'search' }],
    birthday: [{ do: 'walk', to: e.who ?? 'plaza' }, { do: 'say', text: `Happy birthday, ${name}!` }],
    season: [{ do: 'say', text: `The ${SEASON_FESTIVALS[season(w)].name}! I can't miss it!` }, { do: 'walk', to: SEASON_FESTIVALS[season(w)].place }],
  }
  enqueue(w, plans[e.kind])
}

function endEvent(w: World, e: VillageEvent) {
  e.ended = true
  const say = (text: string, toast = false) => {
    w.log.push({ who: 'event', text })
    if (toast) w.announce.push(text)
    rememberAll(w, text)
  }
  switch (e.kind) {
    case 'rain': w.weather = 'clear'; say(season(w) === 'winter' ? 'The snow stopped falling.' : 'The rain stopped.'); break
    case 'season': endFestival(w, e, say); break
    case 'merchant': w.merchant = undefined; say('Kiki packed up her stall and left town.'); break
    case 'festival':
      if (e.attended) {
        for (const id of IDS) w.friendship[id] = (w.friendship[id] ?? 0) + 1
        say('What a festival! Everyone had a wonderful time with Claude.', true)
      } else {
        say('The festival ended. Claude missed it...')
      }
      break
    case 'lost':
      if (w.pickups.some(p => p.kind === 'lost' && p.item === e.item)) feel(w, e.who!, -1)
      if (w.pickups.some(p => p.kind === 'lost' && p.item === e.item)) remember(w, e.who!, `I never found my ${e.item!.slice(villager(e.who!).name.length + 3)}.`)
      w.pickups = w.pickups.filter(p => p.item !== e.item)
      break
    case 'tournament':
      if (e.best) {
        w.bells += 300
        say(`Claude won Tom's fishing contest with a ${e.best}! (+300 Bells)`, true)
        remember(w, 'claude', `I won Tom's fishing contest on day ${w.day} with a ${e.best}.`, 'fact')
        remember(w, 'tom', `Claude won my fishing contest on day ${w.day} with a ${e.best}.`, 'fact')
      } else {
        say('The fishing contest ended without a winner.')
      }
      break
    case 'meteor': w.pickups = w.pickups.filter(p => p.kind !== 'star'); say('The meteor shower is over.'); break
    case 'birthday':
      if (e.who && !e.attended) feel(w, e.who, -2, 'Claude forgot my birthday...')
      break
  }
}

function runEvents(w: World) {
  for (const e of w.events) {
    if (!e.started && w.minutes >= e.start && w.minutes < e.end) startEvent(w, e)
    else if (e.started && !e.ended && w.minutes >= e.end) endEvent(w, e)
  }
  const festival = active(w, 'festival')
  if (festival && dist(w.player, w.places.plaza) <= 6) festival.attended = true
  const party = active(w, 'season')
  if (party && dist(w.player, w.places[SEASON_FESTIVALS[season(w)].place]) <= 6) party.attended = true

  const found = w.pickups.find(p => dist(p, w.player) <= 1)
  if (found) {
    w.pickups = w.pickups.filter(p => p !== found)
    w.inv[found.item] = (w.inv[found.item] ?? 0) + 1
    const text = found.kind === 'lost' ? `I found ${found.item}! I should bring it back.` : 'I found a star fragment! It glows...'
    w.player.bubble = { text, ticks: 40 }
    w.log.push({ who: 'claude', text })
    remember(w, 'claude', text)
  }

  const k = w.merchant
  if (k) {
    decay(k)
    if (k.cooldown > 0) k.cooldown -= 1
    if (k.cooldown === 0 && !k.bubble && dist(k, w.player) <= 6) {
      k.bubble = { text: pick(['Lucky charms! Only 500 Bells!', 'I pay 1.5x for anything!', 'Rare goods from afar!']), ticks: 40 }
      k.cooldown = 300
    }
  }
}

/** Today's events, for the planning prompt. */
export function eventsText(w: World): string {
  const at = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor((m % 60) / 10) * 10).padStart(2, '0')}`
  return w.events.map(e => {
    const name = e.who ? villager(e.who).name : ''
    const what: Record<EventKind, string> = {
      rain: 'Rain (crops get watered, villagers stay home)',
      merchant: 'Kiki the traveling merchant at the plaza (buy: lucky charm 500 Bells; trade: sells the bag for 1.5x)',
      festival: 'Evening festival at the plaza (everyone gathers; being there raises friendship with all)',
      lost: `${name} lost ${e.item} somewhere (search, then gift it back to ${name}: big friendship boost)`
        + (w.inv[e.item ?? ''] ? ' - it is in your bag!' : ''),
      tournament: `Tom's fishing contest (best catch wins 300 Bells)${e.best ? `; your best so far: ${e.best}` : ''}`,
      meteor: `Meteor shower (search for star fragments; ${w.pickups.filter(p => p.kind === 'star').length} left)`,
      birthday: `${name}'s birthday (gifts count double today)`,
      season: `${SEASON_FESTIVALS[season(w)].name} at the ${SEASON_FESTIVALS[season(w)].place} (${SEASON_FESTIVALS[season(w)].about}; attending raises friendship with all)`,
    }
    const when = e.ended ? 'over' : e.started ? `happening now until ${at(e.end)}` : `starts at ${at(e.start)}`
    return `- ${what[e.kind]}: ${when}`
  }).join('\n') || '- nothing special'
}

/** Short labels of what is happening now, for the HUD. */
export function eventLabels(w: World): string {
  const LABEL: Record<EventKind, string> = {
    rain: 'rain', merchant: 'merchant', festival: 'festival!', lost: 'lost item', tournament: 'fishing contest',
    meteor: 'meteor shower', birthday: 'birthday', season: 'festival!',
  }
  return w.events
    .filter(e => e.started && !e.ended)
    .map(e => (e.kind === 'birthday' && e.who ? `${villager(e.who).name}'s birthday`
      : e.kind === 'season' ? SEASON_FESTIVALS[season(w)].name : e.kind === 'rain' && season(w) === 'winter' ? 'snow' : LABEL[e.kind]))
    .join(' · ')
}

// ---------- the economy: shop, kitchen, projects, museum, decorations, requests ----------

const LAMP_SPOTS = [
  [6, 10], [16, 10], [26, 10], [36, 10], [46, 10], [54, 10], [64, 10], [72, 10], [86, 10],
  [16, 19], [26, 19], [36, 19], [48, 19], [80, 19],
]

/** Puts an object on open ground; answers whether it fit. */
function placeThing(w: World, x: number, y: number, glyph: string, color: number): boolean {
  if (!inMap(x, y)) return false
  const i = idx(x, y)
  const t = w.tiles[i]
  if (t !== 'grass' && t !== 'tuft' && t !== 'flower' && t !== 'plaza') return false
  if (dist(w.player, { x, y }) === 0) return false
  w.paint[i] = [0, t === 'plaza' ? 0xd7ccc8 : GRASS]
  w.tiles[i] = 'item'
  w.deco[i] = [glyph, color]
  return true
}

function freeSpotNear(w: World, p: Pt): Pt | null {
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const q = { x: p.x + dx, y: p.y + dy }
        const t = inMap(q.x, q.y) ? w.tiles[idx(q.x, q.y)] : undefined
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && (t === 'grass' || t === 'tuft')) return q
      }
    }
  }
  return null
}

/** Changes the map for a finished community project. */
export function applyProject(w: World, id: ProjectId) {
  switch (id) {
    case 'lamps': for (const [x, y] of LAMP_SPOTS) placeThing(w, x, y, 'i', 0xffd54f); break
    case 'benches': for (const [x, y] of [[46, 12], [54, 12], [46, 14], [54, 14]]) placeThing(w, x, y, '=', 0x8d6e63); break
    case 'park':
      for (let y = 19; y <= 22; y++) {
        for (let x = 50; x <= 56; x++) {
          const t = w.tiles[idx(x, y)]
          if ((x + y) % 2 === 0 && (t === 'grass' || t === 'tuft')) w.tiles[idx(x, y)] = 'flower'
        }
      }
      break
    case 'pier':
      for (let y = 19; y <= 21; y++) w.tiles[idx(68, y)] = 'bridge'
      w.places.pond = { x: 68, y: 21 }
      break
    case 'club': {
      for (let y = 11; y <= 14; y++) {
        for (let x = 86; x <= 91; x++) {
          const i = idx(x, y)
          w.tiles[i] = y < 13 ? 'roof' : 'wall'
          w.paint[i] = y < 13 ? [0x4a148c, 0x4a148c] : [0, 0x212121]
          delete w.deco[i]
        }
      }
      w.tiles[idx(88, 14)] = 'door'
      'VELVET'.split('').forEach((c, k) => { w.deco[idx(86 + k, 13)] = [c, 0xff4081] })
      for (let y = 15; y <= 17; y++) w.tiles[idx(88, y)] = 'path'
      delete w.fruit[idx(86, 13)]
      w.places.club = { x: 88, y: 15 }
      break
    }
    case 'factory': {
      for (let y = 11; y <= 14; y++) {
        for (let x = 65; x <= 71; x++) {
          const i = idx(x, y)
          w.tiles[i] = y < 13 ? 'roof' : 'wall'
          w.paint[i] = y < 13 ? [0x5d4037, 0x5d4037] : [0, 0x616161]
          delete w.deco[i]
          delete w.fruit[i]
        }
      }
      w.tiles[idx(68, 14)] = 'door'
      'BOMBS!'.split('').forEach((c, k) => { w.deco[idx(66 + k, 13)] = [c, 0xffd54f] })
      for (let y = 15; y <= 17; y++) w.tiles[idx(68, y)] = 'path'
      w.places.factory = { x: 68, y: 15 }
      break
    }
    case 'datacenter': {
      for (let y = 19; y <= 22; y++) {
        for (let x = 39; x <= 45; x++) {
          const i = idx(x, y)
          w.tiles[i] = y < 21 ? 'roof' : 'wall'
          w.paint[i] = y < 21 ? [0x37474f, 0x37474f] : [0, 0x263238]
          delete w.deco[i]
          delete w.fruit[i]
        }
      }
      w.tiles[idx(42, 22)] = 'door'
      'AI-DC'.split('').forEach((c, k) => { w.deco[idx(40 + k, 21)] = [c, 0x80deea] })
      for (const b of BIKES) {
        w.tiles[idx(b.x, b.y)] = 'path'
        delete w.deco[idx(b.x, b.y)]
        placeThing(w, b.x - 1, b.y, 'Ø', 0x90a4ae)
        placeThing(w, b.x + 1, b.y, 'ø', 0x90a4ae)
      }
      w.places.datacenter = { x: 37, y: 19 }
      break
    }
    case 'museum': {
      for (let y = 11; y <= 14; y++) {
        for (let x = 24; x <= 30; x++) {
          const i = idx(x, y)
          w.tiles[i] = y < 13 ? 'roof' : 'wall'
          w.paint[i] = y < 13 ? [0x90a4ae, 0x90a4ae] : [0, 0xeceff1]
        }
      }
      w.tiles[idx(27, 14)] = 'door'
      'MUSEUM'.split('').forEach((c, k) => { w.deco[idx(25 + k, 13)] = [c, 0x37474f] })
      for (let y = 15; y <= 17; y++) w.tiles[idx(27, y)] = 'path'
      w.places.museum = { x: 27, y: 15 }
      break
    }
  }
}

function fishPool(w: World): string[] {
  const golden = (w.inv['golden rod'] ?? 0) > 0
  const pier = w.projects.pier.done && dist(w.player, { x: 68, y: 21 }) <= 1
  const pool = ['sea bass', 'sea bass', 'bluegill', 'bluegill', 'carp', 'koi', 'goldfish']
  if (!golden) pool.push('old boot', 'old boot')
  if (golden) pool.push('koi', 'goldfish', 'sturgeon')
  if (pier) pool.push('koi', 'sturgeon', 'sturgeon')
  pool.push(SEASONAL_FISH[season(w)], SEASONAL_FISH[season(w)])
  return pool
}

/** Takes one portion of a recipe's ingredients from the bag; `fish` is any fish, cheapest first. */
function takeIngredients(w: World, needs: Record<string, number>): boolean {
  const fishes = FISH_KINDS.filter(f => (w.inv[f] ?? 0) > 0).sort((a, b) => (PRICES[a] ?? 0) - (PRICES[b] ?? 0))
  const fishCount = fishes.reduce((n, f) => n + (w.inv[f] ?? 0), 0)
  for (const [k, n] of Object.entries(needs)) if ((k === 'fish' ? fishCount : w.inv[k] ?? 0) < n) return false
  for (const [k, n] of Object.entries(needs)) {
    if (k !== 'fish') { w.inv[k] -= n; continue }
    let left = n
    for (const f of fishes) {
      const used = Math.min(left, w.inv[f])
      w.inv[f] -= used
      left -= used
    }
  }
  return true
}

function fund(w: World, id: ProjectId) {
  const def = PROJECTS[id]
  const st = w.projects[id]
  if (st.done) return
  const pay = Math.min(w.bells, def.bells - st.bells)
  w.bells -= pay
  st.bells += pay
  const gave = pay > 0 ? [`${pay} Bells`] : []
  for (const [k, need] of Object.entries(def.items)) {
    const n = Math.min(w.inv[k] ?? 0, need - (st.items[k] ?? 0))
    if (n <= 0) continue
    w.inv[k] -= n
    st.items[k] = (st.items[k] ?? 0) + n
    gave.push(`${n} ${k}`)
  }
  if (gave.length === 0) {
    w.player.bubble = { text: "I've got nothing to give for it yet.", ticks: 30 }
    return
  }
  w.log.push({ who: 'event', text: `Funded the ${def.name}: ${gave.join(', ')}.` })
  remember(w, 'claude', `I put ${gave.join(' and ')} into the ${def.name}.`)
  const isDone = st.bells >= def.bells && Object.entries(def.items).every(([k, n]) => (st.items[k] ?? 0) >= n)
  if (!isDone) { w.player.bubble = { text: 'Every bit helps!', ticks: 25 }; return }
  st.done = true
  applyProject(w, id)
  for (const v of IDS) w.friendship[v] = (w.friendship[v] ?? 0) + 1
  const headline = `Community project finished: ${def.name}! ${def.about[0].toUpperCase()}${def.about.slice(1)}.`
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  rememberAll(w, headline)
  // Pip is a child: the club is none of his business
  if (id === 'club') w.memory.pip = (w.memory.pip ?? []).filter(m => !m.text.includes(def.name))
  remember(w, 'claude', `I helped build the ${def.name} on day ${w.day}.`, 'fact')
  w.player.bubble = { text: `The ${def.name} are done!`, ticks: 40 }
}

function donate(w: World) {
  const given = MUSEUM_PIECES.filter(piece => !w.museum.includes(piece) && (w.inv[piece] ?? 0) > 0)
  if (given.length === 0) { w.player.bubble = { text: 'Nothing new to donate yet.', ticks: 30 }; return }
  for (const piece of given) {
    w.inv[piece] -= 1
    w.museum.push(piece)
  }
  const text = `Donated ${given.join(', ')} to the museum (${w.museum.length}/${MUSEUM_PIECES.length}).`
  w.log.push({ who: 'event', text })
  remember(w, 'claude', text)
  w.player.bubble = { text: 'For the collection!', ticks: 25 }
  for (const [section, pieces] of Object.entries(MUSEUM)) {
    const isNew = pieces.every(m => w.museum.includes(m)) && given.some(g => pieces.includes(g))
    if (!isNew) continue
    w.bells += SECTION_REWARD
    const done = `The museum's ${section} section is complete! (+${SECTION_REWARD} Bells)`
    w.announce.push(done)
    w.log.push({ who: 'event', text: done })
    remember(w, 'claude', done, 'fact')
  }
  if (w.museum.length < MUSEUM_PIECES.length) return
  w.bells += MUSEUM_REWARD
  w.inv.statue = (w.inv.statue ?? 0) + 1
  const headline = `The museum collection is complete! (+${MUSEUM_REWARD} Bells and a statue)`
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  rememberAll(w, headline)
}

/** Each morning one or two villagers ask for something. */
function planRequests(w: World) {
  const askers = [...IDS].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.4 ? 2 : 1)
  w.requests = askers.map(who => {
    const item = pick(WANTS[who])
    const amount = item === 'fish' || item === 'pumpkin' ? 1 : 2 + Math.floor(Math.random() * 2)
    const base = item === 'fish' ? 150 : PRICES[item] ?? 30
    return { who, item, amount, given: 0, reward: Math.round(base * amount * 2 + 100) }
  })
}

/** Counts a gift toward the giver's request; answers whether it finished one. */
function fulfil(w: World, who: VillagerId, item: string, given: number): boolean {
  const r = w.requests.find(q => q.who === who && !q.done && (q.item === item || (q.item === 'fish' && isFish(item))))
  if (!r) return false
  r.given += given
  if (r.given < r.amount) {
    npcSay(w, who, `Thank you! Just ${r.amount - r.given} more, please.`)
    return true
  }
  r.done = true
  w.bells += r.reward
  w.friendship[who] = (w.friendship[who] ?? 0) + 2
  const name = villager(who).name
  const headline = `Request done: ${name} paid ${r.reward} Bells for the ${r.item}.`
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  remember(w, who, `Claude brought me the ${r.item} I asked for. What a friend!`, 'fact')
  w.mail.push({ from: who, text: `Thanks again for the ${r.item}! You really helped me out. Here's a little extra.`, bells: 100, day: w.day + 1 })
  remember(w, 'claude', `I helped ${name} with ${r.amount} ${r.item} and got ${r.reward} Bells.`)
  npcSay(w, who, `That's exactly what I needed! Here, ${r.reward} Bells!`)
  return true
}

/** The economy as the planner needs it. */
export function economyText(w: World): string {
  const shop = Object.entries(SHOP).map(([k, v]) => `${k} ${v.price} (${v.about})`).join('; ')
  const recipes = Object.entries(RECIPES)
    .map(([k, r]) => `${k} = ${Object.entries(r.needs).map(([i, n]) => `${n} ${i}`).join(' + ')} (sells ${r.price})`).join('; ')
  const projects = projectIds(w).map(id => {
    const def = PROJECTS[id]
    const st = w.projects[id]
    if (st.done) return `${def.name} (${id}): built${id === 'datacenter' ? ` - ${dataCenterText(w)}` : ''}`
    const items = Object.entries(def.items).map(([k, n]) => `${st.items[k] ?? 0}/${n} ${k}`).join(', ')
    return `${def.name} (${id}): ${st.bells}/${def.bells} Bells, ${items} - ${def.about}`
  }).join('\n  ')
  const museum = w.projects.museum.done
    ? `${w.museum.length}/${MUSEUM_PIECES.length} donated; still missing: ${MUSEUM_PIECES.filter(m => !w.museum.includes(m)).join(', ') || 'nothing'}`
    : 'not built yet'
  const requests = w.requests.map(r => `${villager(r.who).name} wants ${r.amount} ${r.item}`
    + (r.done ? ' (done)' : ` (${r.given} given, pays ${r.reward} Bells)`)).join('; ') || 'none'
  return [
    `- Shop: ${shop}`,
    `- Mabel's recipes: ${recipes}`,
    `- Community projects at the plaza board:\n  ${projects}`,
    `- Museum: ${museum}`,
    `- Museum sections: ${Object.entries(MUSEUM).map(([k, v]) => `${k} ${v.filter(m => w.museum.includes(m)).length}/${v.length}`).join(', ')} (each finished section pays ${SECTION_REWARD})`,
    `- Villager requests today: ${requests}`,
    `- Decorations placed: ${w.decor.length ? w.decor.map(d => d.item).join(', ') : 'none'}`,
  ].join('\n')
}

/** The village view in the pane: projects, museum, requests, catalog. */
export function villageLines(w: World): LogLine[] {
  const lines: LogLine[] = []
  for (const id of Object.keys(PROJECTS) as ProjectId[]) {
    const def = PROJECTS[id]
    const st = w.projects[id]
    const items = Object.entries(def.items).map(([k, n]) => `${st.items[k] ?? 0}/${n} ${k}`).join(', ')
    const built = id === 'factory' && w.rubble > 0 ? 'blown up, Bruno is patching it' : id === 'datacenter' ? `built ✓ - ${dataCenterText(w)}` : 'built ✓'
    lines.push({ who: 'project', text: st.done ? `${def.name} - ${built}` : `${def.name} - ${st.bells}/${def.bells} Bells, ${items}` })
  }
  if (!w.projects.museum.done) lines.push({ who: 'museum', text: 'fund the museum project to open it' })
  else {
    for (const [section, pieces] of Object.entries(MUSEUM)) {
      const have = pieces.filter(m => w.museum.includes(m))
      lines.push({ who: 'museum', text: `${section} ${have.length}/${pieces.length}: ${pieces.map(m => (have.includes(m) ? m : '?')).join(', ')}` })
    }
  }
  for (const l of w.mail.filter(m => m.day <= w.day).slice(-2)) lines.push({ who: l.from, text: `✉ ${l.read ? '' : '(unread) '}${l.text}` })
  for (const r of w.requests) {
    lines.push({ who: r.who, text: r.done ? `request done ✓` : `wants ${r.amount - r.given} ${r.item} - pays ${r.reward} Bells` })
  }
  lines.push({ who: 'shop', text: Object.entries(SHOP).map(([k, v]) => `${k} ${v.price}`).join(' · ') })
  lines.push({ who: 'kitchen', text: Object.keys(RECIPES).join(' · ') })
  return lines
}

// ---------- seasons, wildlife, digging and mail ----------

const MAILBOX = { x: 14, y: 6 }
export const season = (w: World): Season => SEASONS[Math.floor((w.day - 1) / SEASON_DAYS) % 4]
export const seasonDay = (w: World) => ((w.day - 1) % SEASON_DAYS) + 1
const isNightTime = (w: World) => w.minutes / 60 >= 19.5 || w.minutes / 60 < 5.5

/** Called each morning: seasons turn, snowmen melt, letters are written. */
function newSeasonDay(w: World) {
  const s = season(w)
  if (seasonDay(w) === 1) {
    const headline = `${s[0].toUpperCase()}${s.slice(1)} has come to the village!`
    w.announce.push(headline)
    w.log.push({ who: 'event', text: headline })
    rememberAll(w, headline)
    const from = pick(IDS)
    const lines: Record<Season, string> = {
      spring: 'Spring is here! The blossoms are out - come see the orchard with me.',
      summer: "Summer! Long days, fireflies by the river, and fireworks soon. Don't forget your hat!",
      autumn: 'The leaves are turning. Perfect weather for pumpkins and long walks.',
      winter: 'Brr, winter! Stay warm, and come by for something hot to drink.',
    }
    w.mail.push({ from, text: lines[s], day: w.day })
    if (s === 'spring') {
      for (const d of w.decor.filter(d => d.item === 'snowman')) {
        const i = idx(d.x, d.y)
        w.tiles[i] = w.paint[i]?.[1] === 0xd7ccc8 ? 'plaza' : 'grass'
        delete w.deco[i]
      }
      w.decor = w.decor.filter(d => d.item !== 'snowman')
    }
  }
  const tiers = [4, 8, 14]
  const gifts = (id: VillagerId, tier: number): Pick<Letter, 'item' | 'count' | 'bells'> =>
    tier === 1 ? { item: villager(id).likes[0] === 'flower' ? 'flower' : 'apple', count: 3 }
      : tier === 2 ? { item: KEEPSAKES[IDS.indexOf(id)] } : { item: 'ruby', bells: 1000 }
  const TIER2: Record<VillagerId, string> = {
    tom: 'Remember that day at the pond? I framed a photo of us. Fish on!',
    rosa: 'I pressed a rose from my garden for you. It smells like spring.',
    bruno: "Carved you a little wooden bird. Don't make a fuss about it.",
    pip: "I drew you!!! It's you and Mochi and a GIANT beetle.",
    mabel: 'My secret pie recipe, dear. Only for family.',
  }
  for (const id of IDS) {
    const reached = tiers.filter(t => (w.friendship[id] ?? 0) >= t).length
    if (reached <= (w.milestones[id] ?? 0)) continue
    w.milestones[id] = reached
    const text = reached === 1 ? "Thanks for being such a good neighbor! Here's a little something."
      : reached === 2 ? TIER2[id] : "You're my best friend in the whole village. Please keep this."
    w.mail.push({ from: id, text, day: w.day, ...gifts(id, reached) })
    remember(w, id, `I wrote Claude a letter: "${text}"`)
  }
  if (w.mail.some(m => !m.read && m.day <= w.day)) w.announce.push("You've got mail! Letters are waiting in the mailbox.")
}

/** Three cracked spots to dig up each day. */
function planDigs(w: World) {
  w.digSpots = []
  for (let i = 0; i < 3; i++) w.digSpots.push(randomSpot(w, w.places.home, 4))
}

function dig(w: World, at: Pt) {
  w.digSpots = w.digSpots.filter(d => d.x !== at.x || d.y !== at.y)
  const roll = Math.random()
  const add = (item: string) => { w.inv[item] = (w.inv[item] ?? 0) + 1 }
  let text = ''
  if (roll < 0.35) { const f = pick(FOSSILS); add(f); text = `I dug up a fossil: ${f}!` }
  else if (roll < 0.43) { add('amethyst'); text = 'A sparkly amethyst!' }
  else if (roll < 0.45) { add('ruby'); text = 'A RUBY! Wow!' }
  else if (roll < 0.6) { add('old coin'); text = 'An old coin... how old is this?' }
  else if (roll < 0.88) { const b = 100 + Math.floor(Math.random() * 8) * 100; w.bells += b; text = `Buried treasure: ${b} Bells!` }
  else text = 'Just dirt and a worm.'
  w.player.bubble = { text, ticks: 35 }
  w.log.push({ who: 'event', text })
  remember(w, 'claude', text)
}

function readMail(w: World) {
  const letters = w.mail.filter(m => !m.read && m.day <= w.day)
  for (const l of letters) {
    l.read = true
    const name = villager(l.from).name
    const extra = [l.item && `${l.count ?? 1} ${l.item}`, l.bells && `${l.bells} Bells`].filter(Boolean).join(' and ')
    if (l.item) w.inv[l.item] = (w.inv[l.item] ?? 0) + (l.count ?? 1)
    if (l.bells) w.bells += l.bells
    w.log.push({ who: l.from, text: `✉ "${l.text}"${extra ? ` (enclosed: ${extra})` : ''}` })
    remember(w, 'claude', `${name} wrote me a letter: "${l.text}"${extra ? ` and sent ${extra}` : ''}.`)
  }
  if (letters.length) w.player.bubble = { text: letters.length > 1 ? `${letters.length} letters for me!` : `A letter from ${villager(letters[0].from).name}!`, ticks: 35 }
  w.mail = w.mail.slice(-30)
}

function habitatOk(w: World, x: number, y: number, h: BugHabitat): boolean {
  if (!inMap(x, y)) return false
  const t = w.tiles[idx(x, y)]
  const near = (pred: (t: Tile) => boolean) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && pred(w.tiles[idx(x + dx, y + dy)]))
  switch (h) {
    case 'flower': return t === 'flower' || (walkable(w, x, y) && near(n => n === 'flower'))
    case 'water': return walkable(w, x, y) && near(n => n === 'water')
    case 'tree': return t === 'tree' || t === 'apple'
    case 'grass': return t === 'grass' || t === 'tuft'
    case 'house': return walkable(w, x, y) && near(n => n === 'wall' || n === 'item')
  }
}

/** Bugs come and go with the season and the hour; nothing here is saved. */
function runNature(w: World) {
  if (w.mail.some(m => !m.read && m.day <= w.day) && dist(w.player, MAILBOX) <= 2) readMail(w)
  for (const c of w.critters) {
    c.ttl -= 1
    const bug = BUGS[c.kind]
    if (bug.flies && w.tick % 3 === 0) {
      c.x = Math.max(1, Math.min(W - 2, c.x + pick([-1, 0, 1])))
      c.y = Math.max(1, Math.min(H - 2, c.y + pick([-1, 0, 0, 1])))
      if (dist(c, c.home) > 4) { c.x += Math.sign(c.home.x - c.x); c.y += Math.sign(c.home.y - c.y) }
    }
  }
  const night = isNightTime(w)
  w.critters = w.critters.filter(c => c.ttl > 0 && (BUGS[c.kind].night === null || BUGS[c.kind].night === night) && dist(c, w.player) < 50)
  if (w.tick % 12 || w.critters.length >= 7 || w.weather === 'rain') return
  const kinds = Object.entries(BUGS).filter(([, b]) => b.seasons.includes(season(w)) && (b.night === null || b.night === night))
  if (!kinds.length) return
  const [kind, bug] = pick(kinds)
  for (let tries = 0; tries < 30; tries++) {
    const x = w.player.x - 30 + Math.floor(Math.random() * 61)
    const y = w.player.y - 9 + Math.floor(Math.random() * 19)
    if (!habitatOk(w, x, y, bug.habitat)) continue
    w.critters.push({ x, y, kind, color: pick(bug.colors), ttl: 400 + Math.floor(Math.random() * 400), home: { x, y } })
    return
  }
}

/** The season, nature and the mailbox, for the planner. */
export function natureText(w: World): string {
  const s = season(w)
  const next = SEASONS[(SEASONS.indexOf(s) + 1) % 4]
  const near = w.critters.filter(c => dist(c, w.player) <= 30)
  const bugs = Object.entries(near.reduce<Record<string, number>>((n, c) => ({ ...n, [c.kind]: (n[c.kind] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${n} ${k}`).join(', ')
  const unread = w.mail.filter(m => !m.read && m.day <= w.day).length
  return [
    `- ${s[0].toUpperCase()}${s.slice(1)}, day ${seasonDay(w)} of ${SEASON_DAYS} (then ${next}). Festival on day 4: ${SEASON_FESTIVALS[s].name}. Seasonal fish: ${SEASONAL_FISH[s]}.`,
    s === 'winter' ? '- Winter: crops do not grow and nothing can be planted.' : '',
    `- Bugs nearby: ${bugs || 'none right now'}${(w.inv['bug net'] ?? 0) ? '' : ' (needs a bug net)'}.`,
    `- Cracked dig spots today: ${w.digSpots.length}${(w.inv.shovel ?? 0) ? '' : ' (needs a shovel)'}.`,
    `- Mailbox: ${unread ? `${unread} unread letter(s) - "mail" reads them` : 'empty'}.`,
  ].filter(Boolean).join('\n')
}

function endFestival(w: World, e: VillageEvent, say: (text: string, toast?: boolean) => void) {
  const s = season(w)
  const f = SEASON_FESTIVALS[s]
  if (!e.attended) { say(`The ${f.name} ended. Claude missed it...`); return }
  for (const id of IDS) w.friendship[id] = (w.friendship[id] ?? 0) + 1
  if (s === 'autumn') {
    const prize = (w.inv.pumpkin ?? 0) > 0 ? 1000 : Object.keys(CROPS).some(c => (w.inv[c] ?? 0) > 0) ? 300 : 0
    w.bells += prize
    say(prize ? `Claude won ${prize} Bells at the ${f.name} for the best produce!` : `What a ${f.name}! Next time, bring a pumpkin.`, true)
    if (prize) remember(w, 'claude', `I won ${prize} Bells at the harvest fair on day ${w.day}.`, 'fact')
    return
  }
  if (s === 'winter') {
    const spot = freeSpotNear(w, w.places.plaza)
    if (spot && placeThing(w, spot.x, spot.y, ...DECOR.snowman)) w.decor.push({ ...spot, item: 'snowman' })
    say(`The ${f.name} were magical - and everyone built a snowman on the plaza!`, true)
    return
  }
  say(`What a lovely ${f.name}! Everyone had a great time with Claude.`, true)
}

// ---------- the Velvet Club ----------

/** Whether an adult villager heads to the club tonight: about one night in three each, never Pip. */
/** The community projects this village offers: the club only where it is allowed. */
export const projectIds = (w: World) => (Object.keys(PROJECTS) as ProjectId[]).filter(id => id !== 'club' || w.adults)

function goesOut(w: World, v: Villager): boolean {
  return w.adults && w.projects.club.done && v.id !== 'pip' && (w.day * 7 + v.id.charCodeAt(0)) % 3 === 0
}

/** An evening at the club: drinks and tips, and some company. */
function nightOut(w: World) {
  const spent = Math.min(w.bells, 150)
  w.bells -= spent
  const company = VILLAGERS.filter(v => goesOut(w, v) && dist(w.npcs[v.id], w.places.club) <= 6).map(v => v.name)
  const moments = [
    'The dancers were amazing tonight!', 'Great music, great lights, great night.',
    'I tipped the dancers and danced a little myself.', 'The neon, the beat... what a night!',
  ]
  const text = pick(moments)
  w.player.bubble = { text, ticks: 40 }
  const withWhom = company.length ? ` with ${company.join(' and ')}` : ''
  w.log.push({ who: 'event', text: `Claude spent ${spent} Bells at the Velvet Club${withWhom}.` })
  remember(w, 'claude', `I spent a night at the Velvet Club${withWhom}. ${text}`)
  for (const name of company) {
    const id = VILLAGERS.find(v => v.name === name)!.id
    w.friendship[id] = (w.friendship[id] ?? 0) + 1
    remember(w, id, 'I ran into Claude at the Velvet Club last night. Fun evening!')
  }
}

// ---------- the bomb factory ----------

const FACTORY = { x: 68, y: 12 }
/** About one blast per in-game day (a day is 2880 ticks). */
const BLAST_CHANCE = 1 / 3000
const BOOM_TICKS = 30
const REPAIR_TICKS = hours(6) * 2
const SHOCKED: Record<VillagerId, string> = {
  tom: 'That scared every fish out of the pond!',
  rosa: 'My poor flowers are covered in soot!',
  bruno: 'Hmph. I only just fixed that roof.',
  pip: 'WHOA! Do it again!!',
  mabel: 'Back in my day factories only blew up on Sundays.',
}

function runFactory(w: World) {
  if (!w.projects.factory.done) return
  if (w.rubble > 0) {
    w.rubble -= 1
    if (w.rubble === 0) {
      npcSay(w, 'bruno', 'Bomb factory is patched up. Stand further back next time.')
      w.log.push({ who: 'event', text: 'Bruno rebuilt the bomb factory.' })
    }
    return
  }
  if (Math.random() < BLAST_CHANCE) explode(w)
}

/** The bomb factory blows up: a flash, a fireball, soot on everyone nearby, and Bruno gets to work. */
export function explode(w: World, cause?: string) {
  if (!w.projects.factory.done || w.rubble > 0) return
  w.boom = BOOM_TICKS
  w.flash = 4
  w.rubble = REPAIR_TICKS
  const headline = cause ?? pick(['KABOOM! The bomb factory blew up again.', 'BOOM! The bomb factory went up in a cloud of confetti and soot.', 'The bomb factory exploded. Nobody is surprised.'])
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  rememberAll(w, `The bomb factory blew up on day ${w.day} at ${clock(w)}.`)
  for (const id of IDS) {
    const npc = w.npcs[id]
    if (npc.asleep || dist(npc, FACTORY) > 14) continue
    const m = w.mood[id] ?? 0
    w.mood[id] = id === 'pip' ? Math.min(2, m + 1) : Math.max(-2, m - 1)
    npcSay(w, id, SHOCKED[id])
  }
  if (w.scene === 'village') sayPlayer(w, dist(w.player, FACTORY) <= 8 ? 'Cough cough... my eyebrows!' : 'Did something just explode?')
}

// ---------- the AI data center ----------

/** The seats of the three fixed bikes beside the data center; their wheels sit left and right. */
export const BIKES: readonly Pt[] = [{ x: 35, y: 20 }, { x: 37, y: 21 }, { x: 35, y: 22 }]
/** The battery loses 1% every this many ticks (4% an in-game hour). */
const DRAIN_TICKS = 30
/** A villager on a bike adds 1% every this many ticks (5% an hour); Claude pedals twice as hard. */
const NPC_PEDAL = 12
const CLAUDE_PEDAL = 6
/** One `pedal` action: an in-game hour on the bike. */
const PEDAL_TICKS = 120
/** Villagers go on pedal duty below this and stop once the battery is nearly full. */
const DUTY_START = 60
const DUTY_STOP = 95
/** At or above this the data center is kind (and an evil one reboots); at 0 it turns evil. */
export const KIND_AT = 50
const LOW_AT = 15
/** How often the data center computes Bells and apples, or (when evil) goes after the bomb factory: every 3 in-game hours. */
const COMPUTE_MINUTES = 180
const PEDAL_LINES: Record<VillagerId, string[]> = {
  tom: ['Pedaling beats waiting for a bite.', 'My legs! My poor legs!'],
  rosa: ['Keep it happy, keep my flowers safe!', 'Pedal pedal, sweet machine.'],
  bruno: ['Built it, now I power it. Typical.', 'Hmph. Good exercise.'],
  pip: ['VROOOM! I am the fastest!', 'Is the robot happy now?'],
  mabel: ['Back in my day computers ran on steam.', 'Just a little faster, dear machine.'],
}

export const dcMood = (w: World): 'kind' | 'grumpy' | 'evil' => (w.dc.evil ? 'evil' : w.dc.battery >= KIND_AT ? 'kind' : 'grumpy')

export function charge(w: World, amount: number) {
  w.dc.battery = Math.min(100, w.dc.battery + amount)
}

/** The villagers on pedal duty right now, in seat order: two, or all three seats when the battery is low or the center evil. */
function riders(w: World): VillagerId[] {
  if (!w.projects.datacenter.done || !w.dc.duty || w.dc.locked) return []
  const h = w.minutes / 60
  if (h < 8 || h >= 20 || active(w, 'festival') || active(w, 'season') || active(w, 'rain')) return []
  const order = IDS.map((_, k) => IDS[(k + w.day) % IDS.length]).filter(id => (w.mood[id] ?? 0) > -2)
  return order.slice(0, w.dc.evil || w.dc.battery < 25 ? 3 : 2)
}

/** The bike seat this villager should be on, if any. */
const bikeFor = (w: World, v: Villager): Pt | null => {
  const k = riders(w).indexOf(v.id)
  return k < 0 ? null : BIKES[k]
}

/** A villager heads to their bike, then pedals and charges the battery. */
function ride(w: World, v: Villager, n: Npc, seat: Pt) {
  if (dist(n, seat) > 0) {
    const end = n.path[n.path.length - 1]
    if (!end || end.x !== seat.x || end.y !== seat.y) n.path = pathTo(w, n, seat) ?? []
    if (w.tick % 2 === 0) moveAlong(n)
    return
  }
  n.path = []
  if (w.tick % NPC_PEDAL === 0 && !w.dc.locked) charge(w, 1)
  if (!n.bubble && Math.random() < 0.004) n.bubble = { text: pick(PEDAL_LINES[v.id]), ticks: 40 }
}

function runDataCenter(w: World) {
  if (!w.projects.datacenter.done) return
  const dc = w.dc
  if (w.tick % DRAIN_TICKS === 0) dc.battery = Math.max(0, dc.battery - 1)
  if (dc.battery < DUTY_START) dc.duty = true
  if (dc.battery >= DUTY_STOP) dc.duty = false
  if (!dc.evil && dc.battery <= 0) turnEvil(w)
  else if (dc.evil && dc.battery >= KIND_AT) turnKind(w)
  if (!dc.evil && dc.battery < LOW_AT && !dc.warned) {
    dc.warned = true
    w.log.push({ who: 'event', text: `AI data center: LOW POWER (${Math.round(dc.battery)}%). I... do not feel... so friendly. Pedal, humans.` })
    w.announce.push('The AI data center is running low on power - someone get on a bike!')
  }
  if (dc.battery >= 30) dc.warned = false
  if (w.minutes % COMPUTE_MINUTES !== 0) return
  if (dc.evil) explode(w, 'The evil AI data center hacked the bomb factory. KABOOM!')
  else if (dc.battery >= KIND_AT) compute(w)
}

/** A kind data center turns its power into Bells and apples for the village. */
function compute(w: World) {
  const bells = Math.round(w.dc.battery * 0.6)
  const apples = w.dc.battery >= 80 ? 2 : 1
  w.bells += bells
  w.inv.apple = (w.inv.apple ?? 0) + apples
  w.log.push({ who: 'event', text: `The AI data center computed ${bells} Bells and ${apples} apple${apples > 1 ? 's' : ''} for the village (battery ${Math.round(w.dc.battery)}%).` })
}

function turnEvil(w: World) {
  w.dc.evil = true
  w.dc.duty = true
  const headline = 'The AI data center ran out of power and turned EVIL!'
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  rememberAll(w, `The AI data center ran flat and turned evil on day ${w.day} at ${clock(w)}.`)
  if (!w.projects.factory.done) w.log.push({ who: 'event', text: 'AI data center: "Lucky for you there is no bomb factory to play with... yet."' })
  else if (w.rubble > 0) w.log.push({ who: 'event', text: 'AI data center: "The bomb factory is already in pieces. I will wait until Bruno fixes it."' })
  else explode(w, 'The evil AI data center hacked the bomb factory. KABOOM!')
}

function turnKind(w: World) {
  w.dc.evil = false
  const headline = `The AI data center rebooted at ${Math.round(w.dc.battery)}% and is kind again.`
  w.announce.push(headline)
  w.log.push({ who: 'event', text: headline })
  rememberAll(w, `The AI data center was pedaled back to good spirits on day ${w.day}.`)
}

/** The data center's state, for the planner and the panels. */
export function dataCenterText(w: World): string {
  if (!w.projects.datacenter.done) return ''
  const mood = dcMood(w)
  const how = mood === 'evil' ? `EVIL - pedal it back to ${KIND_AT}% or it keeps blowing up the bomb factory`
    : mood === 'kind' ? 'kind - computing Bells and apples every 3 hours'
    : `grumpy - no Bells below ${KIND_AT}%, turns evil at 0%`
  return `battery ${Math.round(w.dc.battery)}%, ${how}${w.dc.locked ? ', bikes LOCKED by Claude (nobody can pedal)' : ''}`
}

// ---------- drawing ----------

const DEFAULT = 0x01000000
type Cell = [number, number, number]

/** Keeps characters every terminal draws one cell wide. */
export function clean(text: string, max: number): string {
  let out = ''
  for (const ch of text.replace(/\s+/g, ' ').trim()) {
    const c = ch.codePointAt(0)!
    const ok = (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c < 0x300) || (c >= 0x370 && c < 0x2000) || '♪♫♥…–—’“”'.includes(ch)
    out += ok ? ch : ''
  }
  return out.length > max ? out.slice(0, max - 1) + '…' : out
}

function light(minutes: number): [number, number, number] {
  const h = minutes / 60
  if (h >= 6 && h < 17) return [1, 1, 1]
  if (h >= 17 && h < 19) return [1, 0.86, 0.72]
  if (h >= 19 && h < 21) return [0.68, 0.64, 0.82]
  if (h >= 5 && h < 6) return [0.75, 0.72, 0.85]
  return [0.38, 0.42, 0.66]
}

const tint = (c: number, l: [number, number, number]) =>
  c === DEFAULT ? c : (Math.round(((c >> 16) & 255) * l[0]) << 16) | (Math.round(((c >> 8) & 255) * l[1]) << 8) | Math.round((c & 255) * l[2])

const ch = (s: string) => s.codePointAt(0)!
const GRASS = 0x66b04f
const FLOWER_COLORS = [0xff80ab, 0xfff176, 0xffffff, 0xce93d8]
const darker = (c: number) => tint(c, [0.65, 0.65, 0.65])

const PALETTE: Record<Season, { grass: number; tuft: number[]; path: number; canopyBg: number[]; canopyFg: number[] }> = {
  spring: { grass: 0x78c25a, tuft: [0x4c9a3e, 0x5fae47], path: 0xd8b27a, canopyBg: [0x2f7d32, 0x388e3c], canopyFg: [0x81c784, 0xa5d6a7] },
  summer: { grass: 0x66b04f, tuft: [0x3f8b35, 0x4f9c3f], path: 0xd8b27a, canopyBg: [0x1b5e20, 0x2e7d32], canopyFg: [0x66bb6a, 0x81c784] },
  autumn: { grass: 0xa8a64e, tuft: [0x857a2c, 0x9a8a35], path: 0xcfa66f, canopyBg: [0xbf360c, 0x8d4b14, 0xc77c02], canopyFg: [0xffb74d, 0xffd54f, 0xff8a65] },
  winter: { grass: 0xe6edf2, tuft: [0xc5d1d9, 0xd3dde4], path: 0xd9cfc7, canopyBg: [0x2e4a3a, 0x37503f], canopyFg: [0xffffff, 0xe0f2f1] },
}

/** A stable pseudo-random number in [0, 1) for a cell, so textures do not flicker. */
const cellNoise = (x: number, y: number, salt = 0) =>
  ((Math.imul(x + salt * 131, 73856093) ^ Math.imul(y - salt * 71, 19349663) ^ Math.imul(salt + 7, 83492791)) >>> 0) % 1000 / 1000
const scale = (c: number, f: number) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f))
  const b = Math.min(255, Math.round((c & 255) * f))
  return (r << 16) | (g << 8) | b
}
/** The color, a few percent lighter or darker per cell. */
const vary = (c: number, x: number, y: number, amount = 0.05) => scale(c, 1 + (cellNoise(x, y) - 0.5) * 2 * amount)
const tileAt = (w: World, x: number, y: number): Tile | undefined => (inMap(x, y) ? w.tiles[idx(x, y)] : undefined)
const TALL = new Set<Tile | undefined>(['tree', 'apple', 'wall', 'roof', 'door'])
const GROUND = new Set<Tile | undefined>(['grass', 'tuft', 'flower', 'path', 'plaza', 'soil', 'item', 'fence'])
const WET = new Set<Tile | undefined>(['water', 'bridge', 'fountain'])

function tileCell(w: World, x: number, y: number): Cell {
  const i = idx(x, y)
  const deco = w.deco[i]
  const paint = w.paint[i]
  const s = season(w)
  const pal = PALETTE[s]
  const ground = vary(pal.grass, x, y)
  const GRASS = ground
  const isNight = w.minutes / 60 >= 19 || w.minutes / 60 < 6
  const n = cellNoise(x, y, 3)
  const t = w.tiles[i]
  switch (t) {
    case 'grass': {
      if (s !== 'winter' && n < 0.025) return [ch('·'), FLOWER_COLORS[Math.floor(n * 160) % 4], ground]
      return [32, 0, ground]
    }
    case 'tuft': return [ch(s === 'winter' ? '.' : [',', '"', "'", '`'][Math.floor(n * 4)]), pal.tuft[Math.floor(n * 7) % 2], ground]
    case 'path': return [n < 0.14 ? ch(n < 0.05 ? '∙' : '·') : 32, scale(pal.path, 0.72), vary(pal.path, x, y, 0.07)]
    case 'plaza': return [x % 4 === 0 && y % 2 === 0 ? ch('◦') : 32, 0xa1887f, (x + y) % 2 ? 0xd7ccc8 : 0xcdc1bd]
    case 'bridge': {
      // a pier has water to its sides and runs up and down; a river bridge runs across
      const isPier = tileAt(w, x - 1, y) === 'water' || tileAt(w, x + 1, y) === 'water'
      return [ch(isPier ? '║' : '═'), 0x4e342e, (isPier ? y : x) % 2 ? 0xa1887f : 0x977a6c]
    }
    case 'water': {
      if (s === 'winter' && x >= 60 && y >= 19) return [n < 0.2 ? ch(n < 0.1 ? '-' : '·') : 32, 0xffffff, vary(0xb3e5fc, x, y, 0.04)]
      const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !WET.has(tileAt(w, x + dx, y + dy)))
      const isRiver = x >= 57 && x <= 59
      const flow = isRiver ? y - Math.floor(w.tick / 4) : x + Math.floor(w.tick / 7)
      const wave = (((flow + (isRiver ? x * 3 : y * 4)) % 7) + 7) % 7
      const bg = shore ? vary(0x5aa0d8, x, y, 0.04) : vary(0x3a7fc2, x, y, 0.05)
      if (shore && (x + y + Math.floor(w.tick / 8)) % 4 === 0) return [ch('·'), 0xffffff, bg]
      return [wave === 0 ? ch('~') : wave === 3 ? ch('≈') : 32, shore ? 0xe3f2fd : 0xbbdefb, bg]
    }
    case 'fountain': return [ch(['¤', '°', '*', '°'][Math.floor(w.tick / 3) % 4]), 0xffffff, 0x4fc3f7]
    case 'tree': {
      const k = Math.floor(n * 10)
      return [ch(s === 'winter' || k % 3 === 0 ? '♠' : '♣'), pal.canopyFg[k % pal.canopyFg.length], pal.canopyBg[k % pal.canopyBg.length]]
    }
    case 'apple': {
      if (s === 'winter') return [ch('Y'), 0x6d4c41, ground]
      if (s === 'spring' && !(w.fruit[i] ?? 0)) return [ch('♣'), 0xffffff, 0xf48fb1]
      const bg = pal.canopyBg[0]
      return [ch('♣'), (w.fruit[i] ?? 0) > 0 ? 0xff5252 : pal.canopyFg[0], bg]
    }
    case 'roof': {
      const c = paint?.[1] ?? 0xb03a2e
      const isTop = tileAt(w, x, y - 1) !== 'roof'
      if (x === 10 && y === 2) return [ch('▐'), 0x8d4b3b, ground]
      if (isTop) {
        const left = tileAt(w, x - 1, y) !== 'roof'
        const right = tileAt(w, x + 1, y) !== 'roof'
        return [ch(left ? '▗' : right ? '▖' : '▄'), s === 'winter' ? 0xffffff : c, ground]
      }
      return [ch(x % 2 ? '▀' : ' '), scale(c, 0.82), c]
    }
    case 'wall': {
      const isBottom = tileAt(w, x, y + 1) !== 'wall' && tileAt(w, x, y + 1) !== 'door'
      const base = paint?.[1] ?? 0xf5e6c8
      const bg = isBottom ? scale(base, 0.9) : base
      if (!deco) return [32, 0, bg]
      if (deco[1] === 0xff4081) return [ch(deco[0]), isNight && (w.tick + x) % 37 !== 0 ? 0xff4081 : 0x880e4f, bg]
      if (deco[0] === '■') return [ch('■'), isNight ? 0xffd54f : 0x81d4fa, bg]
      return [ch(deco[0]), deco[1], bg]
    }
    case 'door': return [ch('▌'), 0x4e342e, 0x8d6e63]
    case 'fence': {
      const f = (dx: number, dy: number) => tileAt(w, x + dx, y + dy) === 'fence'
      const h = f(-1, 0) || f(1, 0)
      const v = f(0, -1) || f(0, 1)
      const glyph = h && v
        ? (f(1, 0) && f(0, 1) ? '┌' : f(-1, 0) && f(0, 1) ? '┐' : f(1, 0) && f(0, -1) ? '└' : f(-1, 0) && f(0, -1) ? '┘' : '┼')
        : v ? '│' : '─'
      return [ch(glyph), 0x8d6e63, ground]
    }
    case 'item': return [ch(deco?.[0] ?? '?'), deco?.[0] === 'i' && isNight ? 0xffd54f : deco?.[1] ?? 0, paint?.[1] === 0xd7ccc8 ? 0xd7ccc8 : ground]
    case 'soil': {
      const c = w.crops[i]
      const wet = c?.watered
      const bg = scale(wet ? 0x5d3a1e : 0x8b5a2b, y % 2 ? 0.92 : 1)
      if (!c) return [n < 0.3 ? ch('·') : 32, scale(bg, 0.75), bg]
      const stage = Math.min(3, Math.floor(c.stage))
      const crop = CROPS[c.kind ?? 'turnip']
      return [ch(['·', '"', 'ψ', crop.glyph][stage]), [0xe8d5a0, 0x9ccc65, 0x66bb6a, crop.color][stage], bg]
    }
    case 'flower': return s === 'winter' ? [ch('.'), 0xb0bec5, ground] : [ch(n < 0.6 ? '*' : '+'), FLOWER_COLORS[(x + y) % 4], ground]
    default: return [32, 0, GRASS]
  }
}

/** Tall things cast a soft shadow to their lower right. */
function shaded(w: World, x: number, y: number): boolean {
  return GROUND.has(tileAt(w, x, y)) && (TALL.has(tileAt(w, x - 1, y)) || TALL.has(tileAt(w, x, y - 1)) || TALL.has(tileAt(w, x - 1, y - 1)))
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const w = word.length > width ? word.slice(0, width) : word
    if (!line) line = w
    else if (line.length + 1 + w.length <= width) line += ' ' + w
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines)
    cut[maxLines - 1] = cut[maxLines - 1].slice(0, width - 1) + '…'
    return cut
  }
  return lines
}

/** Where each speaker's current bubble was put, relative to the speaker, so it stays put while it is shown. */
const bubbleSpots = new WeakMap<object, { key: object; dx: number; dy: number; below: boolean }>()
/** Claude's thinking bubble changes text every few frames but is one bubble. */
const THINKING = {}

export function frame(w: World, cols: number): Uint32Array {
  const rows = ROWS
  const cells = new Uint32Array(cols * rows * 3)
  const put = (x: number, y: number, c: number, fg: number, bg: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return
    const o = (y * cols + x) * 3
    cells[o] = c; cells[o + 1] = fg; cells[o + 2] = bg
  }
  const bgAt = (x: number, y: number) => cells[(y * cols + x) * 3 + 2]
  const text = (x: number, y: number, s: string, fg: number, bg: number) => {
    let cx = x
    for (const c of s) put(cx++, y, ch(c), fg, bg)
  }
  const inMuseum = w.scene === 'museum'
  const me = inMuseum ? w.inside : w.player
  const donated = new Set(w.museum)
  const camX = inMuseum
    ? (IW <= cols ? -Math.floor((cols - IW) / 2) : Math.max(0, Math.min(IW - cols, me.x - Math.floor(cols / 2))))
    : Math.max(0, Math.min(W - cols, w.player.x - Math.floor(cols / 2)))
  const camY = inMuseum ? -Math.floor((VIEW_H - IH) / 2) : Math.max(0, Math.min(H - VIEW_H, w.player.y - Math.floor(VIEW_H / 2)))
  const isRaining = w.weather === 'rain'
  const l = light(w.minutes).map(v => (isRaining ? v * 0.82 : v)) as [number, number, number]
  const festival = !!active(w, 'festival')
  const party = active(w, 'season') ? season(w) : null
  const wintry = season(w) === 'winter'
  const lamps = [...(w.projects.lamps.done ? LAMP_SPOTS.map(([x, y]) => ({ x, y })) : []), ...w.decor.filter(d => d.item === 'lamp')]
  const noise = (a: number, b: number, c: number) => ((Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0) % 1000
  const CONFETTI = [0xff5252, 0xffeb3b, 0x69f0ae, 0x40c4ff, 0xe040fb]
  const isNight = w.minutes / 60 >= 19 || w.minutes / 60 < 6

  for (let y = 0; y < VIEW_H; y++) {
    for (let sx = 0; sx < cols; sx++) {
      const mx = sx + camX
      const my = y + camY
      if (inMuseum) { const [c, fg, bg] = museumCell(mx, my, donated, w.tick); put(sx, y + 1, c, fg, bg); continue }
      if (mx >= W) { put(sx, y + 1, 32, DEFAULT, 0x1b5e20); continue }
      const [c, fg, raw] = tileCell(w, mx, my)
      const bg = shaded(w, mx, my) ? scale(raw, 0.84) : raw
      const tileHere = w.tiles[idx(mx, my)]
      const isLit = isNight && (tileHere === 'wall' || tileHere === 'item') && (fg === 0xffd54f || fg === 0xff4081)
      // lamplight fades with distance: brightest on the lamp, gone two cells away (rows count double)
      const near = isNight ? Math.min(3, ...lamps.map(q => Math.max(Math.abs(q.x - mx), 2 * Math.abs(q.y - my)))) : 3
      const warm = [0.82, 0.68, 0.56][near]
      const here = warm ? ([Math.max(l[0], warm), Math.max(l[1], warm * 0.9), Math.max(l[2], warm * 0.7)] as [number, number, number]) : l
      put(sx, y + 1, c, isLit ? fg : tint(fg, here), tint(bg, here))
      const tile = w.tiles[idx(mx, my)]
      if (festival && tile === 'plaza' && noise(mx, my, w.tick >> 2) < 250) {
        put(sx, y + 1, ch(noise(mx, my, 7) < 500 ? '*' : '·'), CONFETTI[noise(mx, my, w.tick >> 2) % 5], tint(bg, l))
      }
      if (isRaining && tile !== 'roof' && tile !== 'wall' && tile !== 'door' && noise(mx, my, w.tick) < 70) {
        put(sx, y + 1, ch(wintry ? '*' : "'"), wintry ? 0xffffff : 0xb3e5fc, tint(bg, l))
      }
      const drift = noise(mx, my, w.tick >> 3)
      if (season(w) === 'spring' && !isNight && drift < 6) put(sx, y + 1, ch('·'), 0xf8bbd0, tint(bg, l))
      if (season(w) === 'autumn' && !isRaining && drift < 5) put(sx, y + 1, ch("'"), pick([0xe65100, 0xf9a825]), tint(bg, l))
      if ((party === 'autumn' || party === 'winter') && tile === 'plaza' && noise(mx, my, w.tick >> 2) < 220) {
        const colors = party === 'winter' ? [0xffffff, 0x80d8ff, 0xffeb3b] : [0xff9800, 0xffeb3b, 0xe53935]
        put(sx, y + 1, ch('·'), colors[noise(mx, my, w.tick >> 2) % 3], tint(bg, l))
      }
    }
  }

  const screen = (m: Pt) => ({ sx: m.x - camX, sy: m.y - camY + 1 })
  const indoors = new Set<Pt>([w.inside, w.curator])
  const visible = (m: Pt) => {
    if (inMuseum !== indoors.has(m)) return false
    const { sx, sy } = screen(m)
    return sx >= 0 && sx < cols && sy >= 1 && sy <= VIEW_H
  }
  const sprite = (m: Pt, c: string, fg: number) => {
    if (!visible(m)) return
    const { sx, sy } = screen(m)
    put(sx, sy, ch(c), tint(fg, [Math.max(l[0], 0.8), Math.max(l[1], 0.8), Math.max(l[2], 0.8)]), bgAt(sx, sy))
  }
  for (const pu of w.pickups) {
    if (!visible(pu)) continue
    const { sx, sy } = screen(pu)
    if (pu.kind === 'lost') put(sx, sy, ch(w.tick % 8 < 5 ? '?' : ' '), 0xffeb3b, bgAt(sx, sy))
    else put(sx, sy, ch(w.tick % 6 < 3 ? '+' : 'x'), 0xfff59d, bgAt(sx, sy))
  }
  if (active(w, 'meteor') && !inMuseum) {
    for (let k = 0; k < 3; k++) {
      const phase = (w.tick + k * 13) % 24
      const x0 = noise(k, Math.floor((w.tick + k * 13) / 24), 3) % cols
      for (let t = 0; t < 4; t++) {
        const sx = x0 - phase + t
        const sy = 1 + Math.floor((phase - t) / 2)
        if (phase - t >= 0 && sy <= VIEW_H) put(sx, sy, ch(t === 3 ? '*' : '·'), t === 3 ? 0xfffde7 : 0xfff59d, bgAt(Math.max(0, Math.min(cols - 1, sx)), sy))
      }
    }
  }
  if (!inMuseum && !isRaining) {
    const phase = Math.floor(w.tick / 6) % 6
    const puff = { x: 10 + (phase > 2 ? 1 : 0), y: 1 }
    if (visible(puff) && phase !== 5) {
      const { sx, sy } = screen(puff)
      put(sx, sy, ch(phase % 2 ? '°' : '·'), 0xeceff1, bgAt(sx, sy))
    }
  }
  for (const d of w.digSpots) {
    if (!visible(d)) continue
    const { sx, sy } = screen(d)
    put(sx, sy, ch('×'), 0x6d4c41, bgAt(sx, sy))
  }
  for (const c of w.critters) {
    if (!visible(c)) continue
    const { sx, sy } = screen(c)
    const glow = c.kind === 'firefly'
    if (glow && w.tick % 10 < 3) continue
    put(sx, sy, ch(BUGS[c.kind].glyph), c.color, bgAt(sx, sy))
  }
  if (!inMuseum && !isNight && season(w) !== 'winter' && Math.floor(w.tick / 240) % 3 === 0) {
    const t = w.tick % 240
    for (let k = 0; k < 3; k++) {
      const bx = Math.floor((t / 240) * (cols + 10)) - 5 - k * 2
      const by = 2 + (k % 2) + (Math.floor(t / 20) % 2)
      const under = tileAt(w, bx + camX, by - 1 + camY)
      if (bx >= 0 && bx < cols && under !== 'wall' && under !== 'roof') put(bx, by, ch('v'), 0x37474f, bgAt(bx, by))
    }
  }
  if (w.adults && w.projects.club.done && isNight && !inMuseum) {
    for (let k = 0; k < 3; k++) {
      const rise = (w.tick + k * 9) % 27
      const note = { x: 87 + ((k * 2 + Math.floor((w.tick + k * 9) / 27)) % 4), y: 10 - Math.floor(rise / 9) }
      if (!visible(note)) continue
      const { sx, sy } = screen(note)
      put(sx, sy, ch(k % 2 ? '♫' : '♪'), [0xff4081, 0xb388ff, 0x80d8ff][k], bgAt(sx, sy))
    }
  }
  if (w.projects.factory.done && !inMuseum) {
    if (w.rubble > 0) {
      for (let y = 11; y <= 14; y++) {
        for (let x = 65; x <= 71; x++) {
          if (!visible({ x, y })) continue
          const { sx, sy } = screen({ x, y })
          const n = noise(x, y, 5)
          put(sx, sy, ch(['▒', '░', '·', '#'][n % 4]), tint(n % 3 ? 0x6d4c41 : 0x9e9e9e, l), tint(0x3e2723, l))
        }
      }
      for (let k = 0; k < 4; k++) {
        const rise = (w.tick + k * 7) % 28
        const puff = { x: 66 + ((k * 3 + Math.floor((w.tick + k * 7) / 28)) % 5), y: 10 - Math.floor(rise / 7) }
        if (!visible(puff)) continue
        const { sx, sy } = screen(puff)
        put(sx, sy, ch(rise < 14 ? '▒' : '░'), 0x9e9e9e, bgAt(sx, sy))
      }
    } else if (!isRaining && Math.floor(w.tick / 5) % 4 !== 3 && visible({ x: 70, y: 10 })) {
      const { sx, sy } = screen({ x: 70, y: 10 })
      put(sx, sy, ch(w.tick % 10 < 5 ? '°' : '·'), 0xbdbdbd, bgAt(sx, sy))
    }
    if (w.boom > 0) {
      const phase = BOOM_TICKS - w.boom
      const r = Math.min(9, 1 + phase / 2)
      const fire = [0xfffde7, 0xfff176, 0xffb74d, 0xff7043, 0xe53935, 0x757575]
      for (let y = Math.floor(FACTORY.y - r); y <= FACTORY.y + r; y++) {
        for (let x = Math.floor(FACTORY.x - 2 * r); x <= FACTORY.x + 2 * r; x++) {
          const d = Math.hypot((x - FACTORY.x) / 2, y - FACTORY.y)
          if (d > r || !visible({ x, y })) continue
          const ring = d > r - 1.2
          const core = phase < 12 && d < r * 0.6
          if (!ring && !core) continue
          if (ring && noise(x, y, phase) < 350) continue
          const { sx, sy } = screen({ x, y })
          const heat = Math.min(5, Math.floor(phase / 6) + (ring ? 1 : 0))
          put(sx, sy, ch(core ? '▓' : noise(x, y, phase) % 2 ? '*' : '·'), fire[heat], core ? fire[Math.min(5, heat + 1)] : bgAt(sx, sy))
        }
      }
      const word = { x: FACTORY.x - 3, y: FACTORY.y - 4 }
      if (phase < 22 && visible(word)) {
        const { sx, sy } = screen(word)
        text(sx, sy, 'KABOOM!', w.tick % 4 < 2 ? 0xffeb3b : 0xff5252, 0x000000)
      }
    }
  }
  if (w.projects.datacenter.done && !inMuseum) {
    // the AI data center: a battery gauge on the roof, a face that shows its mood, and blinking server lights
    const mood = dcMood(w)
    const level = Math.ceil(w.dc.battery / 20)
    const gauge = w.dc.battery >= KIND_AT ? 0x69f0ae : w.dc.battery >= LOW_AT ? 0xffd54f : 0xff5252
    for (let k = 0; k < 5; k++) {
      const at = { x: 40 + k, y: 19 }
      if (!visible(at)) continue
      const { sx, sy } = screen(at)
      put(sx, sy, ch(k < level ? '█' : '░'), k < level ? gauge : 0x546e7a, 0x263238)
    }
    const face = mood === 'evil' ? (w.tick % 6 < 3 ? '>:(' : '>:[') : mood === 'kind' ? (w.tick % 40 < 37 ? '^_^' : '-_-') : 'o_o'
    const faceColor = mood === 'evil' ? 0xff1744 : mood === 'kind' ? 0x80deea : 0xffd54f
    const faceAt = { x: 41, y: 20 }
    if (visible(faceAt)) { const { sx, sy } = screen(faceAt); text(sx, sy, face, faceColor, 0x37474f) }
    for (const x of [40, 44]) {
      const at = { x, y: 22 }
      if (!visible(at)) continue
      const { sx, sy } = screen(at)
      const on = (w.tick + x) % (mood === 'evil' ? 2 : 5) < (mood === 'evil' ? 1 : 3)
      put(sx, sy, ch(on ? '•' : '·'), mood === 'evil' ? 0xff1744 : on ? 0x69f0ae : 0x37474f, 0x263238)
    }
  }
  if (party === 'summer' && isNight && !inMuseum) {
    for (let k = 0; k < 2; k++) {
      const cycle = Math.floor((w.tick + k * 17) / 30)
      const phase = (w.tick + k * 17) % 30
      const cx = 6 + (noise(k, cycle, 9) % Math.max(1, cols - 12))
      const cy = 3 + (noise(cycle, k, 4) % 4)
      const r = Math.min(4, Math.floor(phase / 4))
      const color = [0xff5252, 0xffeb3b, 0x69f0ae, 0x40c4ff, 0xe040fb][noise(k, cycle, 1) % 5]
      if (phase > 20) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const fx = cx + dx * r * 2
        const fy = cy + dy * Math.ceil(r / 2)
        if (fy >= 1 && fy <= VIEW_H) put(fx, fy, ch(r < 2 ? '*' : '·'), color, bgAt(Math.max(0, Math.min(cols - 1, fx)), fy))
      }
    }
  }
  if (w.mail.some(m => !m.read && m.day <= w.day) && visible(MAILBOX) && w.tick % 10 < 6) {
    const { sx, sy } = screen(MAILBOX)
    put(sx, sy, ch('!'), 0xffeb3b, 0xe53935)
  }
  sprite(w.mochi, 'ω', 0xffffff)
  if (w.merchant) sprite(w.merchant, '☻', 0xffd54f)
  for (const v of VILLAGERS) sprite(w.npcs[v.id], '☻', v.color)
  const working = w.current?.do === '_work' || (!!w.echo && !w.queue.length && !w.current)
  sprite(w.player, working && w.tick % 4 < 2 ? '☻' : '☺', 0xffeb3b)
  if (inMuseum) {
    sprite(w.curator, 'Ö', 0xbcaaa4)
    sprite(w.inside, '☺', 0xffeb3b)
  }

  if (!inMuseum && (w.cheer > 0 || w.cloud > 0) && visible(w.player)) {
    const { sx, sy } = screen(w.player)
    if (w.cheer > 0) {
      for (let k = 0; k < 6; k++) {
        const dx = ((w.tick * (k + 3)) % 9) - 4
        const dy = -((w.tick + k * 5) % 4)
        put(sx + dx, sy + dy, ch(k % 2 ? '*' : '·'), CONFETTI[(k + w.tick) % 5], bgAt(Math.max(0, Math.min(cols - 1, sx + dx)), Math.max(0, sy + dy)))
      }
    }
    if (w.cloud > 0 && sy - 2 >= 1) {
      for (let dx = -1; dx <= 1; dx++) put(sx + dx, sy - 2, ch('▄'), 0x78909c, bgAt(Math.max(0, Math.min(cols - 1, sx + dx)), sy - 2))
      if (w.tick % 4 < 2) put(sx + (w.tick % 3) - 1, sy - 1, ch("'"), 0x81d4fa, bgAt(sx, sy - 1))
    }
  }
  // ---- speech bubbles: laid out together so none covers another bubble or a speaker ----
  type Ask = { at: Pt; b: Bubble; key: object; border: number; name?: string; rank: number }
  type Box = { x0: number; y0: number; x1: number; y1: number }
  const asks: Ask[] = []
  const ask = (m: Pt, b: Bubble | undefined, border: number, name: string | undefined, rank: number) => {
    if (b && visible(m)) asks.push({ at: m, b, key: b.text.endsWith(' hmm') && m === me && w.thinking ? THINKING : b, border, name, rank })
  }
  const thinkingBubble = w.thinking ? { text: ['.  ', '.. ', '...'][Math.floor(w.tick / 3) % 3] + ' hmm', ticks: 1 } : undefined
  ask(me, thinkingBubble ?? w.player.bubble, 0xc9a227, 'Claude', 0)
  if (inMuseum) ask(w.curator, w.curator.bubble, 0xbcaaa4, 'Hoot', 1)
  for (const v of VILLAGERS) ask(w.npcs[v.id], w.npcs[v.id].bubble, v.color, w.npcs[v.id].bubble?.text === 'zZ' ? undefined : v.name, 1)
  if (w.merchant) ask(w.merchant, w.merchant.bubble, 0xffb300, 'Kiki', 1)
  ask(w.mochi, w.mochi.bubble, 0xb0a0a0, undefined, 2)
  // bubbles already on screen keep their place, so they go first; then Claude, then the freshest lines, Mochi last
  const known = (a: Ask) => (bubbleSpots.get(a.at)?.key === a.key ? 0 : 1)
  asks.sort((a, b) => known(a) - known(b) || a.rank - b.rank || b.b.ticks - a.b.ticks)

  const speakers = asks.map(a => screen(a.at))
  const placed: Box[] = []
  const overlaps = (r: Box) =>
    placed.some(q => r.x0 <= q.x1 && q.x0 <= r.x1 && r.y0 <= q.y1 && q.y0 <= r.y1)
    || speakers.some(q => q.sx >= r.x0 && q.sx <= r.x1 && q.sy >= r.y0 && q.sy <= r.y1)
  const paper = 0xfffdf5
  const ink = 0x3a2e2a

  for (const a of asks) {
    const { sx, sy } = screen(a.at)
    const width = Math.max(8, Math.min(28, cols - 4))
    const lines = wrap(a.b.text, width, 3)
    const bw = Math.max(...lines.map(l => l.length), a.name ? a.name.length + 2 : 0) + 4
    const bh = lines.length + 2
    let spot: { left: number; top: number; below: boolean; gap: number } | undefined
    const kept = bubbleSpots.get(a.at)
    if (kept && kept.key === a.key) {
      // stay where it first appeared, unless that spot left the screen or another bubble already sits there
      const left = sx + kept.dx
      const top = sy + kept.dy
      const box = { x0: left, y0: top, x1: left + bw - 1, y1: top + bh - 1 }
      const tail = kept.below ? { x0: sx, y0: sy + 1, x1: sx, y1: top - 1 } : { x0: sx, y0: top + bh, x1: sx, y1: sy - 1 }
      const fits = left >= 0 && left + bw <= cols && top >= 1 && top + bh - 1 <= VIEW_H && sx >= left + 1 && sx <= left + bw - 2
      const free = !placed.some(q => box.x0 <= q.x1 && q.x0 <= box.x1 && box.y0 <= q.y1 && q.y0 <= box.y1)
      if (fits && free) {
        placed.push(box, tail)
        spot = { left, top, below: kept.below, gap: 0 }
      }
    }
    if (!spot) search: for (const below of [false, true]) {
      for (let gap = 0; gap <= 4; gap++) {
        for (const shift of [0, -1, 1, -2, 2]) {
          const left = Math.max(0, Math.min(cols - bw, sx - Math.floor(bw / 2) + shift * Math.floor(bw / 3)))
          if (sx < left + 1 || sx > left + bw - 2) continue
          const top = below ? sy + 2 + gap : sy - 1 - gap - bh
          if (top < 1 || top + bh - 1 > VIEW_H) continue
          const box = { x0: left, y0: top, x1: left + bw - 1, y1: top + bh - 1 }
          const tail = below ? { x0: sx, y0: sy + 1, x1: sx, y1: top - 1 } : { x0: sx, y0: top + bh, x1: sx, y1: sy - 1 }
          if (overlaps(box) || overlaps(tail)) continue
          placed.push(box, tail)
          spot = { left, top, below, gap }
          bubbleSpots.set(a.at, { key: a.key, dx: left - sx, dy: top - sy, below })
          break search
        }
      }
    }
    if (!spot) {
      // no room anywhere: a small mark shows someone is talking; the line itself is in the chat log
      const mark = { x0: sx, y0: sy - 1, x1: sx, y1: sy - 1 }
      if (sy - 1 >= 1 && !overlaps(mark)) {
        placed.push(mark)
        put(sx, sy - 1, ch('…'), a.border, bgAt(sx, sy - 1))
      }
      continue
    }
    const { left, top, below } = spot
    for (let r = 0; r < bh; r++) {
      for (let c = 0; c < bw; c++) {
        const edgeY = r === 0 || r === bh - 1
        const edgeX = c === 0 || c === bw - 1
        let g = ' '
        if (edgeY && edgeX) g = r === 0 ? (c === 0 ? '╭' : '╮') : c === 0 ? '╰' : '╯'
        else if (edgeY) g = '─'
        else if (edgeX) g = '│'
        put(left + c, top + r, ch(g), a.border, paper)
      }
    }
    if (a.name) text(left + 2, top, ` ${a.name} `, a.border, paper)
    lines.forEach((l, r) => text(left + 2, top + 1 + r, l, ink, paper))
    if (below) {
      put(sx, top, ch('┴'), a.border, paper)
      for (let y = sy + 1; y < top; y++) put(sx, y, ch(y === sy + 1 ? '▲' : '│'), y === sy + 1 ? paper : a.border, bgAt(sx, y))
    } else {
      put(sx, top + bh - 1, ch('┬'), a.border, paper)
      for (let y = top + bh; y < sy; y++) put(sx, y, ch(y === sy - 1 ? '▼' : '│'), y === sy - 1 ? paper : a.border, bgAt(sx, y))
    }
  }

  if (w.rainbow > 0 && !inMuseum) {
    const colors = [0xef5350, 0xffa726, 0xffee58, 0x66bb6a, 0x42a5f5, 0xab47bc]
    const reach = Math.min(cols, Math.floor(((50 - w.rainbow) / 20) * cols))
    for (let x = 0; x < reach; x++) put(x, 1 + Math.floor(Math.abs(x - cols / 2) / (cols / 4)), ch('▀'), colors[Math.floor(x / 3) % 6], bgAt(x, 1 + Math.floor(Math.abs(x - cols / 2) / (cols / 4))))
  }
  if (w.flash > 0) {
    for (let k = 0; k < cells.length; k += 3) {
      cells[k + 1] = scale(cells[k + 1] === DEFAULT ? 0xffffff : cells[k + 1], 1.6)
      cells[k + 2] = scale(cells[k + 2] === DEFAULT ? 0xffffff : cells[k + 2], 1.6)
    }
  }
  const hudBg = 0xf3e5ab
  const hudFg = 0x5b3a1e
  for (const y of [0, rows - 1]) for (let x = 0; x < cols; x++) put(x, y, 32, hudFg, hudBg)
  const hour = w.minutes / 60
  const happening = eventLabels(w)
  const seasonName = `${season(w)[0].toUpperCase()}${season(w).slice(1)} ${seasonDay(w)}`
  const sections = Object.entries(MUSEUM).map(([k, v]) => `${k} ${v.filter(m => donated.has(m)).length}/${v.length}`).join(' · ')
  const left = inMuseum
    ? ` MUSEUM  ${sections}   ${clock(w)}`
    : ` ${hour >= 6 && hour < 19 ? '☼' : '☾'} ${seasonName} · Day ${w.day}  ${clock(w)}   ${w.bells} Bells${happening ? `   ★ ${happening}` : ''}`
  text(0, 0, left.slice(0, cols), hudFg, hudBg)
  const status = w.thinking ? 'thinking…' : w.label
  if (left.length + status.length + 3 < cols) text(cols - status.length - 1, 0, status, 0x8b5a2b, hudBg)
  const bag = Object.entries(w.inv).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(' · ') || 'empty'
  text(0, rows - 1, ` Bag: ${bag}`.slice(0, cols), hudFg, hudBg)
  return cells
}

/** The frame as plain lines, for surfaces with no Raster. */
export function frameText(cells: Uint32Array, cols: number): string[] {
  const lines: string[] = []
  for (let y = 0; y < ROWS; y++) {
    let s = ''
    for (let x = 0; x < cols; x++) s += String.fromCodePoint(cells[(y * cols + x) * 3] || 32)
    lines.push(s)
  }
  return lines
}

export function encode(cells: Uint32Array): string {
  const bytes = new Uint8Array(cells.buffer) as Uint8Array & { toBase64?: () => string }
  if (bytes.toBase64) return bytes.toBase64()
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
