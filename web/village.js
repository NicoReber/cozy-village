// The village in the browser: a pixel-art canvas that the mod's world streams into.
// The server forwards a `map` event when the map changes and a `state` event every tick (about 150 ms);
// this page walks everyone smoothly between ticks and draws at the screen's frame rate.

const T = 16
const KEY = new URLSearchParams(location.search).get('k') ?? ''
const canvas = document.getElementById('world')
const ctx = canvas.getContext('2d')
const $ = id => document.getElementById(id)

// ---------- the art: rows of palette keys, `.` transparent ----------

const ART = {
  grass: ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaabaa', 'aabaaaaaaaaaaaaa', 'aaaaaaacaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaabaaaa', 'aaacaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa',
    'aaaaaabaaaaaaaca', 'aaaaaaaaaaaaaaaa', 'abaaaaaaaaaaaaaa', 'aaaaaaaaacaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaabaa', 'aaacaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa'],
  path: ['aaaaaaaaaaaaaaaa', 'aaabaaaaaaaaaaaa', 'aaaaaaaaaaacaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaacaaaaaaaba', 'aaaaaaaaaaaaaaaa', 'abaaaaaaaaaaaaaa', 'aaaaaaaaabbaaaaa',
    'aaaaaaaaaaaaaaaa', 'aaaacaaaaaaaaaaa', 'aaaaaaaaaaaaacaa', 'aaaaaaaaaaaaaaaa', 'aaaaaabaaaaaaaaa', 'aabaaaaaaaaaaaaa', 'aaaaaaaaaaaabaaa', 'aaaaaaaaaaaaaaaa'],
  plaza: ['bbbbbbbbbbbbbbbb', 'caaaaaabcaaaaaab', 'aaaaaaabaaaaaaab', 'aaaaaaabaaaaaaab', 'aaaaaaabaaaaaaab', 'aaaaaaabaaaaaaab', 'aaaaaaabaaaaaaab', 'bbbbbbbbbbbbbbbb',
    'aaabcaaaaaaabcaa', 'aaabaaaaaaaabaaa', 'aaabaaaaaaaabaaa', 'aaabaaaaaaaabaaa', 'aaabaaaaaaaabaaa', 'aaabaaaaaaaabaaa', 'aaabaaaaaaaabaaa', 'aaabaaaaaaaabaaa'],
  water: ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaabbbaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaabbbaaa', 'aaaaaaaaaaaaaaaa', 'aacaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaaaa', 'aaaaabbbaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaacaa', 'aaaaaaaaaaaaaaaa', 'abbaaaaaaaaaabba', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa'],
  soil: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', 'aacaaaaaaacaaaaa'],
  planksV: ['aaabaaabaaabaaab', 'aaabaaabaaabaaab', 'acabaaabacabaaab', 'aaabaaabaaabaaab'],
  planksH: ['aaaaaaaaaaaaaaaa', 'aaacaaaaaaaaacaa', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'],
  roof: ['aaaaaaaaaaaaaaaa', 'caaacaaacaaacaaa', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', 'aacaaacaaacaaaca', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'],
  wall: ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'],
  wood: ['aaaaaaabaaaaaaaa', 'aaaaaaabaaaaaaaa', 'acaaaaabaaaaacaa', 'aaaaaaabaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'aaabaaaaaaaabaaa', 'aaabaaacaaaabaaa', 'bbbbbbbbbbbbbbbb'],
  tree: [
    '........oooooooo........', '......ookllllllkoo......', '.....okllllllllllko.....', '....okllllllllllllko....', '...okklllllllllllkkko...',
    '...okkllllllllllkkkko...', '..okkkklllllllkkkkkkko..', '..okkkkkkkkkkkkkkkkkko..', '.okkkkkkkkkkkkkkkkkkkko.', '.okkkkkkkkkkkkkkkkkkkdo.',
    '.okkkkkkkkkkkkkkkkkkddo.', '.okdkkkkkkkkkkkkkkkkddo.', '.okddkkkkkkkkkkkkkkdddo.', '..oddkkkkkkkkkkkkkdddo..', '..odddkkkkkkkkkkkddddo..',
    '...oddddkkkkkkkdddddo...', '....odddddddddddddddo...', '.....oooddddddddooo.....', '........oootTooo........', '..........otTo..........',
    '..........otTo..........', '.........otttTo.........', '..........oooo..........'],
  fir: [
    '...........oo...........', '..........owwo..........', '.........owkkwo.........', '........owkkkkwo........', '.......okkkkkkkko.......',
    '......owwkkkkkkwwo......', '.....okkkkkkkkkkkko.....', '....owwkkkkkkkkkkwwo....', '...okkkkkkkkkkkkkkkko...', '...oddkkkkkkkkkkkkddo...',
    '..owwwddkkkkkkkkddwwwo..', '..okkkkkkkkkkkkkkkkkko..', '.okddkkkkkkkkkkkkkkddko.', '.ooooooodddddddddoooooo.', '..........otTo..........',
    '..........otTo..........', '.........otttTo.........', '..........oooo..........'],
  bare: [
    '........................', '.....t.....t......t.....', '......t....t.....t......', '..t....t...t....t...t...', '...t....t..t...t...t....',
    '....tt...t.t..t..tt.....', '......tt..ttt.ttt.......', '........ttttttt.........', '..........ttTt..........', '..........otTo..........',
    '..........otTo..........', '.........otttTo.........', '..........oooo..........'],
  person: [
    '.....oooooo.....', '...oohhhhhhoo...', '..ohhhhhhhhhho..', '.ohhhhhhhhhhhho.', '.ohhhhhhhhhhhho.', '.ohhsssssssshho.', '.ohssssssssssho.',
    '.osssessssessso.', '.osssessssessso.', '.ossrssssssrsso.', '..ossssmmsssso..', '...oossssssoo...', '...occcccccco...', '..osccccccccso..',
    '..osccccccccso..', '..oodccccccdoo..', '...oddddddddo...', '...oppppppppo...', '...opppoopppo...', '...obbo..obbo...', '....oo....oo....'],
  personBack: [
    '.....oooooo.....', '...oohhhhhhoo...', '..ohhhhhhhhhho..', '.ohhhhhhhhhhhho.', '.ohhhhhhhhhhhho.', '.ohhhhhhhhhhhho.', '.ohhhhhhhhhhhho.',
    '.ohhhhhhhhhhhho.', '.ohhhhhhhhhhhho.', '..ohhhhhhhhhho..', '..osssssssssso..', '...oossssssoo...', '...occcccccco...', '..osccccccccso..',
    '..osccccccccso..', '..oodccccccdoo..', '...oddddddddo...', '...oppppppppo...', '...opppoopppo...', '...obbo..obbo...', '....oo....oo....'],
  personSide: [
    '....oooooo......', '..oohhhhhhoo....', '.ohhhhhhhhhho...', 'ohhhhhhhhhhhho..', 'ohhhhhhhhhhhho..', 'ohhhhhssssssso..', 'ohhhhsssssssso..',
    'ohhhssssssesso..', 'ohhhssssssesso..', '.ohhsssssssrso..', '..ossssssssso...', '...ooossssoo....', '....occcccco....', '....occcssco....',
    '....occcssco....', '....odccccdo....', '....oddddddo....', '....oppppppo....', '....oppppppo....', '....obbo.obbo...', '.....oo...oo....'],
  stepA: ['...oppppppppo...', '...opppoopppo...', '...obbo..oppo...', '....oo...obbo...'],
  stepB: ['...oppppppppo...', '...opppoopppo...', '...oppo..obbo...', '...obbo...oo....'],
  straw: ['.....yyyyyy.....', '....yyyyyyyy....', '....rrrrrrrr....', '.yyyyyyyyyyyyyy.', 'YYYYYYYYYYYYYYYY'],
  cap: ['....kkkkkkk.....', '...kkkkkkkkkk...', '..kkkkkkkkkkkk..', '.KKKKKKKKKKKKKK.'],
  beanie: ['.......ww.......', '....rrrrrrrr....', '...rrrrrrrrrr...', '..rrrrrrrrrrrr..', '..wwwwwwwwwwww..'],
  bun: ['......oooo......', '.....ohhhho.....', '.....ohhhho.....', '......oooo......'],
  flower: ['...........p....', '..........pyp...', '...........p....'],
  band: ['..aaaaaaaaaaaa..', '.aaaaaaaaaaaaaa.'],
  beard: ['...ohhhhhhhho...', '....ohhhhhho....'],
  long: ['.hh..........hh.', '.hh..........hh.', '.hh..........hh.', '.hh..........hh.', '.hh..........hh.', '.hh..........hh.', '..h..........h..'],
  apron: ['.....wwwwww.....', '.....wwwwww.....', '.....wwwwww.....', '......wwww......'],
  pack: ['....b......b....', '....b......b....', '....b......b....'],
  cat: ['........o..o', '.......owoow', '.o.....owwww', 'ow.....owewe', 'ow.ooooowwww', '.owwwwwwwwwo', '..owwwwwwwo.', '..owwgwwgwo.', '..oo.oo.oo..'],
  catNap: ['....o..o....', '...owoowo...', '..owwwwwwo..', '.owwgwwwwwo.', 'owwwwwwwwwwo', '.oooooooooo.'],
  owl: ['.o........o.', '.bo......ob.', '.bbbbbbbbbb.', 'bbwwwbbwwwbb', 'bwweewweewwb', 'bwweewweewwb', 'bbwwwyywwwbb', 'bbbbbyybbbbb',
    'bbllllllllbb', 'bbllllllllbb', '.bllllllllb.', '.bbllllllbb.', '..bbbbbbbb..', '...yy..yy...'],
  window: ['ffffffffffff', 'fgglgffgglgf', 'fglggffglggf', 'fggggffggggf', 'ffffffffffff', 'fggggffggggf', 'fggggffggggf', 'ffffffffffff', 'kpkkykkpkkyk', 'kkkkkkkkkkkk'],
  door: ['..oooooooo..', '.oddddddddo.', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo',
    'odldddddyldo', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo', 'odlddddddldo', 'oooooooooooo', 'ssssssssssss'],
  chimney: ['oooooooo', 'orrrrrro', 'oRRRRRRo', 'orrRrrro', 'orrrrRro', 'oRrrrrro', 'orrrRrro', 'orrrrrro'],
  lamp: ['.oooo.', 'oyyyyo', 'oyyyyo', 'oyyyyo', '.oooo.', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..', '.oooo.'],
  bench: ['bbbbbbbbbbbbbbbb', 'BBBBBBBBBBBBBBBB', '.o............o.', 'bbbbbbbbbbbbbbbb', 'BBBBBBBBBBBBBBBB', '.o............o.', '.o............o.'],
  mailbox: ['.rrrrrr.', 'rrrrrrrr', 'rRRRRRRr', 'rrrrrrrr', 'RRRRRRRR', '...oo...', '...oo...', '...oo...', '...oo...', '...oo...', '...oo...', '..oooo..'],
  flag: ['yyyy', 'yyyy', 'y...', 'y...'],
  board: ['oooooooooooooooo', 'obbbbbbbbbbbbbbo', 'obwwwbbyyybbbbbo', 'obwwwbbyyybpppbo', 'obbbbbbbbbbpppbo', 'obbqqqqbbbbbbbbo', 'obbqqqqbbwwwbbbo', 'obbbbbbbbbbbbbbo',
    'oooooooooooooooo', '..oo........oo..', '..oo........oo..', '..oo........oo..'],
  snowman: ['....oooo....', '....oooo....', '...wwwwww...', '...wewwew...', '...wwnnww...', '....wwww....', '..rrrrrrrr..', '..wwwwwwww..', '.wwwwewwwww.', '.wwwwwwwwww.', '.wwwwewwwww.', '..wwwwwwww..', '...wwwwww...'],
  pot: ['.p..y..p', 'pppyyypp', '.gggggg.', 'oooooooo', '.cccccc.', '.cccccc.', '..cccc..'],
  birdhouse: ['...rr...', '..rrrr..', '.rrrrrr.', 'rrrrrrrr', '.wwwwww.', '.wwoowww', '.wwoowww', '.wwwwww.', '...bb...', '...bb...', '...bb...', '...bb...', '..bbbb..'],
  statue: ['...ss...', '..ssss..', '...ss...', '..ssss..', '.ssssss.', '.s.ss.s.', '...ss...', '..s..s..', '..s..s..', 'gggggggg', '.GGGGGG.', '.GGGGGG.', 'gggggggg'],
  fountain: [
    '.............bb.............', '............bwwb............', '.............bb.............', '............gGGg............', '...........gGGGGg...........',
    '............gGGg............', '.............gg.............', '....gggggggggggggggggggg....', '..ggGGGGGGGGGGGGGGGGGGGGgg..', '.gGbbbbbbbbbbbbbbbbbbbbbbGg.',
    'gGbbwbbbbbbbbbbbbbbbbbwbbbGg', 'gGbbbbbbbbbbbbbbbbbbbbbbbbGg', 'gGbbbbbbwbbbbbbbbbbbbbbbbbGg', '.gGbbbbbbbbbbbbbbbbbbbwbbGg.', '..ggGGGGGGGGGGGGGGGGGGGGgg..',
    '..gddddddddddddddddddddddg..', '...gddddddddddddddddddddg...', '....gggggggggggggggggggg....'],
  sprout: ['..........', '..........', '...g..g...', '....gg....', '.....g....'],
  leafy: ['..........', '.g.....g..', '.gg...gg..', '..gg.gg...', '...ggg....', '....g.....'],
  turnip: ['..g...g...', '...g.g....', '....g.....', '...pppp...', '..wwwwww..', '..wwwwww..', '...wwww...', '....ww....'],
  carrot: ['.g..g..g..', '..g.g.g...', '...ggg....', '...ooo....', '...ooo....', '....o.....'],
  strawberry: ['..g....g..', '.ggg..ggg.', 'ggrggggrgg', '.ggggrggg.', '..grggg...', '...ggg....'],
  pumpkin: ['....g.....', '..ooOoo...', '.ooooOooo.', 'ooOooOooOo', 'ooOooOooOo', '.ooooOooo.', '..ooooo...'],
  star: ['...y...', '...y...', '.yyYyy.', 'yyYYYyy', '.yyYyy.', '..y.y..', '.y...y.'],
  butterfly: ['a.a', 'aaa', 'b.b'],
  glass: ['oooooooooooooo', 'oggggggggggggo', 'oglggggggggggo', 'olgggggggggggo', 'oggggggggggggo', 'oggggggggggggo', 'oggggggggggggo', 'oooooooooooooo', 'oddddddddddddo', 'oDDDDDDDDDDDDo', 'oDDDDDDDDDDDDo', 'oooooooooooooo'],
  plant: ['...gg..g....', '.g.gg.gg.g..', 'ggggggggggg.', '.gGggGgggGg.', '..ggggggg...', '...ooooo....', '...ccccc....', '...ccccc....', '....ccc.....'],
}

const SEASONS = {
  spring: { grass: ['#7ec850', '#6cb544', '#96d867'], path: ['#e2c48f', '#c9a873', '#f0d8a8'], leaves: ['#5fb44f', '#8bd16b', '#3f8f3f'], outline: '#24502a', bloom: ['#ff8fb1', '#fff176', '#ffffff', '#ce93d8'], tuft: '#5aa83f' },
  summer: { grass: ['#6cbf4a', '#5aa83d', '#86d062'], path: ['#e0c08a', '#c4a06a', '#eed4a0'], leaves: ['#3f9e45', '#6cbf58', '#2b7a36'], outline: '#1b4424', bloom: ['#ff80ab', '#ffee58', '#ffffff', '#ba68c8'], tuft: '#4a9a38' },
  autumn: { grass: ['#b8ad55', '#a39947', '#cac06a'], path: ['#d8b483', '#bd9763', '#e8cb9e'], leaves: ['#e0782f', '#f2a943', '#b04a26'], outline: '#5c2a14', bloom: ['#ffab40', '#ff7043', '#ffee58', '#ffffff'], tuft: '#8f863a' },
  winter: { grass: ['#eef3f7', '#dde6ee', '#ffffff'], path: ['#d6cec6', '#bfb6ad', '#e6dfd8'], leaves: ['#3f6b55', '#5d8c74', '#2b4d3c'], outline: '#1e3329', bloom: ['#ffffff', '#e1f5fe', '#ffffff', '#e1f5fe'], tuft: '#c3cfd8' },
}
const OUTLINE = '#2b2321'
const SKIN = '#ffd9b8'
const LOOKS = {
  me: { hair: '#6b4a3a', shirt: '#d97757', pants: '#5d4a3a', hat: 'straw' },
  tom: { hair: '#7a5a44', shirt: '#ff8a65', pants: '#3f5f8a', hat: 'cap', hatColor: '#3f6fb5', beard: true },
  rosa: { hair: '#a0522d', shirt: '#f48fb1', pants: '#8e5a9e', hat: 'flower', long: true },
  bruno: { hair: '#4e342e', shirt: '#8d6e63', pants: '#4e4e4e', hat: 'band', beard: true },
  pip: { hair: '#ffb74d', shirt: '#81c784', pants: '#4a6fa5', hat: 'beanie', small: true },
  mabel: { hair: '#e6e6e6', shirt: '#ce93d8', pants: '#6a4f7a', hat: 'bun', apron: true },
  kiki: { hair: '#8d6e63', shirt: '#ffd54f', pants: '#6d5a3a', hat: 'cap', hatColor: '#ef6c00', pack: true },
}
const WORK_ICON = {
  plant: '🌱', water: '💧', harvest: '🧺', fish: '🎣', chop: '🪓', shake: '🍎', pick: '🌸', sell: '💰', sleep: '💤', pet: '🐾', gift: '🎁', buy: '🛍️', trade: '🤝',
  shop: '🛍️', cook: '🍳', fund: '🏛️', donate: '🦉', place: '🪑', dig: '⛏️', club: '🎵', pedal: '🚲',
  'echo:edit': '✏️', 'echo:shell': '⚙️', 'echo:read': '📖', 'echo:web': '🌐', 'echo:agent': '🤝', 'echo:other': '✨',
}

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))))
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0')}`
}
const noise = (x, y, salt = 0) =>
  ((Math.imul(x + salt * 131, 73856093) ^ Math.imul(y - salt * 71, 19349663) ^ Math.imul(salt + 7, 83492791)) >>> 0) % 1000 / 1000

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}
/** Paints pixel art onto a 2D context, run by run. */
function paint(g, rows, pal, dx = 0, dy = 0) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const ch = row[x]
      let n = 1
      while (row[x + n] === ch) n++
      if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x + dx, y + dy, n, 1) }
      x += n
    }
  })
}
const sprites = new Map()
/** A sprite as its own small canvas, made once per look. */
function sprite(key, w, h, draw) {
  let c = sprites.get(key)
  if (!c) { c = makeCanvas(w, h); draw(c.getContext('2d')); sprites.set(key, c) }
  return c
}
function tilePattern(g, rows, pal) {
  const c = makeCanvas(16, rows.length)
  const cg = c.getContext('2d')
  cg.fillStyle = pal.a
  cg.fillRect(0, 0, 16, rows.length)
  paint(cg, rows, { ...pal, a: '' })
  return g.createPattern(c, 'repeat')
}

