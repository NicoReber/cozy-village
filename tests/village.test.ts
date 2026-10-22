import { expect, test } from 'claude-code/testing'

import {
  answerMore, applyDiary, applyProject, BIKES, charge, chooseReply, createWorld, diaryPrompt, echoTests, echoTool, echoTurn, enqueue, explode, frame, KIND_AT, parseActions, offerReplies, remember, postcard, restore, ROWS, snapshot, step, summary, systemPrompt, ticker, VILLAGERS,
} from '../hooks/game'
import { act, createHost, finishJob, LEASE_MS, saveOf, takeJob, tickHost, WISH_WAIT_MS } from '../hooks/host'
import { CHORES, mapPayload, statePayload } from '../hooks/web'

const PANE = {
  plugin: 'cozy-village',
  component: 'Pane',
  requestId: 'cozy-village',
  props: { title: 'Village', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 34 }, view: {} },
} as const

const run = (w: ReturnType<typeof createWorld>, max: number) => {
  for (let i = 0; i < max && (w.queue.length || w.current); i++) step(w)
}

test('parses the model plan, villagers and memories included', async () => {
  const actions = parseActions('Sure! [{"do":"walk","to":"rosa"},{"do":"npc_say","who":"bruno","text":"Hmph."},{"do":"dance"},'
    + '{"do":"remember","who":"pip","text":"Claude promised to play tag tomorrow"},{"do":"gift","to":"nobody"}]')
  expect(actions).toEqual([
    { do: 'walk', to: 'rosa' },
    { do: 'npc_say', who: 'bruno', text: 'Hmph.' },
    { do: 'remember', who: 'pip', text: 'Claude promised to play tag tomorrow' },
  ])
})

test('every villager has a home on the map and walks there', async () => {
  const w = createWorld()
  expect(VILLAGERS.length).toBe(5)
  for (const v of VILLAGERS) expect(w.places[v.home]).toBeDefined()
  for (let i = 0; i < 50; i++) step(w)
  expect(frame(w, 80).length).toBe(80 * ROWS * 3)
})

test('a liked gift raises friendship and both remember it', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  w.inv = { flower: 1 }
  enqueue(w, [{ do: 'gift', to: 'rosa', item: 'flower' }])
  run(w, 1500)
  expect(w.friendship.rosa).toBe(2)
  expect(w.memory.rosa.some(m => m.text.includes('Claude gave me a flower'))).toBe(true)
  expect(w.memory.claude.some(m => m.text.includes('gave Rosa a flower'))).toBe(true)
})

test('remember actions become facts that reach the planning prompt', async () => {
  const w = createWorld()
  enqueue(w, [{ do: 'remember', who: 'claude', text: "The player's favorite fish is the koi" }])
  run(w, 10)
  expect(summary(w, 'hi')).toContain("The player's favorite fish is the koi")
})

test('a finished day turns into diaries and facts, and memory survives a save', async () => {
  const w = createWorld()
  remember(w, 'claude', 'I caught a koi at the pond.')
  remember(w, 'tom', 'Claude showed me a koi.')
  expect(diaryPrompt(w, 1)).toContain('## tom')
  applyDiary(w, 1, '{"claude":{"diary":"Best fishing day ever.","facts":["Tom is jealous of my koi"]},"tom":{"diary":"That koi!","facts":[]}}')
  expect(w.memory.claude.some(m => m.kind === 'diary' && m.text === 'Best fishing day ever.')).toBe(true)
  expect(w.memory.claude.some(m => m.kind === 'fact' && m.text === 'Tom is jealous of my koi')).toBe(true)

  const again = createWorld()
  restore(again, JSON.parse(JSON.stringify(snapshot(w))))
  expect(again.memory.tom.some(m => m.text === 'That koi!')).toBe(true)
})

