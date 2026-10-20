// What Bells and items are good for: crops, the shop, recipes, community projects, the museum and requests.
// Pure data, no imports.

export type CropKind = 'turnip' | 'carrot' | 'strawberry' | 'pumpkin'
/** `growth` is how many stages a watered crop grows per day; stage 3 is ripe. */
export const CROPS: Record<CropKind, { seeds: string | null; growth: number; glyph: string; color: number; days: number }> = {
  turnip: { seeds: null, growth: 1, glyph: '♠', color: 0xf5f5f5, days: 3 },
  carrot: { seeds: 'carrot seeds', growth: 1.5, glyph: 'v', color: 0xff9800, days: 2 },
  strawberry: { seeds: 'strawberry seeds', growth: 1, glyph: '♥', color: 0xe53935, days: 3 },
  pumpkin: { seeds: 'pumpkin seeds', growth: 0.75, glyph: '●', color: 0xff6f00, days: 4 },
}
export const isCrop = (v: unknown): v is CropKind => typeof v === 'string' && v in CROPS

export type ShopItem = { price: number; kind: 'seeds' | 'tool' | 'decor'; about: string }
export const SHOP: Record<string, ShopItem> = {
  'carrot seeds': { price: 40, kind: 'seeds', about: 'ripe in 2 days, carrots sell for 110' },
  'strawberry seeds': { price: 80, kind: 'seeds', about: 'ripe in 3 days, strawberries sell for 220' },
  'pumpkin seeds': { price: 150, kind: 'seeds', about: 'ripe in 4 days, pumpkins sell for 450' },
  'golden rod': { price: 1500, kind: 'tool', about: 'no more old boots, rare fish bite more often' },
  'bug net': { price: 300, kind: 'tool', about: 'catch bugs for the museum or to sell' },
  shovel: { price: 300, kind: 'tool', about: 'dig up the cracked spots for fossils, gems and buried Bells' },
  lamp: { price: 300, kind: 'decor', about: 'glows at night' },
  'flower pot': { price: 200, kind: 'decor', about: 'a cheerful pot of flowers' },
  'bird house': { price: 400, kind: 'decor', about: 'birds love it' },
  bench: { price: 500, kind: 'decor', about: 'a place to rest' },
  statue: { price: 1800, kind: 'decor', about: 'a fancy stone statue' },
}
/** How each decoration looks on the map: glyph and color. */
export const DECOR: Record<string, [string, number]> = {
  snowman: ['8', 0xffffff], lamp: ['i', 0xffd54f], 'flower pot': ['o', 0xf06292], 'bird house': ['^', 0xa1887f], bench: ['=', 0x8d6e63], statue: ['Ω', 0xcfd8dc],
}

