// What the browser view is sent: the map when it changes, and the moving parts every tick.
// Pure logic, no `$`: register.tsx posts these to the local server that web/server.mjs runs.

import { BUGS, MUSEUM, MUSEUM_REWARD, PROJECTS } from './catalog'
import { active, clock, dcMood, eventLabels, H, projectIds, season, seasonDay, VILLAGERS, W } from './game'
import type { Info, LogLine } from '../types'
import type { World } from './game'
import { caseAt, HALL_TITLES, IH, interiorTile, IW } from './museum'
import { atSeat, DESKS, deskStatus, LOOKS, OFFICE_TITLE, officeTile, OH, OW } from './office'

const TILE_CODE: Record<string, string> = {
  grass: 'g', tuft: 't', path: 'p', plaza: 'z', bridge: 'b', water: 'w', fountain: 'f', tree: 'T', apple: 'a',
  roof: 'r', wall: 'l', door: 'd', fence: 'n', soil: 's', flower: 'o', item: 'i',
}
const ROOM_CODE: Record<string, string> = { wall: 'w', floor: 'f', carpet: 'c', case: 's', door: 'd', plant: 'p', void: ' ' }
const OFFICE_CODE: Record<string, string> = { wall: 'w', window: 'v', floor: 'f', carpet: 'c', desk: 'k', door: 'd', plant: 'p', coffee: 'o', board: 'b', void: ' ' }
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
  if (w.scene === 'office') {
    const rows: string[] = []
    for (let y = 0; y < OH; y++) {
      let row = ''
      for (let x = 0; x < OW; x++) row += OFFICE_CODE[officeTile(x, y)] ?? 'f'
      rows.push(row)
    }
    return { scene: 'office', w: OW, h: OH, rows, desks: DESKS, title: OFFICE_TITLE }
  }
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
  const office = w.scene === 'office'
  const mover = (key: string, m: Mover, extra: Record<string, unknown> = {}) => ({
    k: key, x: m.x, y: m.y, say: m.bubble?.text, name: NAMES[key], color: COLORS[key], ...extra,
  })
  const inside = mover('me', w.inside, { say: w.thinking ? '…' : w.player.bubble?.text })
  const movers = museum
    ? [mover('hoot', w.curator), inside]
    : office
      ? [...w.office.staff.map(a => {
        const look = LOOKS[a.look]
        return mover(`app:${a.id}`, a, { name: a.name, color: hex(look.shirt), look: { hair: hex(look.hair), shirt: hex(look.shirt), pants: hex(look.pants) }, working: a.status === 'working', sit: atSeat(a) && a.desk >= 0 })
      }), inside]
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
    datacenter: w.projects.datacenter.done ? { battery: Math.round(w.dc.battery), mood: dcMood(w) } : null,
    inv: Object.entries(w.inv).filter(([, n]) => n > 0),
    movers,
    desks: office ? deskStatus(w.office) : undefined,
    staff: w.office.staff.filter(a => !a.leaving).length,
    critters: museum || office ? [] : w.critters.map(c => ({ x: c.x, y: c.y, kind: c.kind, color: hex(c.color), flies: !!BUGS[c.kind]?.flies })),
    pickups: museum || office ? [] : w.pickups.map(p => ({ x: p.x, y: p.y, star: p.kind === 'star' })),
    digs: museum || office ? [] : w.digSpots,
    unread: w.mail.some(m => !m.read && m.day <= w.day),
    work: w.current?.do === '_work' ? (w.current as { kind: string }).kind : working && w.echo ? `echo:${w.echo.kind}` : '',
    cheer: w.cheer > 0,
    cloud: w.cloud > 0,
    rainbow: w.rainbow,
    flash: w.flash,
    museum: Object.entries(MUSEUM).map(([k, v]) => `${k} ${v.filter(m => donated.has(m)).length}/${v.length}`).join(' · '),
    museumOpen: w.projects.museum.done,
    chores: Object.entries(CHORES).map(([key, c]) => ({ key, label: c.label })),
    log: log.slice(-40).map(l => ({ who: NAMES[l.who] ?? l.who, color: COLORS[l.who] ?? '#cccccc', text: l.text, event: l.who === 'event' })),
  }
}

/** What the pane's Village and Memories tabs show, for the browser's side panel: sent when it changes, not every tick. */
export function infoPayload(w: World): Info {
  const projects = projectIds(w).map(id => {
    const def = PROJECTS[id]
    const st = w.projects[id]
    const items = Object.entries(def.items).map(([name, need]) => ({ name, have: Math.min(need, st.items[name] ?? 0), need }))
    const have = st.bells + Object.values(st.items).reduce((a, b) => a + b, 0) * 100
    const total = def.bells + Object.values(def.items).reduce((a, b) => a + b, 0) * 100
    const about = id === 'datacenter' && st.done ? `${def.about} - right now it is ${dcMood(w)}` : def.about
    return { name: def.name, about, done: !!st.done, bells: st.bells, need: def.bells, items, pct: st.done ? 1 : Math.min(1, have / Math.max(1, total)) }
  })
  const donated = new Set(w.museum)
  const sections = Object.entries(MUSEUM).map(([name, pieces]) => ({
    name, have: pieces.filter(p => donated.has(p)).length, total: pieces.length, pieces: pieces.map(p => ({ name: p, got: donated.has(p) })),
  }))
  const people = ['claude', ...VILLAGERS.map(v => v.id)].map(id => {
    const list = w.memory[id] ?? []
    const diary = list.filter(m => m.kind === 'diary').slice(-1)[0]
    const last = list.filter(m => m.kind === 'event').slice(-1)[0]
    return {
      name: NAMES[id], color: COLORS[id], hearts: id === 'claude' ? null : w.friendship[id] ?? 0,
      diary: diary ? `Day ${diary.day}: ${diary.text}` : last ? last.text : 'no memories yet',
      facts: list.filter(m => m.kind === 'fact').slice(-3).map(m => m.text),
    }
  })
  const office = w.office.staff.filter(a => !a.leaving).map(a => ({
    name: a.name, color: hex(LOOKS[a.look].shirt), repo: a.repo, branch: a.branch, status: a.status, tool: a.tool,
  }))
  return {
    projects,
    office,
    museum: { open: w.projects.museum.done, reward: MUSEUM_REWARD, sections },
    requests: w.requests.map(r => ({ who: NAMES[r.who], color: COLORS[r.who], item: r.item, left: r.amount - r.given, reward: r.reward, done: !!r.done })),
    people,
  }
}