test('the pane draws, a wish reaches the agent with its memory', async ($, on) => {
  const asked: string[] = []
  on('model.complete', async (_, e) => {
    asked.push(e.prompt)
    return {
      value: {
        isAnswered: true as const,
        text: '[{"do":"say","text":"On my way!"},{"do":"walk","to":"mabel"}]',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'wish' })).toBeDefined()
    await ui.press({ key: 'tab-memories' })
    expect(await ui.find({ key: 'panel-memories' })).toBeDefined()
    await ui.press({ key: 'tab-village' })
    expect(await ui.find({ key: 'panel-village' })).toBeDefined()
    await ui.press({ key: 'tab-chat' })
    await ui.input({ key: 'wish', text: 'visit Mabel' })
    await ui.unmount()
  }
  expect(asked.length).toBe(2)
  expect(asked[1]).toContain('The player asked me: "visit Mabel"')
  expect(asked[1]).toContain('### Mabel')
})

test('every day brings at least one event that starts in daylight', async () => {
  for (let i = 0; i < 50; i++) {
    const w = createWorld()
    expect(w.events.length).toBeGreaterThanOrEqual(1)
    expect(w.events.some(e => e.start < 18 * 60)).toBe(true)
  }
})

test('a lost item can be found and returned for a big friendship boost', async () => {
  const w = createWorld()
  w.events = [{ kind: 'lost', start: 0, end: 23 * 60, who: 'mabel', item: "Mabel's glasses" }]
  w.requests = []
  step(w)
  expect(w.pickups.length).toBe(1)
  expect(w.announce[0]).toContain('Mabel lost their glasses')
  enqueue(w, [{ do: 'search' }])
  run(w, 2000)
  expect(w.inv["Mabel's glasses"]).toBe(1)
  enqueue(w, [{ do: 'gift', to: 'mabel', item: "Mabel's glasses" }])
  run(w, 2000)
  expect(w.friendship.mabel).toBe(3)
  expect(w.memory.mabel.some(m => m.kind === 'fact' && m.text.includes('found my lost glasses'))).toBe(true)
})

test('the merchant comes and goes, and the planner hears about it', async () => {
  const w = createWorld()
  w.minutes = 9 * 60
  w.events = [{ kind: 'merchant', start: 9 * 60, end: 9 * 60 + 30 }]
  step(w)
  expect(w.merchant).toBeDefined()
  expect(summary(w, 'hi')).toContain('Kiki the traveling merchant')
  for (let i = 0; i < 80; i++) step(w)
  expect(w.merchant).toBeUndefined()
})

test('seeds from the shop grow into carrots that Mabel can bake into cake', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  w.bells = 1000
  w.crops = w.crops.map(() => null)
  enqueue(w, [{ do: 'shop', item: 'carrot seeds', count: 2 }, { do: 'plant', crop: 'carrot' }, { do: 'water' }])
  run(w, 3000)
  expect(w.bells).toBe(920)
  expect(w.crops.filter(c => c?.kind === 'carrot').length).toBe(2)
  for (const c of w.crops) if (c) { c.stage = 3 }
  enqueue(w, [{ do: 'harvest' }])
  run(w, 3000)
  expect(w.inv.carrot).toBe(2)
  w.minutes = 10 * 60
  w.inv.apple = 1
  enqueue(w, [{ do: 'cook', recipe: 'carrot cake', count: 1 }])
  run(w, 3000)
  expect(w.inv['carrot cake']).toBe(1)
  expect(w.inv.carrot).toBe(0)
})

test('funding the museum builds it on the map, and donations fill its collection', async () => {
  const w = createWorld()
  w.bells = 5000
  w.inv = { wood: 10, koi: 1, carp: 2 }
  expect(parseActions('[{"do":"fund","project":"museum"},{"do":"donate"}]')).toEqual([{ do: 'fund', project: 'museum' }, { do: 'donate' }])
  enqueue(w, [{ do: 'fund', project: 'museum' }, { do: 'donate' }])
  run(w, 4000)
  expect(w.projects.museum.done).toBe(true)
  expect(w.bells).toBe(2000)
  expect(w.museum.sort()).toEqual(['carp', 'koi'])
  expect(w.inv.carp).toBe(1)
  expect(summary(w, 'hi')).toContain('Museum: 2/28 donated')
})