// ---------- people ----------

/** A villager, 18 × 28, feet at (8, 24); the hat may reach above the head. */
function personSprite(key, face, step) {
  const look = LOOKS[key] ?? LOOKS.me
  return sprite(`p:${key}:${face}:${step}`, 18, 28, g => {
    const oy = 4
    const pal = { o: OUTLINE, h: look.hair, s: SKIN, e: OUTLINE, r: '#ff9e8a', m: '#c0665a', c: look.shirt, d: shade(look.shirt, 0.78), p: look.pants, b: '#4a3a32' }
    const body = face === 'up' ? ART.personBack : face === 'down' ? ART.person : ART.personSide
    paint(g, body, pal, 0, oy)
    if (step && (face === 'down' || face === 'up')) paint(g, step === 1 ? ART.stepA : ART.stepB, pal, 0, oy + 17)
    const o = { o: OUTLINE, h: look.hair }
    if (look.long && face !== 'up') paint(g, ART.long, o, 0, oy + 5)
    if (look.beard && face === 'down') paint(g, ART.beard, o, 0, oy + 10)
    if (look.apron && face !== 'up') paint(g, ART.apron, { w: '#ffffff' }, 0, oy + 13)
    if (look.pack) {
      if (face === 'up') { g.fillStyle = '#8d6e63'; g.fillRect(4, oy + 12, 8, 5); g.fillStyle = '#6d4c41'; g.fillRect(4, oy + 14, 8, 1) }
      else paint(g, ART.pack, { b: '#6d4c41' }, 0, oy + 12)
    }
    switch (look.hat) {
      case 'straw': paint(g, ART.straw, { y: '#f2d16b', Y: '#d9b24e', r: '#c0392b' }, 0, oy - 2); break
      case 'cap': paint(g, ART.cap, { k: look.hatColor, K: shade(look.hatColor, 0.8) }, 0, oy - 1); break
      case 'beanie': paint(g, ART.beanie, { r: '#e57373', w: '#ffffff' }, 0, oy - 2); break
      case 'bun': paint(g, ART.bun, o, 0, oy - 3); break
      case 'flower': if (face !== 'up') paint(g, ART.flower, { p: '#ff80ab', y: '#fff59d' }, 0, oy + 1); break
      case 'band': paint(g, ART.band, { a: '#ef6c00' }, 0, oy + 2); break
    }
  })
}
const catSprite = nap => sprite(`cat:${nap}`, 12, 9, g => paint(g, nap ? ART.catNap : ART.cat, { o: OUTLINE, w: '#fafafa', g: '#cfcfcf', e: '#333333' }))
const owlSprite = () => sprite('owl', 12, 14, g => paint(g, ART.owl, { o: OUTLINE, b: '#8d6e63', w: '#ffffff', e: '#3e2723', y: '#ffb300', l: '#d7ccc8' }))

