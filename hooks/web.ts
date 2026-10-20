// What the browser view is sent: the map when it changes, and the moving parts every tick.
// Pure logic, no `$`: register.tsx posts these to the local server that web/server.mjs runs.

import { BUGS, MUSEUM } from './catalog'
import { active, clock, eventLabels, H, season, seasonDay, VILLAGERS, W } from './game'
import type { LogLine } from '../types'
import type { World } from './game'
import { caseAt, HALL_TITLES, IH, interiorTile, IW } from './museum'

const TILE_CODE: Record<string, string> = {
  grass: 'g', tuft: 't', path: 'p', plaza: 'z', bridge: 'b', water: 'w', fountain: 'f', tree: 'T', apple: 'a',
  roof: 'r', wall: 'l', door: 'd', fence: 'n', soil: 's', flower: 'o', item: 'i',
}
const ROOM_CODE: Record<string, string> = { wall: 'w', floor: 'f', carpet: 'c', case: 's', door: 'd', plant: 'p', void: ' ' }
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`

export const NAMES: Record<string, string> = {
  you: 'You', claude: 'Claude', me: 'Claude', mochi: 'Mochi', kiki: 'Kiki', hoot: 'Hoot', ...Object.fromEntries(VILLAGERS.map(v => [v.id, v.name])),
}
export const COLORS: Record<string, string> = {
  you: '#7ec8e3', claude: '#d97757', me: '#d97757', mochi: '#c8b8b8', kiki: '#ffb300', hoot: '#bcaaa4', event: '#8bc34a',
  ...Object.fromEntries(VILLAGERS.map(v => [v.id, hex(v.color)])),
}

/** The chores a browser may ask for without a model call, by key. */
export const CHORES: Record<string, { label: string; plan: { do: string; count?: number }[] }> = {
  fish: { label: 'Fish', plan: [{ do: 'fish' }] },
  chop: { label: 'Chop ×5', plan: [{ do: 'chop', count: 5 }] },
  water: { label: 'Water', plan: [{ do: 'water' }] },
  harvest: { label: 'Harvest', plan: [{ do: 'harvest' }] },
  sell: { label: 'Sell', plan: [{ do: 'sell' }] },
  mail: { label: 'Mail', plan: [{ do: 'mail' }] },
}

/** The map as the browser draws it: tile codes row by row, and what stands on them. */
export function mapPayload(w: World) {
  if (w.scene === 'museum') {
    const rows: string[] = []
    const cases: { x: number; y: number; section: string; color: string; shown: boolean }[] = []
    for (let y = 0; y < IH; y++) {
      let row = ''
      for (let x = 0; x < IW; x++) {
        const t = interiorTile(x, y)
        row += ROOM_CODE[t] ?? 'f'
        const c = t === 'case' ? caseAt(x, y) : null
        if (c) cases.push({ x, y, section: c.section, color: hex(c.color), shown: w.museum.includes(c.piece) })
      }
      rows.push(row)
    }
    return { scene: 'museum', w: IW, h: IH, rows, cases, halls: HALL_TITLES }
  }
  const rows: string[] = []
  const deco: Record<number, string> = {}
  const paint: Record<number, string> = {}
  const crops: Record<number, [string, number, boolean]> = {}
  const fruit: Record<number, number> = {}
  for (let y = 0; y < H; y++) {
    let row = ''
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const t = w.tiles[i]
      row += TILE_CODE[t] ?? 'g'
      if (w.deco[i]) deco[i] = w.deco[i][0]
      if (w.paint[i] && (t === 'roof' || t === 'wall' || t === 'item')) paint[i] = hex(w.paint[i][1])
      const c = w.crops[i]
      if (c) crops[i] = [c.kind ?? 'turnip', Math.min(3, Math.floor(c.stage)), c.watered]
      if (t === 'apple') fruit[i] = w.fruit[i] ?? 0
    }
    rows.push(row)
  }
  return { scene: 'village', w: W, h: H, rows, deco, paint, crops, fruit, season: season(w) }
}

type Mover = { x: number; y: number; bubble?: { text: string }; asleep?: boolean; nap?: number }

/** Everything that moves or changes by the tick: people, the clock, the weather, the HUD and the chat. */
export function statePayload(w: World, log: readonly LogLine[]) {
  const museum = w.scene === 'museum'
  const mover = (key: string, m: Mover, extra: Record<string, unknown> = {}) => ({
    k: key, x: m.x, y: m.y, say: m.bubble?.text, name: NAMES[key], color: COLORS[key], ...extra,
  })
  const movers = museum
    ? [mover('hoot', w.curator), mover('me', w.inside, { say: w.thinking ? '…' : w.player.bubble?.text })]
    : [
      mover('mochi', w.mochi, { asleep: w.mochi.asleep || w.mochi.nap > 0 }),
      ...(w.merchant ? [mover('kiki', w.merchant)] : []),
      ...VILLAGERS.map(v => mover(v.id, w.npcs[v.id], { asleep: w.npcs[v.id].asleep })),
      mover('me', w.player, w.thinking ? { say: '…' } : {}),
    ]
  const working = w.current?.do === '_work' || (!!w.echo && !w.queue.length && !w.current)
  const donated = new Set(w.museum)
  return {
    tick: w.tick,
    minutes: w.minutes,
    clock: clock(w),
    day: w.day,
    season: season(w),
    seasonDay: seasonDay(w),
    weather: w.weather,
    bells: w.bells,
    label: w.label,
    thinking: w.thinking,
    scene: w.scene,
    events: eventLabels(w),
    festival: !!active(w, 'festival') || !!active(w, 'season'),
    fireworks: !!active(w, 'season') && season(w) === 'summer',
    meteor: !!active(w, 'meteor'),
    club: w.adults && w.projects.club.done,
    factory: w.projects.factory.done ? { boom: w.boom, rubble: w.rubble > 0 } : null,
    inv: Object.entries(w.inv).filter(([, n]) => n > 0),
    movers,
    critters: museum ? [] : w.critters.map(c => ({ x: c.x, y: c.y, kind: c.kind, color: hex(c.color), flies: !!BUGS[c.kind]?.flies })),
    pickups: museum ? [] : w.pickups.map(p => ({ x: p.x, y: p.y, star: p.kind === 'star' })),
    digs: museum ? [] : w.digSpots,
    unread: w.mail.some(m => !m.read && m.day <= w.day),
    work: w.current?.do === '_work' ? (w.current as { kind: string }).kind : working && w.echo ? `echo:${w.echo.kind}` : '',
    cheer: w.cheer > 0,
    cloud: w.cloud > 0,
    rainbow: w.rainbow,
    flash: w.flash,
    reply: w.reply ? { who: NAMES[w.reply.who], color: COLORS[w.reply.who], line: w.reply.line, options: w.reply.options.map(o => o.label) } : null,
    museum: Object.entries(MUSEUM).map(([k, v]) => `${k} ${v.filter(m => donated.has(m)).length}/${v.length}`).join(' · '),
    museumOpen: w.projects.museum.done,
    chores: Object.entries(CHORES).map(([key, c]) => ({ key, label: c.label })),
    log: log.slice(-40).map(l => ({ who: NAMES[l.who] ?? l.who, color: COLORS[l.who] ?? '#cccccc', text: l.text, event: l.who === 'event' })),
  }
}