test('a villager request pays Bells when the gift arrives', async () => {
  const w = createWorld()
  w.events = []
  w.requests = [{ who: 'bruno', item: 'wood', amount: 2, given: 0, reward: 180 }]
  w.inv = { wood: 3 }
  const before = w.bells
  enqueue(w, [{ do: 'gift', to: 'bruno', item: 'wood', count: 2 }])
  run(w, 3000)
  expect(w.requests[0].done).toBe(true)
  expect(w.bells).toBe(before + 180)
  expect(w.inv.wood).toBe(1)
})

test('the seasons turn every week and winter stops the crops', async () => {
  const w = createWorld()
  expect(summary(w, 'hi')).toContain('Spring, day 1 of 7')
  w.requests = []
  w.day = 21
  w.minutes = 24 * 60 - 0.25
  w.crops = w.crops.map(c => (c ? { ...c, stage: 1, watered: true } : c))
  step(w)
  expect(w.day).toBe(22)
  expect(summary(w, 'hi')).toContain('Winter, day 1 of 7')
  expect(w.crops.filter(Boolean).every(c => c!.stage === 1)).toBe(true)
  expect(w.announce.some(a => a.includes('Winter has come'))).toBe(true)
  expect(frame(w, 60).length).toBe(60 * ROWS * 3)
})

test('the fourth day of a season brings its festival', async () => {
  const w = createWorld()
  w.day = 3
  w.minutes = 24 * 60 - 0.25
  step(w)
  expect(w.events.some(e => e.kind === 'season')).toBe(true)
  expect(summary(w, 'hi')).toContain('Blossom picnic')
})

test('a shovel digs up the cracked spots', async () => {
  const w = createWorld()
  w.requests = []
  w.inv = { shovel: 1 }
  const spots = w.digSpots.length
  expect(spots).toBe(3)
  enqueue(w, [{ do: 'dig' }])
  run(w, 3000)
  expect(w.digSpots.length).toBe(spots - 1)
  expect(w.log.some(l => /fossil|amethyst|RUBY|coin|Bells|dirt/.test(l.text))).toBe(true)
})

test('bugs appear by season and the net catches them', async () => {
  const w = createWorld()
  w.requests = []
  w.inv = { 'bug net': 1 }
  for (let i = 0; i < 400 && w.critters.length === 0; i++) step(w)
  expect(w.critters.length).toBeGreaterThan(0)
  const kind = w.critters[0].kind
  for (let attempt = 0; attempt < 20 && !(w.inv[kind] ?? 0); attempt++) {
    if (!w.critters.some(c => c.kind === kind)) break
    enqueue(w, [{ do: 'catch', bug: kind }])
    run(w, 3000)
  }
  expect((w.inv[kind] ?? 0) > 0 || !w.critters.some(c => c.kind === kind)).toBe(true)
})

test('friendship milestones bring letters with gifts to the mailbox', async () => {
  const w = createWorld()
  w.requests = []
  w.friendship.pip = 9
  w.player.x = w.places.plaza.x
  w.player.y = w.places.plaza.y
  w.minutes = 24 * 60 - 0.25
  step(w)
  const letters = w.mail.filter(m => m.from === 'pip')
  expect(letters.length).toBe(1)
  expect(letters[0].item).toBe('drawing by Pip')
  expect(summary(w, 'hi')).toContain('unread letter')
  enqueue(w, [{ do: 'mail' }])
  run(w, 3000)
  expect(w.inv['drawing by Pip']).toBe(1)
  expect(w.mail.every(m => m.read)).toBe(true)
})