// ---------- the map, drawn once per change ----------

let map = null
/** The ground and everything flat on it, as one canvas the size of the map. */
let ground = null
/** Things that stand on the map and never move, each with the row it is sorted by. */
let props = []
let lamps = []
let windows = []
let sparkles = []

function findBuildings(m) {
  const W = m.w
  const seen = new Uint8Array(m.w * m.h)
  const part = i => 'rld'.includes(m.rows[Math.floor(i / W)][i % W])
  const list = []
  for (let i = 0; i < m.w * m.h; i++) {
    if (seen[i] || !part(i)) continue
    let x0 = W, y0 = m.h, x1 = 0, y1 = 0
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const c = stack.pop()
      const x = c % W
      const y = Math.floor(c / W)
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx
        if (nx >= 0 && ny >= 0 && nx < W && ny < m.h && !seen[j] && part(j)) { seen[j] = 1; stack.push(j) }
      }
    }
    const b = { x0, y0, x1, y1, roof: '#b03a2e', wall: '#f5e6c8', door: Math.round((x0 + x1) / 2), sign: '', neon: false, windows: [] }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = y * W + x
        const t = m.rows[y][x]
        if (t === 'r' && m.paint[j]) b.roof = m.paint[j]
        if (t === 'l' && m.paint[j]) b.wall = m.paint[j]
        if (t === 'd') b.door = x
        const d = m.deco[j]
        if (d && t !== 'r') {
          if (d === '■') b.windows.push(x)
          else b.sign += d
        }
      }
    }
    b.neon = b.sign === 'VELVET'
    if (!b.windows.length) {
      for (let x = x0 + 1; x <= x1 - 1; x += 2) if (Math.abs(x - b.door) > 1 && (!b.sign || Math.abs(x - b.door) > Math.ceil(b.sign.length / 3) + 1)) b.windows.push(x)
    }
    list.push(b)
  }
  return list
}

function drawBuilding(b, s) {
  const w = (b.x1 - b.x0 + 1) * T
  const h = (b.y1 - b.y0 + 1) * T
  const c = makeCanvas(w + 8, h + 14)
  const g = c.getContext('2d')
  const ox = 4, oy = 10
  const snow = s === 'winter'
  const roof = snow ? '#f2f6f9' : b.roof
  const roofH = 2 * T
  const wallY = oy + roofH
  const wallH = h - roofH
  g.fillStyle = tilePattern(g, ART.wall, { a: b.wall, b: shade(b.wall, 0.86) })
  g.fillRect(ox, wallY, w, wallH)
  g.fillStyle = shade(b.wall, 0.62); g.fillRect(ox, wallY + wallH - 3, w, 3)
  g.fillStyle = OUTLINE; g.fillRect(ox, wallY, 1, wallH); g.fillRect(ox + w - 1, wallY, 1, wallH)
  const door = sprite('door', 12, 16, dg => paint(dg, ART.door, { o: '#4e2f1e', d: '#8a5a3b', l: '#a8754d', y: '#ffd54f', s: '#a8a29a' }))
  g.drawImage(door, ox + (b.door - b.x0) * T + 2, wallY + wallH - 16)
  // the roof overhangs the wall a little, with a dark eave under it
  g.fillStyle = tilePattern(g, ART.roof, { a: roof, b: shade(roof, snow ? 0.88 : 0.72), c: shade(roof, snow ? 1 : 1.18) })
  g.fillRect(ox - 2, oy - 3, w + 4, roofH + 3)
  g.fillStyle = shade(roof, snow ? 1 : 1.25); g.fillRect(ox - 2, oy - 3, w + 4, 2)
  g.fillStyle = shade(b.roof, 0.5); g.fillRect(ox - 2, oy + roofH - 2, w + 4, 2)
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(ox - 2, wallY, w + 4, 2)
  g.strokeStyle = OUTLINE; g.lineWidth = 1; g.strokeRect(ox - 2.5, oy - 3.5, w + 5, roofH + 4)
  if (b.chimney) paint(g, ART.chimney, { o: OUTLINE, r: '#b5523f', R: '#8e3b2e' }, ox + 2 * T + 4, oy - 10)
  if (b.sign) {
    const cx = ox + (b.door - b.x0) * T + 8
    g.font = '900 7px "Segoe UI", system-ui, sans-serif'
    const tw = Math.ceil(g.measureText(b.sign).width) + 8
    g.fillStyle = b.neon ? '#2a0d2e' : '#fff3d6'
    g.fillRect(Math.round(cx - tw / 2), wallY - 1, tw, 9)
    g.strokeStyle = b.neon ? '#ff4081' : '#6d4c41'
    g.strokeRect(Math.round(cx - tw / 2) + 0.5, wallY - 0.5, tw - 1, 8)
    g.fillStyle = b.neon ? '#ff80c0' : '#5d4037'
    g.textAlign = 'center'
    g.fillText(b.sign, cx, wallY + 6)
    if (!b.neon) {
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#fff8e1' : b.roof; g.fillRect(ox + (b.door - b.x0) * T - 2 + i * 3.4, wallY + wallH - 21, 3.4, 4) }
      g.fillStyle = shade(b.roof, 0.6); g.fillRect(ox + (b.door - b.x0) * T - 2, wallY + wallH - 17, 20.4, 1)
    }
  }
  return { canvas: c, x: b.x0 * T - ox, y: b.y0 * T - oy }
}

