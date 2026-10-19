// The museum's interior: four halls of display cases, the curator's words about each piece, and indoor walking.
// Pure logic, no `$`.

import { BUGS, FOSSILS, MUSEUM, SEASONAL_FISH } from './catalog'

export const IW = 60
export const IH = 16
type Pt = { x: number; y: number }
type ITile = 'wall' | 'floor' | 'carpet' | 'case' | 'door' | 'plant'

const grid: ITile[] = Array(IW * IH).fill('floor')
const titles: Record<number, string> = {}
const at = (x: number, y: number) => y * IW + x
const fill = (x0: number, y0: number, x1: number, y1: number, t: ITile) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[at(x, y)] = t
}
const title = (x: number, y: number, text: string) => { for (let i = 0; i < text.length; i++) titles[at(x + i, y)] = text[i] }

// outer walls, the cross walls between the halls and their openings
fill(0, 0, IW - 1, 0, 'wall'); fill(0, IH - 1, IW - 1, IH - 1, 'wall'); fill(0, 0, 0, IH - 1, 'wall'); fill(IW - 1, 0, IW - 1, IH - 1, 'wall')
fill(1, 9, IW - 2, 9, 'wall'); fill(30, 1, 30, 8, 'wall'); fill(22, 10, 22, 14, 'wall'); fill(38, 10, 38, 14, 'wall')
grid[at(26, 9)] = 'floor'; grid[at(34, 9)] = 'floor'; grid[at(22, 12)] = 'floor'; grid[at(38, 12)] = 'floor'
fill(23, 10, 37, 14, 'carpet')
grid[at(30, IH - 1)] = 'door'
for (const [x, y] of [[24, 10], [36, 10], [24, 14], [36, 14]]) grid[at(x, y)] = 'plant'
title(11, 0, ' AQUARIUM '); title(40, 0, ' INSECTS '); title(6, 9, ' FOSSILS '); title(43, 9, ' ODDITIES ')

/** Which section each case belongs to, and where each piece is shown. */
const SECTION_OF: Record<string, string> = {}
export const CASES: Record<string, Pt> = {}
const place = (pieces: string[], spots: Pt[], section: string) => {
  pieces.forEach((piece, k) => {
    const spot = spots[k]
    if (!spot) return
    CASES[piece] = spot
    SECTION_OF[piece] = section
    grid[at(spot.x, spot.y)] = 'case'
  })
}
place(MUSEUM.fish, [3, 6].flatMap(y => [4, 9, 14, 19, 24].map(x => ({ x, y }))), 'fish')
place(MUSEUM.bugs, [3, 6].flatMap(y => [35, 41, 47, 53].map(x => ({ x, y }))), 'bugs')
place(MUSEUM.fossils, [3, 7, 11, 15, 19].map(x => ({ x, y: 12 })), 'fossils')
place(MUSEUM.oddities, [41, 45, 49, 53, 57].map(x => ({ x, y: 12 })), 'oddities')

export const ENTRANCE: Pt = { x: 30, y: 14 }
export const CURATOR_SPOT: Pt = { x: 30, y: 11 }

const walkableIn = (x: number, y: number) => x >= 0 && y >= 0 && x < IW && y < IH && (grid[at(x, y)] === 'floor' || grid[at(x, y)] === 'carpet')

/** Where to stand to look at a piece: below its case, or above it. */
export function viewSpot(piece: string): Pt {
  const c = CASES[piece] ?? ENTRANCE
  return walkableIn(c.x, c.y + 1) ? { x: c.x, y: c.y + 1 } : { x: c.x, y: c.y - 1 }
}