test('a museum tour walks past every donated piece and Hoot explains it', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  w.projects.museum = { bells: 3000, items: { wood: 10 }, done: true }
  applyProject(w, 'museum')
  w.museum = ['koi', 'butterfly', 'ammonite']
  enqueue(w, [{ do: 'tour' }])
  for (let i = 0; i < 4000 && w.scene === 'village'; i++) step(w)
  expect(w.scene).toBe('museum')
  expect(frame(w, 80).length).toBe(80 * ROWS * 3)
  run(w, 6000)
  const said = w.log.filter(l => l.who === 'hoot').map(l => l.text).join(' ')
  expect(said).toContain('koi')
  expect(said).toContain('Butterflies')
  expect(said).toContain('ammonite')
  expect(said).toContain('still missing')

  enqueue(w, [{ do: 'fish' }])
  run(w, 6000)
  expect(w.scene).toBe('village')
})

test('the bomb factory gets built, blows up, and Bruno patches it up', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  w.bells = 2000
  w.inv = { wood: 8 }
  explode(w)
  expect(w.boom).toBe(0)
  enqueue(w, [{ do: 'fund', project: 'factory' }])
  run(w, 3000)
  expect(w.projects.factory.done).toBe(true)
  expect(systemPrompt(w)).toContain('factory')
  w.player.x = 68
  w.player.y = 16
  w.npcs.pip.x = 66
  w.npcs.pip.y = 16
  w.npcs.pip.asleep = false
  const pipMood = w.mood.pip ?? 0
  explode(w)
  expect(w.boom).toBeGreaterThan(0)
  expect(w.flash).toBeGreaterThan(0)
  expect(w.rubble).toBeGreaterThan(0)
  expect(w.announce.some(a => /bomb factory/i.test(a))).toBe(true)
  expect(w.memory.claude.some(m => m.text.includes('bomb factory blew up'))).toBe(true)
  expect(w.mood.pip).toBe(Math.min(2, pipMood + 1))
  const rubble = w.rubble
  explode(w)
  expect(w.rubble).toBe(rubble)
  for (let i = 0; i < 10; i++) { step(w); expect(frame(w, 80).length).toBe(80 * ROWS * 3) }
  for (let i = 0; i < rubble && w.rubble > 0; i++) step(w)
  expect(w.rubble).toBe(0)
  expect(w.log.some(l => l.text.includes('Bruno rebuilt the bomb factory'))).toBe(true)
})

test('the Velvet Club gets built, opens at night, and Pip never goes there', async () => {
  const w = createWorld()
  w.adults = true
  w.events = []
  w.requests = []
  w.bells = 3000
  w.inv = { wood: 6 }
  enqueue(w, [{ do: 'fund', project: 'club' }])
  run(w, 3000)
  expect(w.projects.club.done).toBe(true)
  w.minutes = 12 * 60
  enqueue(w, parseActions('[{"do":"club"}]'))
  run(w, 100)
  expect(w.log.some(l => l.text.includes('opens at 21:00'))).toBe(true)
  w.minutes = 21 * 60
  const before = w.bells
  enqueue(w, [{ do: 'club' }])
  run(w, 3000)
  expect(w.bells).toBe(before - 150)
  expect(w.memory.claude.some(m => m.text.includes('Velvet Club'))).toBe(true)
  expect(systemPrompt(w)).toContain('never involve Pip')
  for (let day = 1; day < 30; day++) {
    w.day = day
    w.minutes = 21.5 * 60
    for (let i = 0; i < 5; i++) step(w)
    expect(w.memory.pip.some(m => m.text.includes('Velvet'))).toBe(false)
  }
})