function buildMap(m) {
  sprites.clear()
  props = []; lamps = []; windows = []; sparkles = []
  const W = m.w, Hh = m.h
  ground = makeCanvas(W * T, Hh * T + 12)
  const g = ground.getContext('2d')
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= Hh ? '' : m.rows[y][x])
  if (m.scene === 'museum') {
    const floor = tilePattern(g, ART.wood, { a: '#d4b48a', b: '#b08c62', c: '#e2c7a2' })
    const carpet = tilePattern(g, ART.plaza, { a: '#a83c3c', b: '#8a2e2e', c: '#c25050' })
    g.fillStyle = '#1f1512'; g.fillRect(0, 0, ground.width, ground.height)
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const t = at(x, y)
        if (t === 'f' || t === 's' || t === 'p' || t === 'd') { g.fillStyle = floor; g.fillRect(x * T, y * T, T, T) }
        if (t === 'c') { g.fillStyle = carpet; g.fillRect(x * T, y * T, T, T) }
        if (t === 'd') { g.fillStyle = '#8d6e63'; g.fillRect(x * T + 2, y * T + 4, 12, 10) }
        if (t === 'w') {
          const face = at(x, y + 1) !== 'w' && y < Hh - 1
          props.push({ y: y * T + 1, draw: c => {
            c.fillStyle = '#5d4037'; c.fillRect(x * T, y * T, T, T)
            c.fillStyle = '#795548'; c.fillRect(x * T, y * T, T, 2)
            if (face) { c.fillStyle = '#a1887f'; c.fillRect(x * T, y * T + 8, T, 8); c.fillStyle = '#6d4c41'; c.fillRect(x * T, y * T + 15, T, 1) }
          } })
        }
        if (t === 'p') {
          const pl = sprite('plant', 12, 9, sg => paint(sg, ART.plant, { g: '#4caf50', G: '#2e7d32', o: '#6d4c41', c: '#b85a35' }))
          props.push({ y: (y + 1) * T, draw: c => c.drawImage(pl, x * T + 2, y * T + 5) })
        }
      }
    }
    for (const cs of m.cases) {
      const glass = sprite(`case:${cs.section}:${cs.shown}`, 14, 12, sg => paint(sg, ART.glass, { o: '#4e342e', g: cs.section === 'fish' && cs.shown ? '#7fc8ef' : '#cfe8f3', l: '#ffffff', d: '#8d6e63', D: '#6d4c41' }))
      props.push({ y: (cs.y + 1) * T, draw: (c, now) => {
        c.drawImage(glass, cs.x * T + 1, cs.y * T + 2)
        if (!cs.shown) return
        const bob = Math.round(Math.sin(now / 400 + cs.x) * 1)
        c.fillStyle = cs.color
        if (cs.section === 'fish') { c.fillRect(cs.x * T + 6, cs.y * T + 6 + bob, 5, 2); c.fillRect(cs.x * T + 4, cs.y * T + 5 + bob, 2, 4) }
        else if (cs.section === 'bugs') { const flap = Math.floor(now / 200) % 2; c.fillRect(cs.x * T + 5, cs.y * T + 5 + bob, 2, flap ? 2 : 1); c.fillRect(cs.x * T + 9, cs.y * T + 5 + bob, 2, flap ? 2 : 1) }
        else { c.fillRect(cs.x * T + 7, cs.y * T + 4, 2, 4); c.fillRect(cs.x * T + 6, cs.y * T + 5, 4, 2) }
      } })
    }
    for (const h of m.halls) {
      props.push({ y: h.y * T + 2, draw: c => {
        c.font = '800 7px "Segoe UI", system-ui, sans-serif'
        const tw = c.measureText(h.text).width + 8
        const cx = (h.x + h.text.length / 2) * T
        c.fillStyle = '#3e2723'; c.fillRect(cx - tw / 2, h.y * T + 3, tw, 10)
        c.strokeStyle = '#ffe0b2'; c.strokeRect(cx - tw / 2 + 0.5, h.y * T + 3.5, tw - 1, 9)
        c.fillStyle = '#ffe0b2'; c.textAlign = 'center'; c.fillText(h.text, cx, h.y * T + 10.5)
      } })
    }
    return
  }

  const s = m.season
  const pal = SEASONS[s] ?? SEASONS.spring
  const pat = {
    grass: tilePattern(g, ART.grass, { a: pal.grass[0], b: pal.grass[1], c: pal.grass[2] }),
    path: tilePattern(g, ART.path, { a: pal.path[0], b: pal.path[1], c: pal.path[2] }),
    plaza: tilePattern(g, ART.plaza, { a: '#cfc6c0', b: '#a89c94', c: '#e6dfda' }),
    water: tilePattern(g, ART.water, { a: '#4a9fdc', b: '#9fd6f5', c: '#3a86c4' }),
    ice: tilePattern(g, ART.water, { a: '#cfe8f5', b: '#ffffff', c: '#b6d8ea' }),
    soil: tilePattern(g, ART.soil, { a: '#94603a', b: '#734626', c: '#a8744a' }),
    wet: tilePattern(g, ART.soil, { a: '#6b4226', b: '#4e2f1a', c: '#7d5233' }),
    planksV: tilePattern(g, ART.planksV, { a: '#c49a6c', b: '#8a6544', c: '#d8b386' }),
    planksH: tilePattern(g, ART.planksH, { a: '#c49a6c', b: '#8a6544', c: '#d8b386' }),
  }
  const wet = (x, y) => { const t = at(x, y); return t === '' || t === 'w' || t === 'b' }
  const pond = (x, y) => x >= 60 && y >= 19
  const flowers = pal.bloom.map((b, k) => sprite(`fl:${s}:${k}`, 7, 6, fg => {
    fg.fillStyle = pal.tuft; fg.fillRect(2, 3, 1, 2); fg.fillRect(5, 2, 1, 3)
    fg.fillStyle = b; fg.fillRect(1, 2, 3, 1); fg.fillRect(2, 1, 1, 3); fg.fillRect(4, 1, 3, 1); fg.fillRect(5, 0, 1, 3)
    fg.fillStyle = '#ffd54f'; fg.fillRect(2, 2, 1, 1); fg.fillRect(5, 1, 1, 1)
  }))
  const tree = sprite(`tree:${s}`, 24, 23, tg => {
    const leaves = { o: pal.outline, k: pal.leaves[0], l: pal.leaves[1], d: pal.leaves[2], t: '#8a5a3b', T: '#6b4430', w: '#ffffff' }
    paint(tg, s === 'winter' ? ART.fir : ART.tree, leaves)
  })
  const appleTree = sprite(`apple:${s}`, 24, 23, tg => {
    const leaves = { o: pal.outline, k: pal.leaves[0], l: pal.leaves[1], d: pal.leaves[2], t: '#8a5a3b', T: '#6b4430' }
    if (s === 'winter') paint(tg, ART.bare, leaves, 0, 10)
    else if (s === 'spring') paint(tg, ART.tree, { ...leaves, k: '#f8a5c2', l: '#fcd0e0', d: '#e57fa6', o: '#8a3a5a' })
    else paint(tg, ART.tree, { ...leaves, k: shade(pal.leaves[0], 1.05), d: shade(pal.leaves[2], 1.1) })
  })

  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const t = at(x, y)
      const i = y * W + x
      const X = x * T, Y = y * T
      const n = noise(x, y, 3)
      let fill = pat.grass
      if (t === 'p') fill = pat.path
      else if (t === 'z' || t === 'f' || (t === 'i' && m.paint[i] === '#d7ccc8')) fill = pat.plaza
      else if (t === 'w') fill = s === 'winter' && pond(x, y) ? pat.ice : pat.water
      else if (t === 'b') fill = wet(x - 1, y) && wet(x + 1, y) ? pat.planksH : pat.planksV
      else if (t === 's') fill = m.crops[i]?.[2] ? pat.wet : pat.soil
      g.fillStyle = fill
      g.fillRect(X, Y, T, T)
      if (t === 'w') {
        if (!wet(x, y - 1)) { g.fillStyle = '#6b5640'; g.fillRect(X, Y, T, 3); g.fillStyle = 'rgba(47,111,168,.6)'; g.fillRect(X, Y + 3, T, 1) }
        if (!wet(x - 1, y)) { g.fillStyle = '#3a86c4'; g.fillRect(X, Y, 2, T) }
        if (!wet(x, y + 1)) { g.fillStyle = 'rgba(214,240,255,.7)'; g.fillRect(X, Y + 15, T, 1) }
        if (n < 0.25 && !(s === 'winter' && pond(x, y))) sparkles.push({ x: X + 4, y: Y + 8, phase: n * 12 })
      } else if (t === 'b') {
        g.fillStyle = '#6d4c33'
        if (wet(x - 1, y) && wet(x + 1, y)) { g.fillRect(X, Y, T, 2); g.fillRect(X, Y + 14, T, 2) }
        else { g.fillRect(X, Y, 2, T); g.fillRect(X + 14, Y, 2, T) }
      } else if (t === 't') {
        g.fillStyle = pal.tuft
        const bx = X + 4 + Math.round(n * 6)
        g.fillRect(bx, Y + 12, 7, 1); g.fillRect(bx, Y + 10, 1, 2); g.fillRect(bx + 2, Y + 9, 1, 3); g.fillRect(bx + 4, Y + 10, 1, 2); g.fillRect(bx + 6, Y + 10, 1, 2)
      } else if (t === 'g' && n < 0.03 && s !== 'winter') {
        g.drawImage(flowers[Math.floor(n * 130) % 4], X + 5, Y + 6)
      } else if (t === 'o') {
        if (s === 'winter') { g.fillStyle = '#ffffff'; g.fillRect(X + 3, Y + 9, 10, 3) }
        else for (let k = 0; k < 3; k++) g.drawImage(flowers[(x + y + k) % 4], X + 1 + Math.round(noise(x, y, 10 + k) * 8), Y + 2 + k * 4)
      }
      // standing things
      if (t === 'T' || t === 'a') {
        const flip = noise(x, y, 8) < 0.5
        const img = t === 'a' ? appleTree : tree
        const fruit = t === 'a' && s !== 'winter' ? Math.min(3, m.fruit[i] ?? 0) : 0
        props.push({ y: (y + 1) * T, draw: c => {
          c.fillStyle = 'rgba(0,0,0,.18)'
          c.beginPath(); c.ellipse(X + 9, Y + 14, 8, 2.5, 0, 0, Math.PI * 2); c.fill()
          if (flip) { c.save(); c.translate(X + 20, Y - 14); c.scale(-1, 1); c.drawImage(img, 0, 0); c.restore() } else c.drawImage(img, X - 4, Y - 14)
          c.fillStyle = '#e53935'
          for (let a = 0; a < fruit; a++) c.fillRect(X + [3, 10, 6][a], Y + [-6, -3, 0][a], 2, 2)
        } })
      } else if (t === 'n') {
        const f = (dx, dy) => at(x + dx, y + dy) === 'n'
        props.push({ y: (y + 1) * T, draw: c => {
          c.fillStyle = '#a1887f'
          if (f(1, 0)) { c.fillRect(X + 8, Y + 6, 8, 2); c.fillRect(X + 8, Y + 10, 8, 2) }
          if (f(-1, 0)) { c.fillRect(X, Y + 6, 8, 2); c.fillRect(X, Y + 10, 8, 2) }
          if (f(0, 1)) c.fillRect(X + 7, Y + 8, 2, 8)
          c.fillStyle = '#8d6e63'; c.fillRect(X + 6, Y + 3, 4, 11)
          c.fillStyle = '#bcaaa4'; c.fillRect(X + 6, Y + 3, 4, 1)
          c.fillStyle = '#5d4037'; c.fillRect(X + 6, Y + 13, 4, 1)
        } })
      } else if (t === 'f') {
        const ft = sprite('fountain', 28, 18, fg => paint(fg, ART.fountain, { b: '#4fa3e0', w: '#e3f2fd', g: '#78909c', G: '#cfd8dc', d: '#a7b4bb' }))
        props.push({ y: (y + 1) * T, draw: (c, now) => {
          c.drawImage(ft, X - 6, Y - 2)
          c.fillStyle = '#e3f2fd'
          for (let k = 0; k < 6; k++) {
            const p = ((now / 900 + k / 6) % 1)
            const ang = (k / 6) * Math.PI * 2
            c.fillRect(Math.round(X + 8 + Math.cos(ang) * p * 9), Math.round(Y - 1 + p * p * 10 - p * 6), 1, 1)
          }
        } })
      } else if (t === 's' && m.crops[i]) {
        const [kind, stage] = m.crops[i]
        props.push({ y: Y + 10, draw: c => drawCrop(c, kind, stage, X, Y) })
      } else if (t === 'i') {
        const glyph = m.deco[i] ?? '?'
        props.push({ y: (y + 1) * T, draw: (c, now) => drawDeco(c, glyph, X, Y, now) })
        if (glyph === 'i') lamps.push({ x: X + 8, y: Y })
      }
    }
  }
  // the island's edge
  g.fillStyle = '#7a5a3e'; g.fillRect(0, Hh * T, W * T, 12)
  g.fillStyle = '#5d4433'; g.fillRect(0, Hh * T, W * T, 2)
  // buildings, with a soft shadow on the grass
  for (const b of findBuildings(m)) {
    b.chimney = b.x0 <= 10 && b.x1 >= 10 && b.y0 <= 2 && b.y1 >= 2
    g.fillStyle = 'rgba(0,0,0,.18)'
    g.fillRect(b.x0 * T + 4, b.y0 * T + 6, (b.x1 - b.x0 + 1) * T, (b.y1 - b.y0 + 1) * T)
    const drawn = drawBuilding(b, s)
    const wallY = (b.y0 + 2) * T
    for (const wx of b.windows) windows.push({ x: wx * T + 2, y: wallY + 5 })
    if (b.neon) lamps.push({ x: b.door * T + 8, y: wallY + 2, neon: true })
    props.push({ y: (b.y1 + 1) * T, building: true, draw: (c, now, night) => {
      c.drawImage(drawn.canvas, drawn.x, drawn.y)
      const win = sprite(`win:${night}`, 12, 10, wg => paint(wg, ART.window, { f: '#fff8e8', g: night ? '#ffd76e' : '#8fcbea', l: night ? '#fff0b0' : '#dff3ff', k: '#8d6e63', p: '#ff80ab', y: '#fff176' }))
      for (const wx of b.windows) c.drawImage(win, wx * T + 2, wallY + 5)
      if (b.chimney && !raining) {
        for (let k = 0; k < 3; k++) {
          const p = ((now / 3000 + k / 3) % 1)
          c.fillStyle = `rgba(236,239,241,${(1 - p) * 0.85})`
          const r = 2 + p * 3
          c.fillRect(Math.round(b.x0 * T + 2 * T + 8 + p * 6 - r / 2), Math.round(b.y0 * T - 12 - p * 18 - r / 2), Math.round(r), Math.round(r))
        }
      }
    } })
  }
}