/** `fish` in a recipe means any one fish. */
export const RECIPES: Record<string, { needs: Record<string, number>; price: number }> = {
  'apple pie': { needs: { apple: 2 }, price: 300 },
  'turnip soup': { needs: { turnip: 2 }, price: 250 },
  'grilled fish': { needs: { fish: 1 }, price: 320 },
  'carrot cake': { needs: { carrot: 2, apple: 1 }, price: 480 },
  'strawberry jam': { needs: { strawberry: 2 }, price: 600 },
  'pumpkin pie': { needs: { pumpkin: 1, apple: 1 }, price: 850 },
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
export const SEASON_DAYS = 7
/** Each season has one fish that bites only then. */
export const SEASONAL_FISH: Record<Season, string> = { spring: 'trout', summer: 'catfish', autumn: 'salmon', winter: 'pike' }
/** Each season's festival, on its fourth day: where everyone gathers and when. */
export const SEASON_FESTIVALS: Record<Season, { name: string; place: string; start: number; end: number; about: string }> = {
  spring: { name: 'Blossom picnic', place: 'orchard', start: 11, end: 15, about: 'a picnic under the blossoming apple trees' },
  summer: { name: 'Fireworks night', place: 'plaza', start: 20, end: 22.5, about: 'fireworks over the plaza' },
  autumn: { name: 'Harvest fair', place: 'plaza', start: 10, end: 16, about: 'bring a pumpkin for the biggest-pumpkin prize (1000 Bells), any crop wins 300' },
  winter: { name: 'Winter lights', place: 'plaza', start: 17, end: 21, about: 'lights everywhere and a snowman on the plaza' },
}

export const FISH_KINDS = ['sea bass', 'bluegill', 'carp', 'koi', 'goldfish', 'sturgeon', 'trout', 'catfish', 'salmon', 'pike']

/** Bugs: when and where they show up, how they look, what they fetch. `night` null means any time. */
export type BugHabitat = 'flower' | 'water' | 'tree' | 'grass' | 'house'
export const BUGS: Record<string, { seasons: Season[]; night: boolean | null; habitat: BugHabitat; glyph: string; colors: number[]; price: number; flies: boolean }> = {
  butterfly: { seasons: ['spring', 'summer'], night: false, habitat: 'flower', glyph: 'ж', colors: [0xffeb3b, 0xff80ab, 0x80d8ff, 0xffffff], price: 160, flies: true },
  ladybug: { seasons: ['spring'], night: false, habitat: 'flower', glyph: '•', colors: [0xe53935], price: 100, flies: false },
  dragonfly: { seasons: ['summer', 'autumn'], night: false, habitat: 'water', glyph: '+', colors: [0x26c6da, 0xef5350], price: 230, flies: true },
  firefly: { seasons: ['summer'], night: true, habitat: 'water', glyph: '·', colors: [0xfff176], price: 300, flies: true },
  cicada: { seasons: ['summer'], night: false, habitat: 'tree', glyph: '&', colors: [0xa1887f], price: 250, flies: false },
  beetle: { seasons: ['summer', 'autumn'], night: false, habitat: 'tree', glyph: 'ö', colors: [0x5d4037, 0x1565c0], price: 400, flies: false },
  cricket: { seasons: ['autumn'], night: true, habitat: 'grass', glyph: '`', colors: [0x9ccc65], price: 150, flies: false },
  moth: { seasons: ['autumn', 'winter'], night: true, habitat: 'house', glyph: 'v', colors: [0xd7ccc8], price: 120, flies: true },
}

export const FOSSILS = ['ammonite', 'trilobite', 'amber', 'dino tooth', 'fern fossil']
export const KEEPSAKES = ['photo of Tom', 'pressed rose', 'wooden bird', 'drawing by Pip', 'pie recipe']
export const isFish = (item: string) => FISH_KINDS.includes(item)
/** Each fish's size range in cm; the biggest catch wins contests and sets records. */
export const FISH_SIZE: Record<string, [number, number]> = {
  'sea bass': [30, 80], bluegill: [10, 25], carp: [30, 90], koi: [40, 100], goldfish: [5, 20],
  sturgeon: [80, 250], trout: [25, 70], catfish: [30, 120], salmon: [50, 110], pike: [40, 130],
}

export type ProjectId = 'lamps' | 'benches' | 'park' | 'pier' | 'museum' | 'club' | 'factory'
export const PROJECTS: Record<ProjectId, { name: string; bells: number; items: Record<string, number>; about: string }> = {
  benches: { name: 'Plaza benches', bells: 800, items: { wood: 6 }, about: 'benches around the fountain' },
  park: { name: 'Riverside park', bells: 1200, items: { flower: 5 }, about: 'flower beds along the river' },
  lamps: { name: 'Street lamps', bells: 1500, items: { wood: 5 }, about: 'lamp posts that light the roads at night' },
  pier: { name: 'Fishing pier', bells: 2000, items: { wood: 8 }, about: 'a pier into the pond where rare fish bite' },
  museum: { name: 'Museum', bells: 3000, items: { wood: 10 }, about: 'donate fish and star fragments to fill its collection' },
  factory: { name: 'Bomb factory', bells: 1800, items: { wood: 8 }, about: 'a rickety workshop full of fireworks and cartoon bombs - it blows up now and then, so stand well back' },
  club: { name: 'Velvet Club', bells: 2500, items: { wood: 6 }, about: 'an adults-only strip club with a neon sign, open 21:00-03:00' },
}
export const isProject = (v: unknown): v is ProjectId => typeof v === 'string' && v in PROJECTS

export const MUSEUM: Record<string, string[]> = {
  fish: FISH_KINDS,
  bugs: Object.keys(BUGS),
  fossils: FOSSILS,
  oddities: ['star fragment', 'old boot', 'old coin', 'amethyst', 'ruby'],
}
export const MUSEUM_PIECES = Object.values(MUSEUM).flat()
export const MUSEUM_REWARD = 5000
export const SECTION_REWARD = 1500

export const PRICES: Record<string, number> = {
  turnip: 60, carrot: 110, strawberry: 220, pumpkin: 450, apple: 25, wood: 20, flower: 10,
  'sea bass': 120, bluegill: 90, carp: 80, koi: 400, goldfish: 650, sturgeon: 900, 'old boot': 5,
  trout: 200, catfish: 220, salmon: 300, pike: 350,
  ammonite: 600, trilobite: 700, amber: 900, 'dino tooth': 1200, 'fern fossil': 500, 'old coin': 250, amethyst: 600, ruby: 1500,
  ...Object.fromEntries(Object.entries(BUGS).map(([k, b]) => [k, b.price])),
  'lucky charm': 300, 'star fragment': 800,
  'carrot seeds': 20, 'strawberry seeds': 40, 'pumpkin seeds': 75,
  ...Object.fromEntries(Object.entries(RECIPES).map(([k, r]) => [k, r.price])),
}
/** Kept when the bag is sold: tools, decorations and other people's lost things. */
export const isSellable = (item: string) =>
  !item.includes("'s ") && !KEEPSAKES.includes(item) && item !== 'snowman' && !(item in SHOP && SHOP[item].kind !== 'seeds')

/** What each villager may ask for in a request. `fish` means any fish. */
export const WANTS: Record<string, string[]> = {
  tom: ['fish', 'apple', 'wood'],
  rosa: ['flower', 'strawberry', 'apple'],
  bruno: ['wood', 'apple', 'pumpkin'],
  pip: ['apple', 'strawberry', 'fish'],
  mabel: ['turnip', 'apple', 'carrot', 'pumpkin'],
}