test('the diary call brings gossip, letters and the gazette; villagers say them', async () => {
  const w = createWorld()
  w.events = []
  w.friendship.rosa = 5
  remember(w, 'claude', 'I fished with Rosa.')
  remember(w, 'rosa', 'Claude and I went fishing.')
  expect(diaryPrompt(w, 1)).toContain('"gazette"')
  applyDiary(w, 1, JSON.stringify({
    claude: { diary: 'Fishing!', facts: [] },
    rosa: { diary: 'Lovely day.', facts: [] },
    chats: [{ a: 'rosa', b: 'tom', lines: ['Claude caught a huge koi!', 'Bigger than mine? Impossible.'] },
      { a: 'pip', b: 'tom', lines: ['What is the Velvet Club?', 'Nothing for you.'] }],
    gazette: ['LOCAL HERO CATCHES FISH', 'ROSA: "IT WAS THIS BIG"'],
    letters: [{ from: 'rosa', text: 'Thanks for the fishing trip! - Rosa' }, { from: 'bruno', text: 'Hmph. - Bruno' }],
  }))
  expect(w.chatPool.length).toBe(1)
  expect(w.gazette?.headlines.length).toBe(2)
  expect(w.mail.filter(m => m.from === 'rosa').length).toBe(1)
  expect(w.mail.some(m => m.from === 'bruno')).toBe(false)
})

test('a forgotten birthday makes a villager sulk until a gift cheers them up', async () => {
  const w = createWorld()
  w.requests = []
  w.events = [{ kind: 'birthday', start: 0, end: 8 * 60 + 2, who: 'bruno' }]
  for (let i = 0; i < 10; i++) step(w)
  expect(w.mood.bruno).toBe(-2)
  expect(summary(w, 'hi')).toContain('sulking')
  w.inv = { wood: 1 }
  w.events = []
  enqueue(w, [{ do: 'gift', to: 'bruno', item: 'wood' }])
  run(w, 4000)
  expect(w.mood.bruno).toBe(0)
})

test('chopping takes a count, fish get sizes and records, and selling keeps what is still needed', async () => {
  const w = createWorld()
  w.events = []
  w.requests = [{ who: 'mabel', item: 'turnip', amount: 2, given: 0, reward: 220 }]
  enqueue(w, parseActions('[{"do":"chop","count":4},{"do":"fish","count":2}]'))
  run(w, 6000)
  expect(w.inv.wood).toBe(4)
  expect(Object.keys(w.records).length + (w.inv['old boot'] ?? 0)).toBeGreaterThan(0)
  w.inv = { turnip: 3, koi: 2 }
  w.projects.museum.done = true
  enqueue(w, [{ do: 'sell' }])
  run(w, 4000)
  expect(w.inv.turnip).toBe(2)
  expect(w.inv.koi).toBe(1)
})

test('the village echoes the real session and makes postcards', async () => {
  const w = createWorld()
  w.events = []
  echoTool(w, 'Edit')
  for (let i = 0; i < 31; i++) step(w)
  expect(w.label).toContain('Edit')
  echoTests(w, true)
  expect(w.rainbow).toBeGreaterThan(0)
  echoTurn(w, 42, 'answer')
  expect(w.cheer).toBeGreaterThan(0)
  expect(postcard(w, 60)).toContain('Greetings from the village')
  expect(ticker(w)).toContain('Village:')
})

test('replying to a villager changes friendship and mood, once a day', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  offerReplies(w, 'rosa', 'The tulips smell lovely today.')
  expect(w.reply?.options.map(o => o.kind)).toEqual(['warm', 'more', 'brush'])
  chooseReply(w, 0)
  expect(w.friendship.rosa).toBe(1)
  expect(w.mood.rosa).toBe(1)
  offerReplies(w, 'rosa', 'Hi again!')
  chooseReply(w, 0)
  expect(w.friendship.rosa).toBe(1)
  offerReplies(w, 'tom', 'Wanna hear a fish story?')
  chooseReply(w, 1)
  expect(w.askMore?.who).toBe('tom')
  answerMore(w, 'tom', 'Once I caught a koi THIS big!')
  expect(w.log.some(l => l.who === 'tom' && l.text.includes('koi'))).toBe(true)
  w.requests = [{ who: 'pip', item: 'apple', amount: 2, given: 0, reward: 150 }]
  w.inv = { apple: 2 }
  offerReplies(w, 'pip', 'Could you bring me 2 apple?')
  expect(w.reply?.options[1].kind).toBe('gift')
  w.mood.bruno = -2
  offerReplies(w, 'bruno', 'Hmph.')
  expect(w.reply?.options[0].kind).toBe('sorry')
  for (let i = 0; i < 80; i++) step(w)
  expect(w.reply?.who).not.toBe('bruno')
})