function drawCrop(c, kind, stage, X, Y) {
  const key = `crop:${kind}:${stage}`
  const img = sprite(key, 10, 8, g => {
    const green = { g: '#5fae45' }
    if (stage <= 0) { g.fillStyle = '#e8d5a0'; g.fillRect(1, 5, 1, 1); g.fillRect(7, 6, 1, 1) }
    else if (stage === 1) paint(g, ART.sprout, green)
    else if (stage === 2) paint(g, ART.leafy, green)
    else if (kind === 'carrot') paint(g, ART.carrot, { g: '#5fae45', o: '#ff9800' })
    else if (kind === 'strawberry') paint(g, ART.strawberry, { g: '#4f9e3a', r: '#e53935' })
    else if (kind === 'pumpkin') paint(g, ART.pumpkin, { g: '#5d4037', o: '#ff6f00', O: '#e65100' })
    else paint(g, ART.turnip, { g: '#5fae45', p: '#ab47bc', w: '#f5f5f5' })
  })
  c.drawImage(img, X + 3, Y + 5)
}

function drawDeco(c, glyph, X, Y, now) {
  const night = lightNow.glow > 0.4
  switch (glyph) {
    case 'Π': {
      c.drawImage(sprite('mailbox', 8, 12, g => paint(g, ART.mailbox, { r: '#e53935', R: '#b71c1c', o: '#5d4037' })), X + 4, Y + 3)
      if (state?.unread) {
        c.drawImage(sprite('flag', 4, 4, g => paint(g, ART.flag, { y: '#ffeb3b' })), X + 11, Y - 1)
        if (Math.floor(now / 500) % 2) { c.fillStyle = '#ffeb3b'; c.fillRect(X + 5, Y - 9, 6, 7); c.fillStyle = '#c62828'; c.fillRect(X + 7, Y - 8, 2, 3); c.fillRect(X + 7, Y - 4, 2, 1) }
      }
      break
    }
    case '¶': c.drawImage(sprite('board', 16, 12, g => paint(g, ART.board, { o: '#4e342e', b: '#a1887f', w: '#fff8e1', y: '#ffe082', p: '#f8bbd0', q: '#b3e5fc' })), X, Y + 3); break
    case 'i': c.drawImage(sprite(`lamp:${night}`, 6, 18, g => paint(g, ART.lamp, { o: '#37474f', y: night ? '#ffe9a0' : '#eceff1' })), X + 5, Y - 3); break
    case '=': c.drawImage(sprite('bench', 16, 7, g => paint(g, ART.bench, { b: '#a1887f', B: '#795548', o: '#4e342e' })), X, Y + 7); break
    case '8': c.drawImage(sprite('snowman', 12, 13, g => paint(g, ART.snowman, { o: '#37474f', w: '#ffffff', e: '#333333', n: '#ff9800', r: '#e53935' })), X + 2, Y + 2); break
    case 'o': c.drawImage(sprite('pot', 8, 7, g => paint(g, ART.pot, { p: '#f06292', y: '#ffd54f', g: '#5fae45', o: '#8d4a2f', c: '#d1693f' })), X + 4, Y + 8); break
    case '^': c.drawImage(sprite('birdhouse', 8, 13, g => paint(g, ART.birdhouse, { r: '#e57373', w: '#d7ccc8', o: '#4e342e', b: '#6d4c41' })), X + 4, Y + 2); break
    case 'Ω': c.drawImage(sprite('statue', 8, 13, g => paint(g, ART.statue, { s: '#eceff1', g: '#90a4ae', G: '#b0bec5' })), X + 4, Y - 2); break
    // a fixed bike at the AI data center: the left wheel draws all of it, across three tiles; the right wheel is part of it
    case 'Ø': drawBike(c, X, Y, now); break
    case 'ø': break
    default: c.fillStyle = '#ffd54f'; c.fillRect(X + 6, Y + 8, 4, 4)
  }
}

function drawBike(c, X, Y, now) {
  const seat = { x: X / T + 1, y: Y / T }
  const ridden = !!state?.movers?.some(m => m.k !== 'mochi' && Math.round(m.x) === seat.x && Math.round(m.y) === seat.y)
  const spin = ridden ? now / 120 : 0
  // the stand that keeps it in place
  c.fillStyle = '#546e7a'; c.fillRect(X + 4, Y + 15, 40, 1)
  for (const cx of [X + 8, X + 40]) {
    c.strokeStyle = '#263238'; c.lineWidth = 1.5
    c.beginPath(); c.arc(cx, Y + 10, 5, 0, Math.PI * 2); c.stroke()
    c.strokeStyle = '#90a4ae'; c.lineWidth = 0.75
    for (let k = 0; k < 3; k++) {
      const a = spin + k * Math.PI / 3
      c.beginPath(); c.moveTo(cx - Math.cos(a) * 4.5, Y + 10 - Math.sin(a) * 4.5); c.lineTo(cx + Math.cos(a) * 4.5, Y + 10 + Math.sin(a) * 4.5); c.stroke()
    }
  }
  c.strokeStyle = '#26a69a'; c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(X + 8, Y + 10); c.lineTo(X + 22, Y + 10); c.lineTo(X + 40, Y + 10)
  c.moveTo(X + 22, Y + 10); c.lineTo(X + 20, Y + 3)
  c.moveTo(X + 22, Y + 10); c.lineTo(X + 36, Y + 3); c.lineTo(X + 40, Y + 10)
  c.stroke()
  c.fillStyle = '#3e2723'; c.fillRect(X + 17, Y + 2, 6, 2)
  c.fillStyle = '#37474f'; c.fillRect(X + 34, Y + 1, 5, 2)
  // the cable to the data center
  c.strokeStyle = 'rgba(255,213,79,.8)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(X + 40, Y + 15); c.lineTo(39 * T, Y + 15); c.stroke()
}

// ---------- the state, and walking between ticks ----------

let state = null
let raining = false
let lightNow = { tint: [0, 0, 0], amount: 0, glow: 0 }
/** Where each mover is drawn, gliding toward where the latest tick put it. */
const shown = new Map()
let lastStateAt = 0
let tickMs = 150

function onState(next) {
  const now = performance.now()
  if (lastStateAt) tickMs = Math.max(80, Math.min(400, tickMs * 0.8 + (now - lastStateAt) * 0.2))
  lastStateAt = now
  if (state && state.scene !== next.scene) shown.clear()
  for (const m of next.movers) {
    const s = shown.get(m.k)
    if (!s || Math.abs(s.tx - m.x) + Math.abs(s.ty - m.y) > 2.5) shown.set(m.k, { x: m.x, y: m.y, tx: m.x, ty: m.y, fromX: m.x, fromY: m.y, at: now, face: s?.face ?? 'down', walkUntil: 0 })
    else if (s.tx !== m.x || s.ty !== m.y) {
      const dx = m.x - s.tx, dy = m.y - s.ty
      s.face = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
      s.fromX = s.x; s.fromY = s.y; s.tx = m.x; s.ty = m.y; s.at = now; s.walkUntil = now + tickMs * 2.2
    }
  }
  for (const k of [...shown.keys()]) if (!next.movers.some(m => m.k === k)) shown.delete(k)
  raining = next.weather === 'rain'
  state = next
  updateHud()
}

function daylight(minutes, rain) {
  const h = minutes / 60
  const mixc = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t))
  let tint = [255, 255, 255], amount = 0, glow = 0
  if (h >= 16.5 && h < 19) { tint = [255, 122, 48]; amount = ((h - 16.5) / 2.5) * 0.22; glow = Math.max(0, h - 18) * 0.5 }
  else if (h >= 19 && h < 21) { const t = (h - 19) / 2; tint = mixc([138, 58, 80], [15, 22, 64], t); amount = 0.25 + t * 0.25; glow = 0.5 + t * 0.5 }
  else if (h >= 21 || h < 4.5) { tint = [15, 22, 64]; amount = 0.5; glow = 1 }
  else if (h >= 4.5 && h < 6.5) { const t = (h - 4.5) / 2; tint = mixc([15, 22, 64], [154, 122, 184], t); amount = 0.5 - t * 0.4; glow = 1 - t }
  if (rain) { tint = amount ? mixc(tint, [58, 74, 90], 0.3) : [58, 74, 90]; amount = Math.max(amount, 0.2) }
  return { tint, amount, glow }
}

// ---------- the camera ----------

const cam = { x: 0, y: 0, zoom: 3, follow: true, fit: false }
let drag = null