export function indoorPath(from: Pt, to: Pt): Pt[] {
  const prev = new Int32Array(IW * IH).fill(-2)
  const start = at(from.x, from.y)
  prev[start] = -1
  const queue = [start]
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]
    const p = { x: cur % IW, y: Math.floor(cur / IW) }
    if (p.x === to.x && p.y === to.y) {
      const path: Pt[] = []
      for (let c = cur; c !== start; c = prev[c]) path.unshift({ x: c % IW, y: Math.floor(c / IW) })
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

const FISH_COLORS: Record<string, number> = {
  'sea bass': 0x90a4ae, bluegill: 0x4fc3f7, carp: 0xbcaaa4, koi: 0xff7043, goldfish: 0xffb300,
  sturgeon: 0x78909c, trout: 0xa5d6a7, catfish: 0x8d6e63, salmon: 0xff8a80, pike: 0x9ccc65,
}
const LOOKS: Record<string, [string, number]> = {
  ammonite: ['@', 0xd7ccc8], trilobite: ['¥', 0xbcaaa4], amber: ['o', 0xffb300], 'dino tooth': ['V', 0xfff8e1], 'fern fossil': ['ψ', 0xa1887f],
  'star fragment': ['*', 0xfff176], 'old boot': ['b', 0x8d6e63], 'old coin': ['o', 0xffd54f], amethyst: ['♦', 0xba68c8], ruby: ['♦', 0xe53935],
}
const CASE_BG: Record<string, number> = { fish: 0x1e6fa8, bugs: 0x33691e, fossils: 0x616161, oddities: 0x4a148c }

/** One interior cell: [code point, foreground, background]; outside the walls is dark. */
export function museumCell(x: number, y: number, donated: Set<string>, tick: number): [number, number, number] {
  const cp = (s: string) => s.codePointAt(0)!
  if (x < 0 || y < 0 || x >= IW || y >= IH) return [32, 0, 0x1a1210]
  const i = at(x, y)
  const letter = titles[i]
  switch (grid[i]) {
    case 'wall': return letter ? [cp(letter), 0xffe0b2, 0x4e342e] : [32, 0, 0x4e342e]
    case 'door': return [cp('▒'), 0x3e2723, 0x8d6e63]
    case 'carpet': return [32, 0, (x + y) % 2 ? 0x8e2b2b : 0x9c3333]
    case 'plant': return [cp('♣'), 0x2e7d32, 0x9c3333]
    case 'case': {
      const piece = Object.keys(CASES).find(k => CASES[k].x === x && CASES[k].y === y)!
      const section = SECTION_OF[piece]
      if (!donated.has(piece)) return [cp('·'), 0x757575, 0x3e3e3e]
      if (section === 'fish') return [cp(Math.floor(tick / 8 + x) % 2 ? '>' : '<'), FISH_COLORS[piece] ?? 0xffffff, CASE_BG.fish]
      if (section === 'bugs') return [cp(BUGS[piece].glyph), BUGS[piece].colors[0], CASE_BG.bugs]
      const [g, c] = LOOKS[piece] ?? ['?', 0xffffff]
      return [cp(g), c, CASE_BG[section]]
    }
    default: return [32, 0, (x + y) % 2 ? 0xd7b98e : 0xcaa77a]
  }
}

/** What Hoot the curator says about a piece on display. */
export const FACTS: Record<string, string> = {
  'sea bass': 'Hoo! The humble sea bass. Common, yes - but so very proud!',
  bluegill: 'Bluegills have a little blue ear. They are listening, hoo.',
  carp: 'Carp can live for decades. This one has seen things.',
  koi: 'A koi! Bred for color for centuries. Simply exquisite.',
  goldfish: 'A goldfish of the wild sort. Rarer than you think!',
  sturgeon: 'Sturgeon are older than the dinosaurs. A living fossil, hoo!',
  trout: 'Trout love cold, clear water in spring. Speckled beauty!',
  catfish: 'Those whiskers taste the water. Imagine tasting with your face!',
  salmon: 'Salmon swim upstream each autumn. Such determination!',
  pike: 'The pike - a toothy winter hunter. Keep your fingers away!',
  butterfly: 'Butterflies taste with their feet. Fascinating and slightly odd.',
  ladybug: 'Ladybugs eat aphids by the hundred. Every gardener\'s friend.',
  dragonfly: 'Dragonflies can fly backwards. Show-offs, really.',
  firefly: 'Fireflies glow to find each other. Romance in the dark, hoo.',
  cicada: 'Cicadas sing louder than any bug. My poor ears, hoo...',
  beetle: 'Beetles are the most numerous animals on earth. Impressive!',
  cricket: 'Count a cricket\'s chirps and you can guess the temperature!',
  moth: 'Moths navigate by moonlight. Our lamps confuse them, poor dears.',
  ammonite: 'An ammonite! Its spiral shell is millions of years old.',
  trilobite: 'Trilobites crawled the sea floor before there were trees!',
  amber: 'Amber is fossilized tree resin. Sometimes bugs are trapped inside!',
  'dino tooth': 'A dinosaur tooth! Sharp, enormous, wonderful. Hoo hoo!',
  'fern fossil': 'Ferns have hardly changed in 300 million years. Timeless.',
  'star fragment': 'A piece of a falling star. It still glows, faintly.',
  'old boot': 'An old boot. I... appreciate the donation. Truly.',
  'old coin': 'A coin from the village\'s early days. History in your hand!',
  amethyst: 'Amethyst - purple quartz. Said to bring calm and clear thoughts.',
  ruby: 'A ruby! The rarest find in all the village. Magnificent!',
}

/** Where to find a piece that is still missing. */
export function hint(piece: string): string {
  const season = Object.entries(SEASONAL_FISH).find(([, f]) => f === piece)?.[0]
  if (season) return `It only bites in ${season}.`
  if (piece === 'sturgeon') return 'They bite with a golden rod, or from the pier.'
  if (piece === 'koi' || piece === 'goldfish') return 'A rare catch - a golden rod helps.'
  if (piece in BUGS) {
    const b = BUGS[piece]
    const where = { flower: 'flowers', water: 'the water', tree: 'trees', grass: 'the grass', house: 'lit houses' }[b.habitat]
    return `Look near ${where} in ${b.seasons.join(' or ')}, ${b.night ? 'at night' : 'by day'}.`
  }
  if (FOSSILS.includes(piece)) return 'Dig the cracked spots with a shovel.'
  if (piece === 'star fragment') return 'They fall during meteor showers.'
  if (piece === 'old boot') return 'Fish without a golden rod... you will get one.'
  if (piece === 'old coin' || piece === 'amethyst' || piece === 'ruby') return 'Dig the cracked spots - rubies are very rare.'
  return 'Keep exploring!'
}