test('without the club setting there is no club anywhere', async () => {
  const w = createWorld()
  w.events = []
  w.bells = 3000
  w.inv = { wood: 6 }
  expect(summary(w, 'hi')).not.toContain('Velvet')
  expect(systemPrompt(w)).not.toContain('Velvet')
  enqueue(w, [{ do: 'fund', project: 'club' }, { do: 'club' }])
  run(w, 3000)
  expect(w.projects.club.done).toBe(false)
  expect(w.bells).toBe(3000)
})

test('a speech bubble stays where it first appeared, even when space frees up', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  w.player.x = 50
  w.player.y = 12
  const rosa = w.npcs.rosa
  // Rosa stands up and to the right, so her bubble sits where Claude's would naturally go
  rosa.x = 64
  rosa.y = 11
  rosa.hold = 999
  const find = (label: string) => {
    const cells = frame(w, 80)
    const want = ` ${label} `
    for (let r = 0; r < ROWS; r++) {
      let line = ''
      for (let c = 0; c < 80; c++) line += String.fromCodePoint(cells[(r * 80 + c) * 3] || 32)
      const at = line.indexOf(want)
      if (at >= 0) return { r, c: at }
    }
    return null
  }
  rosa.bubble = { text: 'I am up here talking!', ticks: 500 }
  const rosaFirst = find('Rosa')
  w.player.bubble = { text: 'And I answer down here.', ticks: 500 }
  const first = find('Claude')
  expect(first).not.toBe(null)
  expect(find('Rosa')).toEqual(rosaFirst)
  rosa.bubble = undefined
  expect(find('Claude')).toEqual(first)
  w.player.bubble = { text: 'A new line may pick a new spot.', ticks: 500 }
  expect(find('Claude')).not.toBe(null)
})

test('the desktop pane points to the browser view and keeps the chat and the wish field', async $ => {
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /lives in your browser/ })).toBeDefined()
    expect(await ui.find({ key: 'panel-chat' })).toBeDefined()
    await ui.unmount()
  }
})

test('the browser view gets the whole map and everyone who moves', async () => {
  const w = createWorld()
  const map = mapPayload(w)
  expect(map.scene).toBe('village')
  expect(map.rows.length).toBe(24)
  expect(map.rows.every(r => r.length === 96)).toBe(true)
  expect(map.rows[2]).toContain('r')
  const state = statePayload(w, [{ who: 'rosa', text: 'Hello!' }])
  expect(state.movers.map(m => m.k)).toContain('me')
  expect(state.movers.length).toBe(VILLAGERS.length + 2)
  expect(state.log[0]).toEqual({ who: 'Rosa', color: '#f48fb1', text: 'Hello!', event: false })
  expect(JSON.stringify({ state, map }).length).toBeLessThan(200000)
  w.scene = 'museum'
  w.museum = ['koi']
  const room = mapPayload(w) as { scene: string; cases: { shown: boolean }[] }
  expect(room.scene).toBe('museum')
  expect(room.cases.filter(c => c.shown).length).toBe(1)
})

test('chores from the browser are the same plans as the Quick bar', async () => {
  for (const c of Object.values(CHORES)) expect(parseActions(JSON.stringify(c.plan)).length).toBe(c.plan.length)
})