function viewSize() { return { w: canvas.width / cam.zoom, h: canvas.height / cam.zoom } }
function clampCam() {
  if (!map) return
  const { w, h } = viewSize()
  const mw = map.w * T, mh = map.h * T + 12
  cam.x = mw <= w ? (mw - w) / 2 : Math.max(0, Math.min(mw - w, cam.x))
  cam.y = mh <= h ? (mh - h) / 2 : Math.max(-60 / cam.zoom, Math.min(mh - h, cam.y))
}
function fitZoom() {
  if (!map) return 1
  return Math.min(canvas.width / (map.w * T), (canvas.height - 120 * devicePixelRatio) / (map.h * T + 12))
}
function setFollow(on) {
  cam.follow = on
  $('follow').classList.toggle('on', on)
  if (on) { cam.fit = false; $('fit').classList.remove('on'); if (cam.zoom < 2 * devicePixelRatio) cam.zoom = 3 * devicePixelRatio }
}
function zoomBy(f, cx = canvas.width / 2, cy = canvas.height / 2) {
  const wx = cam.x + cx / cam.zoom, wy = cam.y + cy / cam.zoom
  const min = Math.min(fitZoom(), devicePixelRatio)
  cam.zoom = Math.max(min, Math.min(8 * devicePixelRatio, cam.zoom * f))
  if (cam.zoom > 1.5 * devicePixelRatio) cam.zoom = Math.round(cam.zoom / devicePixelRatio) * devicePixelRatio
  cam.x = wx - cx / cam.zoom
  cam.y = wy - cy / cam.zoom
  cam.fit = false
  $('fit').classList.remove('on')
  clampCam()
}

canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX * devicePixelRatio, e.offsetY * devicePixelRatio) }, { passive: false })
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId) })
canvas.addEventListener('pointermove', e => {
  if (!drag) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y
  if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; canvas.classList.add('dragging'); if (cam.follow) setFollow(false) }
  if (drag.moved) { cam.x = drag.cx - dx * devicePixelRatio / cam.zoom; cam.y = drag.cy - dy * devicePixelRatio / cam.zoom; clampCam() }
})
canvas.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('dragging') })
canvas.addEventListener('dblclick', () => setFollow(true))
$('follow').onclick = () => setFollow(true)
$('fit').onclick = () => { cam.fit = true; setFollow(false); $('fit').classList.add('on'); cam.zoom = fitZoom(); clampCam() }
$('zoomIn').onclick = () => zoomBy(1.4)
$('zoomOut').onclick = () => zoomBy(1 / 1.4)

function resize() {
  const w = Math.round(canvas.clientWidth * devicePixelRatio)
  const h = Math.round(canvas.clientHeight * devicePixelRatio)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h
    if (cam.fit) cam.zoom = fitZoom()
    clampCam()
  }
}

// ---------- drawing a frame ----------

function wrap(text, width, maxLines) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/)) {
    if (!line) line = word
    else if ((line + ' ' + word).length <= width) line += ' ' + word
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) { const cut = lines.slice(0, maxLines); cut[maxLines - 1] = cut[maxLines - 1].slice(0, width - 1) + '…'; return cut }
  return lines
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

const particles = Array.from({ length: 90 }, (_, k) => ({ x: noise(k, 1, 77), y: noise(k, 2, 77), s: noise(k, 3, 77) }))