/** A village with the AI data center (and optionally the bomb factory) built, and no events. */
const dataCenterVillage = (withFactory: boolean) => {
  const w = createWorld()
  w.events = []
  w.requests = []
  for (const id of withFactory ? ['datacenter', 'factory'] as const : ['datacenter'] as const) {
    w.projects[id].done = true
    applyProject(w, id)
  }
  return w
}

test('the AI data center gets funded and built, with three bikes beside it', async () => {
  const w = createWorld()
  w.events = []
  w.requests = []
  w.bells = 2200
  w.inv = { wood: 8 }
  expect(systemPrompt(w)).toContain('datacenter')
  enqueue(w, [{ do: 'fund', project: 'datacenter' }])
  run(w, 3000)
  expect(w.projects.datacenter.done).toBe(true)
  expect(w.places.datacenter).toBeDefined()
  for (const b of BIKES) {
    expect(w.tiles[b.y * 96 + b.x]).toBe('path')
    expect(w.deco[b.y * 96 + b.x - 1]?.[0]).toBe('Ø')
    expect(w.deco[b.y * 96 + b.x + 1]?.[0]).toBe('ø')
  }
  expect(ticker(w)).toContain('⚡')
  expect(statePayload(w, []).datacenter).toEqual({ battery: 80, mood: 'kind' })
})

test('a kind data center computes Bells and apples every three hours', async () => {
  const w = dataCenterVillage(false)
  w.dc.battery = 80
  w.minutes = 179.5
  const bells = w.bells
  const apples = w.inv.apple ?? 0
  step(w)
  expect(w.bells).toBeGreaterThan(bells)
  expect(w.inv.apple).toBe(apples + 2)
  expect(w.log.some(l => l.text.includes('AI data center computed'))).toBe(true)
})

test('a data center that runs flat turns evil and blows up the bomb factory, until it is pedaled back', async () => {
  const w = dataCenterVillage(true)
  w.dc.battery = 0
  w.minutes = 2 * 60
  step(w)
  expect(w.dc.evil).toBe(true)
  expect(w.rubble).toBeGreaterThan(0)
  expect(w.announce.some(a => /turned EVIL/.test(a))).toBe(true)
  expect(w.log.some(l => l.text.includes('evil AI data center hacked the bomb factory'))).toBe(true)
  expect(frame(w, 80).length).toBe(80 * ROWS * 3)
  // no Bells while it is evil
  const bells = w.bells
  w.minutes = 179.5
  step(w)
  expect(w.bells).toBe(bells)
  // pedaled back to half, it reboots kind
  charge(w, KIND_AT)
  step(w)
  expect(w.dc.evil).toBe(false)
  expect(w.announce.some(a => /kind again/.test(a))).toBe(true)
})

test('villagers ride the bikes when the battery runs low, and Claude can pedal too', async () => {
  const w = dataCenterVillage(false)
  w.dc.battery = 40
  w.minutes = 10 * 60
  for (let i = 0; i < 300; i++) step(w)
  const riding = VILLAGERS.filter(v => BIKES.some(b => b.x === w.npcs[v.id].x && b.y === w.npcs[v.id].y))
  expect(riding.length).toBeGreaterThanOrEqual(2)
  expect(w.dc.battery).toBeGreaterThan(40)

  expect(parseActions('[{"do":"pedal"}]')).toEqual([{ do: 'pedal' }])
  const solo = dataCenterVillage(false)
  solo.dc.battery = 30
  solo.minutes = 21 * 60
  enqueue(solo, [{ do: 'pedal' }])
  run(solo, 2000)
  expect(solo.dc.battery).toBeGreaterThan(30)
  expect(solo.log.some(l => l.text.startsWith('Pedaled the AI data center'))).toBe(true)
})

test('the data center battery and mood survive a save', async () => {
  const w = dataCenterVillage(false)
  w.dc.battery = 12
  w.dc.evil = true
  const again = createWorld()
  restore(again, JSON.parse(JSON.stringify(snapshot(w))))
  expect(again.projects.datacenter.done).toBe(true)
  expect(again.dc.battery).toBe(12)
  expect(again.dc.evil).toBe(true)
  expect(again.deco[BIKES[0].y * 96 + BIKES[0].x - 1]?.[0]).toBe('Ø')
})

test('locked bikes keep everyone off them, so the data center runs flat and turns evil', async () => {
  const w = dataCenterVillage(true)
  w.dc.battery = 3
  w.minutes = 10 * 60
  expect(parseActions('[{"do":"lock"},{"do":"unlock"}]')).toEqual([{ do: 'lock' }, { do: 'unlock' }])
  enqueue(w, [{ do: 'lock' }])
  run(w, 2000)
  expect(w.dc.locked).toBe(true)
  for (let i = 0; i < 300 && !w.dc.evil; i++) step(w)
  expect(VILLAGERS.some(v => BIKES.some(b => b.x === w.npcs[v.id].x && b.y === w.npcs[v.id].y))).toBe(false)
  expect(w.dc.evil).toBe(true)
  enqueue(w, [{ do: 'pedal' }])
  run(w, 2000)
  expect(w.dc.battery).toBe(0)
  enqueue(w, [{ do: 'unlock' }])
  run(w, 2000)
  expect(w.dc.locked).toBe(false)
})

test('the shared village hands a wish to a session and acts on its answer', async () => {
  const h = createHost(undefined)
  h.world.events = []
  act(h, { kind: 'wish', text: 'go fishing' }, 0)
  expect(h.world.thinking).toBe(true)
  act(h, { kind: 'wish', text: 'and chop wood' }, 0)
  expect(h.jobs.length).toBe(1)
  const job = takeJob(h, 0)
  expect(job?.kind).toBe('wish')
  expect(job?.prompt).toContain('go fishing')
  expect(takeJob(h, 1000)).toBe(null)
  expect(takeJob(h, LEASE_MS + 1)?.id).toBe(job?.id)
  expect(finishJob(h, job!.id, '[{"do":"fish"}]')).toBe(true)
  expect(finishJob(h, job!.id, '[{"do":"fish"}]')).toBe(false)
  expect(h.world.thinking).toBe(false)
  expect(h.world.queue.length + (h.world.current ? 1 : 0)).toBeGreaterThan(0)
  tickHost(h, 0)
  expect(h.chat.some(l => l.who === 'you' && l.text === 'go fishing')).toBe(true)
})

test('a wish no session takes is dropped, a failed one gets a foggy answer', async () => {
  const h = createHost(undefined)
  act(h, { kind: 'wish', text: 'plant pumpkins' }, 0)
  tickHost(h, WISH_WAIT_MS + 1)
  expect(h.jobs.length).toBe(0)
  expect(h.world.thinking).toBe(false)
  act(h, { kind: 'wish', text: 'plant pumpkins' }, 0)
  const job = takeJob(h, 0)!
  finishJob(h, job.id, null, 'timed out')
  expect(h.world.player.bubble?.text).toContain('timed out')
})

test('the shared village queues one diary job per finished day and keeps its save', async () => {
  const h = createHost(undefined)
  h.world.memory.tom = [{ day: 1, text: 'Caught a big bass.', kind: 'event' }]
  h.world.diaryDue = [1]
  tickHost(h, 0)
  tickHost(h, 0)
  expect(h.jobs.filter(j => j.kind === 'diary').length).toBe(1)
  const job = takeJob(h, 0)!
  finishJob(h, job.id, null)
  expect(h.world.diaryDue).toEqual([])
  act(h, { kind: 'chore', key: 'toString' }, 0)
  act(h, { kind: 'chore', key: 'fish' }, 0)
  expect(h.world.queue.length + (h.world.current ? 1 : 0)).toBe(1)
  h.world.bells = 1234
  const again = createHost(JSON.parse(JSON.stringify(saveOf(h))))
  expect(again.world.bells).toBe(1234)
})