function frame(now) {
  requestAnimationFrame(frame)
  resize()
  const W = canvas.width, Hc = canvas.height
  const dpr = devicePixelRatio
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  if (!map || !state) { ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, W, Hc); return }
  const museum = map.scene === 'museum'
  lightNow = daylight(state.minutes, raining && !museum)
  const night = lightNow.glow > 0.4

  // everyone glides from where they were to where the last tick put them
  for (const s of shown.values()) {
    const t = Math.min(1, (now - s.at) / tickMs)
    s.x = s.fromX + (s.tx - s.fromX) * t
    s.y = s.fromY + (s.ty - s.fromY) * t
  }
  const me = shown.get('me')
  if (cam.follow && me) {
    const { w, h } = viewSize()
    const tx = me.x * T + 8 - w / 2, ty = me.y * T + 8 - h / 2
    // a long jump (a new scene, the museum door) cuts; anything else glides
    const far = Math.abs(tx - cam.x) > w || Math.abs(ty - cam.y) > h
    cam.x += (tx - cam.x) * (far ? 1 : 0.12)
    cam.y += (ty - cam.y) * (far ? 1 : 0.12)
    clampCam()
  }
  const z = cam.zoom
  const ox = Math.round(-cam.x * z), oy = Math.round(-cam.y * z)

  ctx.fillStyle = museum ? '#1f1512' : (SEASONS[map.season] ?? SEASONS.spring).grass[1]
  ctx.fillRect(0, 0, W, Hc)
  if (!museum) { ctx.fillStyle = 'rgba(11,42,20,.45)'; ctx.fillRect(0, 0, W, Hc) }
  ctx.setTransform(z, 0, 0, z, ox, oy)
  ctx.drawImage(ground, 0, 0)

  // water glints and dig spots
  ctx.fillStyle = '#ffffff'
  for (const sp of sparkles) if (Math.floor(now / 1000 + sp.phase) % 3 === 0) ctx.fillRect(sp.x, sp.y, 4, 1)
  ctx.fillStyle = '#6d4c41'
  for (const d of state.digs) { const X = d.x * T, Y = d.y * T; ctx.fillRect(X + 5, Y + 7, 6, 1); ctx.fillRect(X + 7, Y + 5, 2, 5) }

  // everything standing, sorted by the row its feet are on
  const list = props.map(p => ({ y: p.y, draw: p.draw }))
  for (const p of state.pickups) {
    list.push({ y: (p.y + 1) * T, draw: c => {
      if (Math.floor(now / 300) % 3 === 0) return
      c.drawImage(sprite(`star:${p.star}`, 7, 7, g => paint(g, ART.star, { y: p.star ? '#fff59d' : '#ffd54f', Y: '#ffffff' })), p.x * T + 4, p.y * T + 4)
    } })
  }
  const labels = []
  for (const m of state.movers) {
    const s = shown.get(m.k)
    if (!s) continue
    const walking = now < s.walkUntil
    const step = walking ? 1 + (Math.floor(now / 130) % 2) : 0
    list.push({ y: (s.y + 1) * T + 0.5, draw: c => {
      const X = s.x * T, Y = s.y * T
      c.fillStyle = 'rgba(0,0,0,.22)'
      c.beginPath(); c.ellipse(X + 8, Y + 15, 6, 2, 0, 0, Math.PI * 2); c.fill()
      if (m.k === 'mochi') {
        const img = catSprite(!!m.asleep)
        if (s.face === 'left') { c.save(); c.translate(X + 14, Y + 6); c.scale(-1, 1); c.drawImage(img, 0, 0); c.restore() }
        else c.drawImage(img, X + 2, Y + (m.asleep ? 9 : 6))
        return
      }
      if (m.k === 'hoot') { c.drawImage(owlSprite(), X + 2, Y + 1); return }
      const look = LOOKS[m.k] ?? LOOKS.me
      const img = personSprite(m.k, s.face === 'left' || s.face === 'right' ? 'side' : s.face, step)
      const sc = look.small ? 0.85 : 1
      const bob = walking && step === 2 ? -1 : 0
      c.save()
      c.translate(X + (s.face === 'left' ? 16 : 0), Y + 15 - 25 * sc + bob)
      c.scale(s.face === 'left' ? -sc : sc, sc)
      c.drawImage(img, 0, 0)
      c.restore()
      if (m.asleep && Math.floor(now / 700) % 2) { c.fillStyle = '#ffffff'; c.font = '700 6px system-ui'; c.fillText('z', X + 13, Y - 8) }
    } })
    labels.push({ m, s, height: m.k === 'mochi' ? 10 : m.k === 'hoot' ? 16 : (LOOKS[m.k]?.small ? 19 : 23) })
  }
  list.sort((a, b) => a.y - b.y)
  for (const it of list) it.draw(ctx, now, night)

  // critters
  for (const [k, c] of state.critters.entries()) {
    if (c.kind === 'firefly' && lightNow.glow < 0.2) continue
    const X = c.x * T, Y = c.y * T
    const hx = Math.round(Math.sin(now / 700 + k) * 3), hy = Math.round(Math.cos(now / 900 + k * 2) * 2)
    if (c.kind === 'firefly') continue
    ctx.fillStyle = c.color
    if (c.flies) { const flap = Math.floor(now / 150 + k) % 2; ctx.fillRect(X + 6 + hx, Y + 2 + hy, flap ? 3 : 1, 2); ctx.fillRect(X + 9 + hx, Y + 2 + hy, flap ? 3 : 1, 2) }
    else ctx.fillRect(X + 7, Y + 11, 2, 2)
  }

  // the hour's light, then lamps and windows glowing through it
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (lightNow.amount > 0) {
    const [r, g, b] = lightNow.tint
    ctx.fillStyle = `rgba(${r},${g},${b},${lightNow.amount})`
    ctx.fillRect(0, 0, W, Hc)
  }
  if (lightNow.glow > 0.05 && !museum) {
    ctx.globalCompositeOperation = 'lighter'
    const glow = (x, y, r, color) => {
      const sx = x * z + ox, sy = y * z + oy, rr = r * z
      if (sx < -rr || sy < -rr || sx > W + rr || sy > Hc + rr) return
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr)
      grad.addColorStop(0, color.replace('A', String(0.55 * lightNow.glow)))
      grad.addColorStop(1, color.replace('A', '0'))
      ctx.fillStyle = grad
      ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2)
    }
    for (const l of lamps) glow(l.x, l.y + 2, l.neon ? 40 : 26, l.neon ? 'rgba(255,64,160,A)' : 'rgba(255,200,110,A)')
    for (const w of windows) glow(w.x + 6, w.y + 4, 16, 'rgba(255,210,120,A)')
    for (const [k, c] of state.critters.entries()) {
      if (c.kind !== 'firefly') continue
      const hx = Math.sin(now / 700 + k) * 3, hy = Math.cos(now / 900 + k * 2) * 2
      if (Math.floor(now / 400 + k) % 3) glow(c.x * T + 8 + hx, c.y * T + 2 + hy, 6, 'rgba(255,245,157,A)')
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  // weather and sky shows, over the whole screen
  if (raining && !museum) {
    const snow = map.season === 'winter'
    ctx.fillStyle = snow ? 'rgba(255,255,255,.9)' : 'rgba(207,232,247,.55)'
    for (const p of particles) {
      const speed = snow ? 0.05 : 0.9
      const y = ((p.y * Hc + now * speed * dpr * (0.7 + p.s * 0.6)) % (Hc + 40)) - 20
      const x = ((p.x * W - (snow ? -Math.sin(now / 900 + p.s * 9) * 20 : (now * 0.25 * dpr) % W)) % W + W) % W
      if (snow) ctx.fillRect(x, y, 3 * dpr, 3 * dpr); else ctx.fillRect(x, y, 1.5 * dpr, 10 * dpr)
    }
  }
  if (!museum && !raining && !night && (map.season === 'spring' || map.season === 'autumn')) {
    const colors = map.season === 'spring' ? ['#f8bbd0', '#fce4ec', '#f48fb1'] : ['#e65100', '#f9a825', '#bf360c']
    particles.slice(0, 12).forEach((p, k) => {
      const t = (now / 14000 + p.s) % 1
      ctx.fillStyle = colors[k % 3]
      ctx.fillRect(((p.x * W * 1.3) - t * W * 0.4) % W, t * Hc, 4 * dpr, 3 * dpr)
    })
  }
  if (state.meteor && night && !museum) {
    ctx.strokeStyle = '#fffde7'; ctx.lineWidth = 2 * dpr
    for (let k = 0; k < 3; k++) {
      const t = ((now / 3500 + k / 3) % 1)
      if (t > 0.5) continue
      const x = W * (0.4 + noise(k, Math.floor(now / 3500), 6) * 0.6) - t * W * 0.5, y = Hc * 0.1 + t * Hc * 0.3
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 40 * dpr, y - 20 * dpr); ctx.stroke()
    }
  }
  if (state.fireworks && night && !museum) {
    const colors = ['#ff5252', '#ffeb3b', '#69f0ae', '#40c4ff', '#e040fb']
    for (let k = 0; k < 4; k++) {
      const cycle = Math.floor(now / 1800 + k * 0.37)
      const t = (now / 1800 + k * 0.37) % 1
      const cx = W * (0.15 + noise(k, cycle, 8) * 0.7), cy = Hc * (0.15 + noise(cycle, k, 9) * 0.3)
      ctx.fillStyle = colors[(k + cycle) % 5]
      ctx.globalAlpha = 1 - t
      for (let a = 0; a < 12; a++) { const ang = a / 12 * Math.PI * 2; ctx.fillRect(cx + Math.cos(ang) * t * 70 * dpr, cy + Math.sin(ang) * t * 70 * dpr, 4 * dpr, 4 * dpr) }
      ctx.globalAlpha = 1
    }
  }
  if (state.rainbow > 0 && !museum) {
    ctx.globalAlpha = Math.min(0.45, state.rainbow / 40)
    ctx.lineWidth = 8 * dpr
    ;['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5', '#ab47bc'].forEach((c, k) => {
      ctx.strokeStyle = c; ctx.beginPath(); ctx.ellipse(W / 2, Hc * 0.65, W * 0.38 - k * 8 * dpr, Hc * 0.5 - k * 8 * dpr, 0, Math.PI, 0); ctx.stroke()
    })
    ctx.globalAlpha = 1
  }

  // name tags and speech bubbles, in screen pixels so text stays crisp
  const toScreen = (x, y) => [x * z + ox, y * z + oy]
  const tagScale = Math.max(0.8, Math.min(1.4, z / (3 * dpr))) * dpr

  // the bomb factory: a ruin with rising smoke after a blast, and the blast itself
  if (state.factory && !museum) {
    const [fx, fy] = toScreen(65 * T, 11 * T)
    const fw = 7 * T * z, fh = 4 * T * z
    if (state.factory.rubble) {
      ctx.fillStyle = '#3e2723'; ctx.fillRect(fx, fy + fh * 0.35, fw, fh * 0.65)
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = ['#6d4c41', '#9e9e9e', '#424242', '#8d6e63'][k % 4]
        const s = (3 + noise(k, 1, 2) * 5) * z
        ctx.fillRect(fx + noise(k, 3, 4) * (fw - s), fy + fh * (0.3 + noise(k, 5, 6) * 0.6), s, s * 0.7)
      }
      for (let k = 0; k < 6; k++) {
        const t = (now / 3000 + k / 6) % 1
        ctx.fillStyle = `rgba(140,140,140,${0.55 * (1 - t)})`
        ctx.beginPath()
        ctx.arc(fx + fw * (0.2 + noise(k, 7, 8) * 0.6) + Math.sin(now / 700 + k) * 4 * z, fy + fh * 0.4 - t * 40 * z, (4 + t * 10) * z, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (state.factory.boom > 0) {
      const phase = Math.max(0, 30 - state.factory.boom)
      const [cx, cy] = toScreen(68 * T + 8, 12 * T + 8)
      const r = (1 + phase / 2) * T * z
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      const a = Math.max(0, 1 - phase / 30)
      glow.addColorStop(0, `rgba(255,253,231,${a})`)
      glow.addColorStop(0.35, `rgba(255,183,77,${a * 0.9})`)
      glow.addColorStop(0.7, `rgba(229,57,53,${a * 0.6})`)
      glow.addColorStop(1, 'rgba(66,66,66,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
      for (let k = 0; k < 24; k++) {
        const ang = k / 24 * Math.PI * 2 + noise(k, 9, 1)
        const d = r * (0.8 + noise(k, 2, 3) * 0.4)
        ctx.fillStyle = ['#fff176', '#ffb74d', '#ff7043', '#757575'][k % 4]
        ctx.fillRect(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d * 0.6, 3 * z, 3 * z)
      }
      if (phase < 22) {
        ctx.font = `bold ${Math.round(14 * z)}px system-ui`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#000000'
        ctx.fillStyle = Math.floor(now / 120) % 2 ? '#ffeb3b' : '#ff5252'
        ctx.strokeText('KABOOM!', cx, cy - T * z); ctx.fillText('KABOOM!', cx, cy - T * z)
      }
    }
  }
  // the AI data center: its battery gauge and mood above the roof, and a red glare once it turns evil
  if (state.datacenter && !museum) {
    const { battery, mood } = state.datacenter
    const [bx, by] = toScreen(39 * T, 19 * T)
    const bw = 7 * T * z, bh = 4 * T * z
    if (mood === 'evil') {
      const pulse = 0.25 + 0.2 * Math.sin(now / 180)
      const glow = ctx.createRadialGradient(bx + bw / 2, by + bh / 2, 0, bx + bw / 2, by + bh / 2, bw)
      glow.addColorStop(0, `rgba(255,23,68,${pulse})`)
      glow.addColorStop(1, 'rgba(255,23,68,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(bx + bw / 2, by + bh / 2, bw, 0, Math.PI * 2); ctx.fill()
    }
    const gw = bw * 0.7, gh = 5 * z
    const gx = bx + (bw - gw) / 2, gy = by - 12 * z
    ctx.fillStyle = '#263238'; ctx.fillRect(gx - z, gy - z, gw + 2 * z, gh + 2 * z)
    ctx.fillStyle = battery >= 50 ? '#69f0ae' : battery >= 15 ? '#ffd54f' : '#ff5252'
    ctx.fillRect(gx, gy, gw * battery / 100, gh)
    ctx.fillStyle = '#263238'; ctx.fillRect(gx + gw + z, gy + gh * 0.25, 2 * z, gh * 0.5)
    ctx.font = `bold ${Math.round(9 * z)}px system-ui`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#000000'
    const face = mood === 'evil' ? '>:(' : mood === 'kind' ? (Math.floor(now / 3000) % 8 === 7 ? '-_-' : '^_^') : 'o_o'
    ctx.fillStyle = mood === 'evil' ? '#ff1744' : mood === 'kind' ? '#80deea' : '#ffd54f'
    const label = `${face}  ⚡${battery}%`
    ctx.strokeText(label, bx + bw / 2, gy - 8 * z); ctx.fillText(label, bx + bw / 2, gy - 8 * z)
  }
  if (z >= 1.5 * dpr) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const placed = []
    for (const { m, s } of labels) {
      if (!m.name || m.k === 'mochi') continue
      const [sx, sy] = toScreen(s.x * T + 8, (s.y + 1) * T + 4)
      ctx.font = `700 ${Math.round(11 * tagScale)}px "Segoe UI", system-ui, sans-serif`
      const tw = ctx.measureText(m.name).width + 18 * tagScale
      const th = 17 * tagScale
      ctx.fillStyle = 'rgba(31,36,48,.88)'
      roundRect(ctx, sx - tw / 2, sy, tw, th, th / 2); ctx.fill()
      ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(sx - tw / 2 + 8 * tagScale, sy + th / 2, 3 * tagScale, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'; ctx.fillText(m.name, sx + 4 * tagScale, sy + th / 2 + 0.5)
      placed.push({ l: sx - tw / 2, r: sx + tw / 2, t: sy, b: sy + th })
    }
    // Claude's bubble first, then the others, each kept clear of the ones before
    const talkers = labels.filter(l => l.m.say).sort((a, b) => (a.m.k === 'me' ? -1 : b.m.k === 'me' ? 1 : 0))
    for (const { m, s, height } of talkers) {
      const [hx, hy] = toScreen(s.x * T + 8, s.y * T + 15 - height * 1.05)
      if (hx < -20 || hx > W + 20 || hy < 0 || hy > Hc + 40) continue // someone talking off screen: the chat has the line
      const thinking = m.say === '…'
      ctx.font = `600 ${Math.round(12 * tagScale)}px "Segoe UI", system-ui, sans-serif`
      const lines = thinking ? [''] : wrap(m.say, 34, 3)
      const lh = 15 * tagScale
      const bw = thinking ? 46 * tagScale : Math.max(...lines.map(l => ctx.measureText(l).width)) + 20 * tagScale
      const bh = lines.length * lh + 12 * tagScale
      let bx = hx - bw / 2, by = hy - 10 * tagScale - bh
      search: for (let lift = 0; lift < 5; lift++) {
        for (const shift of [0, -0.55, 0.55, -1, 1]) {
          const x = Math.max(8, Math.min(W - bw - 8, hx - bw / 2 + shift * bw)), y = hy - 10 * tagScale - bh - lift * (bh + 4 * tagScale)
          if (!placed.some(q => x < q.r && q.l < x + bw && y < q.b && q.t < y + bh)) { bx = x; by = y; break search }
        }
      }
      placed.push({ l: bx, r: bx + bw, t: by, b: by + bh })
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5 * dpr
      const tail = Math.max(bx + 12 * tagScale, Math.min(bx + bw - 12 * tagScale, hx))
      ctx.beginPath(); ctx.moveTo(tail - 6 * tagScale, by + bh - 1); ctx.lineTo(hx, hy - 2); ctx.lineTo(tail + 6 * tagScale, by + bh - 1); ctx.closePath(); ctx.fill(); ctx.stroke()
      roundRect(ctx, bx, by, bw, bh, 7 * tagScale); ctx.fill(); ctx.stroke()
      ctx.fillRect(tail - 5 * tagScale, by + bh - 3 * tagScale, 10 * tagScale, 3 * tagScale)
      ctx.fillStyle = OUTLINE
      if (thinking) {
        for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.3 + 0.7 * ((Math.floor(now / 300) - k) % 3 === 0 ? 1 : 0.3); ctx.beginPath(); ctx.arc(bx + bw / 2 + (k - 1) * 11 * tagScale, by + bh / 2, 3.5 * tagScale, 0, Math.PI * 2); ctx.fill() }
        ctx.globalAlpha = 1
      } else {
        ctx.textAlign = 'left'
        lines.forEach((l, k) => ctx.fillText(l, bx + 10 * tagScale, by + 6 * tagScale + lh * (k + 0.5)))
        ctx.textAlign = 'center'
      }
    }
    // what Claude is busy with, and the cheer or rain cloud over its head
    if (me) {
      const [hx, hy] = toScreen(me.x * T + 8, me.y * T - 12)
      const icon = WORK_ICON[state.work]
      if (icon && !state.thinking) { ctx.font = `${Math.round(16 * tagScale)}px "Segoe UI Emoji", system-ui`; ctx.fillText(icon, hx + 22 * tagScale, hy - 6 * tagScale) }
      if (state.cheer) {
        const colors = ['#ff5252', '#ffeb3b', '#69f0ae', '#40c4ff', '#e040fb']
        for (let k = 0; k < 14; k++) {
          const t = (now / 1400 + k / 14) % 1
          ctx.fillStyle = colors[k % 5]
          ctx.fillRect(hx + (k - 7) * 5 * tagScale * t * 2, hy - 20 * tagScale + t * 40 * tagScale, 4 * tagScale, 4 * tagScale)
        }
      }
      if (state.cloud) {
        ctx.fillStyle = '#90a4ae'
        roundRect(ctx, hx - 18 * tagScale, hy - 34 * tagScale, 36 * tagScale, 14 * tagScale, 7 * tagScale); ctx.fill()
        ctx.fillStyle = '#4fc3f7'
        for (let k = 0; k < 3; k++) ctx.fillRect(hx + (k - 1) * 10 * tagScale, hy - 18 * tagScale + ((now / 6 + k * 7) % 14) * tagScale, 2 * tagScale, 5 * tagScale)
      }
    }
  } else if (me) {
    // zoomed far out: an arrow over Claude
    const [hx, hy] = toScreen(me.x * T + 8, me.y * T - 6)
    const b = Math.sin(now / 250) * 3 * dpr
    ctx.fillStyle = '#d97757'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * dpr
    ctx.beginPath(); ctx.moveTo(hx - 9 * dpr, hy - 22 * dpr + b); ctx.lineTo(hx + 9 * dpr, hy - 22 * dpr + b); ctx.lineTo(hx, hy - 8 * dpr + b); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
  if (state.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, state.flash * 0.25)})`; ctx.fillRect(0, 0, W, Hc) }
}
requestAnimationFrame(frame)

// ---------- the panels ----------

const post = action => fetch(`/api/do?k=${encodeURIComponent(KEY)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) }).catch(() => {})
let info = null
let infoTab = 'village'
let infoShown = ''

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
const meter = (pct, cls = '') => { const m = el('div', `meter ${cls}`); const i = el('i'); i.style.width = `${Math.round(pct * 100)}%`; m.append(i); return m }
const cap = t => t[0].toUpperCase() + t.slice(1)

function villageRows() {
  const out = []
  out.push(el('h4', '', 'Requests'))
  if (!info.requests.length) out.push(el('div', 'sub', 'No requests today.'))
  for (const r of info.requests) {
    const row = el('div', 'row'); const who = el('b', '', r.who); who.style.color = r.color
    row.append(who, r.done ? el('span', 'done', '\u2713 done') : el('span', '', `wants ${r.left} ${r.item} \u00b7 pays ${r.reward} Bells`))
    out.push(row)
  }
  out.push(el('h4', '', 'Projects'))
  for (const p of info.projects) {
    const row = el('div', 'row top')
    row.append(el('span', '', p.name))
    const col = el('div')
    if (p.done) col.append(el('span', 'done', '\u2713 built'))
    else col.append(meter(p.pct), el('div', 'sub', `${p.bells}/${p.need} Bells${p.items.length ? ' \u00b7 ' + p.items.map(i => `${i.have}/${i.need} ${i.name}`).join(', ') : ''}`))
    row.append(col); out.push(row)
  }
  const total = info.museum.sections.reduce((a, s) => a + s.total, 0)
  const have = info.museum.sections.reduce((a, s) => a + s.have, 0)
  out.push(el('h4', '', `Museum \u00b7 ${have}/${total} pieces`))
  if (!info.museum.open) out.push(el('div', 'sub', 'Not built yet - fund it on the plaza board.'))
  else {
    for (const s of info.museum.sections) {
      const row = el('div', 'row top'); row.append(el('span', '', cap(s.name)))
      const col = el('div'); col.append(meter(s.have / Math.max(1, s.total), 'blue'), el('div', 'sub', `${s.have}/${s.total}`))
      const pieces = el('div', 'pieces')
      for (const p of s.pieces) pieces.append(el('span', p.got ? 'got' : '', p.name))
      col.append(pieces); row.append(col); out.push(row)
    }
    out.push(el('div', 'sub', `Complete it for ${info.museum.reward.toLocaleString('en-US')} Bells.`))
  }
  return out
}

function memoryRows() {
  const out = []
  for (const p of info.people) {
    const row = el('div', 'row top'); const who = el('b', '', p.name); who.style.color = p.color
    const head = el('div'); head.append(who)
    if (p.hearts !== null) head.append(' ', el('span', 'heart', `\u2665 ${p.hearts}`))
    const col = el('div'); col.append(el('div', '', p.diary))
    if (p.facts.length) col.append(el('div', 'sub', `knows: ${p.facts.join(' \u00b7 ')}`))
    row.append(head, col); out.push(row)
  }
  return out
}

function renderInfo() {
  if (!info || !$('info').classList.contains('show')) return
  const key = infoTab + JSON.stringify(info)
  if (key === infoShown) return
  infoShown = key
  const box = $('infoBody'); const top = box.scrollTop
  box.replaceChildren(...(infoTab === 'village' ? villageRows() : memoryRows()))
  box.scrollTop = top
}
const showInfoTab = t => { infoTab = t; $('tabVillage').classList.toggle('on', t === 'village'); $('tabMemories').classList.toggle('on', t === 'memories'); renderInfo() }
$('infoBtn').onclick = () => { $('info').classList.toggle('show'); $('infoBtn').classList.toggle('on', $('info').classList.contains('show')); renderInfo() }
$('closeInfo').onclick = () => { $('info').classList.remove('show'); $('infoBtn').classList.remove('on') }
$('tabVillage').onclick = () => showInfoTab('village')
$('tabMemories').onclick = () => showInfoTab('memories')

let logKey = ''
let choreKey = ''

function updateHud() {
  const s = state
  $('when').textContent = `${s.clock} · Day ${s.day}`
  $('season').textContent = `${s.season[0].toUpperCase()}${s.season.slice(1)} ${s.seasonDay}${s.weather === 'rain' ? (s.season === 'winter' ? ' · snow' : ' · rain') : ''}`
  $('bells').textContent = s.bells.toLocaleString('en-US')
  $('doing').textContent = s.thinking ? 'thinking…' : s.label
  $('eventChip').hidden = !s.events
  $('events').textContent = s.scene === 'museum' ? s.museum : s.events
  if (s.scene === 'museum') $('eventChip').hidden = false
  $('museum').hidden = !s.museumOpen
  $('museum').textContent = s.scene === 'museum' ? 'Leave museum' : 'Museum tour'
  $('bagText').textContent = s.inv.map(([k, n]) => `${n} ${k}`).join(' · ') || 'empty'
  $('wishText').placeholder = s.thinking ? 'Claude is thinking…' : 'Tell Claude what to do, e.g. "buy pumpkin seeds and plant them"'

  const key = s.log.map(l => l.who + l.text).join('|')
  if (key !== logKey) {
    logKey = key
    const box = $('log')
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4
    box.replaceChildren(...(s.log.length ? s.log : [{ event: true, text: 'Nothing has happened yet. Tell Claude what to do below.' }]).map(l => {
      const row = document.createElement('div')
      row.className = l.event ? 'line event' : 'line'
      if (!l.event) { const who = document.createElement('span'); who.className = 'who'; who.style.color = l.color; who.textContent = l.who; row.append(who) }
      const text = document.createElement('span'); text.textContent = l.text; row.append(text)
      return row
    }))
    if (atBottom) box.scrollTop = box.scrollHeight
  }
  const ck = s.chores.map(c => c.key).join()
  if (ck !== choreKey) {
    choreKey = ck
    $('chores').replaceChildren(...s.chores.map(c => { const b = document.createElement('button'); b.textContent = c.label; b.onclick = () => post({ kind: 'chore', key: c.key }); return b }))
  }
}

$('wish').onsubmit = e => {
  e.preventDefault()
  const text = $('wishText').value.trim()
  if (text) post({ kind: 'wish', text })
  $('wishText').value = ''
}
$('museum').onclick = () => post({ kind: 'museum' })
$('toggleChat').onclick = () => { $('chat').classList.toggle('closed'); $('toggleChat').textContent = $('chat').classList.contains('closed') ? '▸' : '▾' }

// ---------- the stream ----------

function connect() {
  const events = new EventSource(`/events?k=${encodeURIComponent(KEY)}`)
  let alive = 0
  events.addEventListener('map', e => {
    const next = JSON.parse(e.data)
    const first = !map
    map = next
    buildMap(map)
    if (first) { cam.zoom = 3 * devicePixelRatio; clampCam() }
  })
  events.addEventListener('info', e => { info = JSON.parse(e.data); renderInfo() })
  events.addEventListener('state', e => { alive = performance.now(); onState(JSON.parse(e.data)); $('offline').classList.add('hide') })
  events.onerror = () => $('offline').classList.remove('hide')
  setInterval(() => { if (performance.now() - alive > 4000) $('offline').classList.remove('hide') }, 1000)
}
connect()
