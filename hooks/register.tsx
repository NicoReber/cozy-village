import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LogLine, Tab } from '../types'
import { MUSEUM, PROJECTS } from './catalog'
import type { ProjectId } from './catalog'
import {
  answerMore, applyDiary, chooseReply, createWorld, DIARY_SYSTEM, diaryPrompt, echoTests, echoTool, echoTurn, encode, enqueue, frame, frameText, heardWish, MAX_VIEW,
  memoryText, MORE_SYSTEM, moreContext, parseActions, postcard, projectIds, restore, ROWS, sayPlayer, snapshot, step, summary, systemPrompt, ticker, VILLAGERS,
} from './game'

const PANE = 'cozy-village'
/** The model behind the villagers; the `model` setting replaces it when the module loads. */
let MODEL = 'haiku'
const STORE_KEY = 'world'
const log = atom({ plugin: 'cozy-village', key: 'log' } as const, [] as LogLine[])
const thinking = atom({ plugin: 'cozy-village', key: 'thinking' } as const, false)
const tab = atom({ plugin: 'cozy-village', key: 'tab' } as const, 'chat' as Tab)
/** Which reply offer is showing, `who@until`, or empty: drawing reads it so the row appears and goes away. */
const replyKey = atom({ plugin: 'cozy-village', key: 'reply' } as const, '')

const ACCENT = '#e6c34a'
const INK = '#3a2e2a'
const COLORS: Record<string, string> = {
  you: '#7ec8e3', claude: ACCENT, mochi: '#c8b8b8', kiki: '#ffd54f', hoot: '#bcaaa4', event: '#8bc34a',
  ...Object.fromEntries(VILLAGERS.map(v => [v.id, `#${v.color.toString(16).padStart(6, '0')}`])),
}
const NAMES: Record<string, string> = {
  you: 'You', claude: 'Claude', mochi: 'Mochi', kiki: 'Kiki', hoot: 'Hoot', ...Object.fromEntries(VILLAGERS.map(v => [v.id, v.name])),
}
const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'memories', label: 'Memories' },
  { id: 'village', label: 'Village' },
]
const NAME_WIDTH = 7
const bar = (have: number, total: number, width = 12) => {
  const full = Math.round((Math.min(have, total) / Math.max(1, total)) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

let world = createWorld()
let viewCols = MAX_VIEW
let surface = 'terminal'
let savedHour = -1
let isReflecting = false
let lastTicker = ''
let isAnswering = false
const TESTS = /\b(test|tests|vitest|jest|pytest|dotnet\s+test|cargo\s+test|npm\s+run\s+build|dotnet\s+build|tsc)\b/i

function open($: EngineInterface, focus?: true) {
  return $.ui.open({ id: PANE, title: 'Village', rows: ROWS + 12, columns: MAX_VIEW + 2, focus })
}

async function ask($: EngineInterface, wish: string) {
  const text = wish.trim()
  if (!text || world.thinking) return
  world.log.push({ who: 'you', text })
  heardWish(world, text)
  world.thinking = true
  await update($, thinking, () => true)
  const reply = await $.model.complete({ model: MODEL, system: systemPrompt(world), prompt: summary(world, text), maxTokens: 1200, timeoutMs: 60000 })
  world.thinking = false
  await update($, thinking, () => false)
  if (!reply.isAnswered) {
    sayPlayer(world, `Sorry, my head feels foggy... (${reply.reason})`)
    return
  }
  const actions = parseActions(reply.text)
  if (actions.length === 0) sayPlayer(world, "Hmm, I'm not sure how to do that.")
  else enqueue(world, actions)
}

/** Writes the diaries of a finished day, one model call for every character. */
async function reflect($: EngineInterface) {
  const day = world.diaryDue[0]
  if (day === undefined || isReflecting) return
  isReflecting = true
  const prompt = diaryPrompt(world, day)
  const reply = prompt ? await $.model.complete({ model: MODEL, system: DIARY_SYSTEM, prompt, maxTokens: 1200, timeoutMs: 60000 }) : null
  applyDiary(world, day, reply?.isAnswered ? reply.text : null)
  world.diaryDue.shift()
  isReflecting = false
  if (prompt) world.log.push({ who: 'event', text: `Everyone wrote in their diary about day ${day}.` })
  await $.store.set(STORE_KEY, snapshot(world))
}

/** A villager's in-character answer to "tell me more". */
async function tellMore($: EngineInterface) {
  const ask = world.askMore
  if (!ask) return
  isAnswering = true
  const reply = await $.model.complete({ model: MODEL, system: MORE_SYSTEM, prompt: moreContext(world, ask.who, ask.line), maxTokens: 120, timeoutMs: 30000 })
  answerMore(world, ask.who, reply.isAnswered ? reply.text : null)
  isAnswering = false
}

function memoryReport(): string {
  const blocks = [`Claude\n${memoryText(world, 'claude', 10)}`]
  for (const v of VILLAGERS) blocks.push(`${v.name} (friendship ${world.friendship[v.id] ?? 0})\n${memoryText(world, v.id, 5)}`)
  return blocks.join('\n\n')
}

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen === true
  const showTicker = options.ticker === true
  MODEL = typeof options.model === 'string' && options.model ? options.model : 'haiku'
  world.adults = options.nightclub === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'village',
      description: 'Open the cozy village; "/village memory" shows what everyone remembers, "/village forget" wipes it',
      argumentHint: '[memory|forget]',
    })
    restore(world, await $.store.get(STORE_KEY))

    $.clock.every(150, async () => {
      step(world)
      const lines = world.log.splice(0)
      if (lines.length) await update($, log, list => [...list, ...lines].slice(-60))
      for (const headline of world.announce.splice(0)) $.ui.toast(`★ ${headline}`)
      if (world.diaryDue.length && !isReflecting) void reflect($)

      if (surface === 'terminal') {
        void $.ui.blit({ requestId: PANE, key: 'world', columns: viewCols, rows: ROWS, cells: encode(frame(world, viewCols)) })
      } else if (world.tick % 4 === 0) {
        $.ui.invalidate('ui.render')
      }

      if (showTicker && world.tick % 20 === 0) {
        const line = ticker(world)
        if (line !== lastTicker) { lastTicker = line; $.ui.status(line) }
      }
      if (world.reply && world.tick > world.reply.until) world.reply = null
      const offer = world.reply ? `${world.reply.who}@${world.reply.until}` : ''
      if (offer !== (await read($, replyKey))) await update($, replyKey, () => offer)
      if (world.askMore && !isAnswering) void tellMore($)

      const hour = Math.floor(world.minutes / 60)
      if (hour !== savedHour) {
        savedHour = hour
        void $.store.set(STORE_KEY, snapshot(world))
      }
    })

    if (autoOpen) void open($)
    if (!showTicker) $.ui.status(undefined)
    return next(e)
  })

  // the village mirrors the real session: tools become chores, finished turns get a cheer
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    echoTool(world, String(e.tool))
    const result = await next(e)
    const command = String((e as { input?: { command?: unknown } }).input?.command ?? '')
    if (/bash|powershell/i.test(String(e.tool)) && TESTS.test(command)) {
      echoTests(world, !(result as { isError?: boolean }).isError)
    }
    return result
  }).catch(($, e, next) => next(e)) // the village only watches: whatever goes wrong here, the tool call runs untouched

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) echoTurn(world, e.durationMs / 1000, e.reason === 'answer' ? 'answer' : e.reason === 'aborted' ? 'aborted' : 'error')
    return next(e)
  })

  on('command.run', { command: 'village' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'memory') return { text: memoryReport() }
    if (arg === 'forget') {
      const fresh = createWorld()
      world.memory = fresh.memory
      world.friendship = fresh.friendship
      world.diaryDue = []
      await $.store.set(STORE_KEY, snapshot(world))
      return { text: 'Everyone in the village forgot everything. Fresh start!' }
    }
    await open($, true)
    return { text: 'Welcome to the village! Type a wish into the field below the map.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    surface = e.surface
    viewCols = Math.max(24, Math.min(MAX_VIEW, e.props.bodyColumns))
    const lines = await read($, log)
    const isThinking = await read($, thinking)
    const current = await read($, tab)
    // map, tab bar, the panel's frame and the framed input take the rest of the rows
    const room = Math.max(3, Math.min(10, e.props.scroll.bodyRows - ROWS - 7))
    const width = viewCols
    const cells = frame(world, viewCols)
    const { Box, Text, Button } = $.ui.resolve(e)

    const header = (title: string, extra?: string) => (
      <Box flexDirection="row" columnGap={1}>
        <Text bold color={ACCENT}>{title.toUpperCase()}</Text>
        {extra ? <Text dimColor>{extra}</Text> : null}
      </Box>
    )

    // ---- the tab bar: the active tab is a filled chip, the others are buttons to click ----
    const tabs = (
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Box flexDirection="row" columnGap={2}>
          {TABS.map(t => (t.id === current
            ? <Text bold color={INK} backgroundColor={ACCENT}>{` ${t.label} `}</Text>
            : <Button key={`tab-${t.id}`} plain label={` ${t.label} `} dimColor onPress={() => update($, tab, () => t.id)} />))}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          {isThinking ? <Text italic color={ACCENT}>Claude is thinking…</Text> : null}
          <Button
            key="postcard"
            plain
            label="Postcard"
            dimColor
            onPress={async press => {
              world.flash = 3
              const copied = await $.ui.copy({ text: postcard(world, viewCols), surface: press.surface })
              $.ui.toast(copied.isCopied ? 'Postcard copied to the clipboard!' : 'Could not copy the postcard here.')
            }}
          />
          {world.projects.museum.done ? (
            <Button
              key="museum"
              plain
              label={world.scene === 'museum' ? 'Leave museum' : 'Museum tour'}
              dimColor
              onPress={() => enqueue(world, [{ do: world.scene === 'museum' ? 'exit' : 'tour' }])}
            />
          ) : null}
        </Box>
      </Box>
    )

    // ---- one-key chores, no model call needed ----
    const QUICK: { key: string; label: string; plan: Parameters<typeof enqueue>[1] }[] = [
      { key: 'quick-fish', label: 'Fish', plan: [{ do: 'fish' }] },
      { key: 'quick-chop', label: 'Chop ×5', plan: [{ do: 'chop', count: 5 }] },
      { key: 'quick-water', label: 'Water', plan: [{ do: 'water' }] },
      { key: 'quick-harvest', label: 'Harvest', plan: [{ do: 'harvest' }] },
      { key: 'quick-sell', label: 'Sell', plan: [{ do: 'sell' }] },
      { key: 'quick-mail', label: 'Mail', plan: [{ do: 'mail' }] },
    ]
    // ---- answering a villager: three replies while the offer lasts ----
    const offer = await read($, replyKey)
    const pending = offer && world.reply ? world.reply : null
    const replies = pending ? (
      <Box flexDirection="row" columnGap={2} width={width}>
        <Box flexShrink={1}>
          <Text wrap="truncate"><Text bold color={COLORS[pending.who]}>{NAMES[pending.who]}</Text><Text italic>{` "${pending.line}"`}</Text></Text>
        </Box>
        <Box flexDirection="row" columnGap={2} flexShrink={0}>
          {pending.options.map((o, k) => (
            <Button key={`reply-${k}`} plain label={`› ${o.label}`} dimColor={o.kind === 'brush'} onPress={() => chooseReply(world, k)} />
          ))}
        </Box>
      </Box>
    ) : null

    const quick = (
      <Box flexDirection="row" columnGap={2} width={width}>
        <Text dimColor>Quick:</Text>
        {QUICK.map(q => <Button key={q.key} plain label={q.label} dimColor onPress={() => enqueue(world, q.plan)} />)}
      </Box>
    )

    // ---- the three panels ----
    const chatRows = lines.slice(-room).map(line => (line.who === 'event'
      ? <Text dimColor italic wrap="truncate">{`${' '.repeat(NAME_WIDTH)} ${line.text}`}</Text>
      : (
        <Box flexDirection="row">
          <Box width={NAME_WIDTH + 1} flexShrink={0}><Text bold color={COLORS[line.who] ?? '#cccccc'}>{NAMES[line.who] ?? line.who}</Text></Box>
          <Text wrap="truncate">{line.text}</Text>
        </Box>
      )))
    if (chatRows.length === 0) chatRows.push(<Text dimColor italic>Nothing has happened yet. Tell Claude what to do below.</Text>)

    const memoryRows = ['claude', ...VILLAGERS.map(v => v.id)].flatMap(who => {
      const list = world.memory[who] ?? []
      const diary = list.filter(m => m.kind === 'diary').slice(-1)[0]
      const facts = list.filter(m => m.kind === 'fact').slice(-2).map(m => m.text)
      const last = list.filter(m => m.kind === 'event').slice(-1)[0]
      const hearts = who === 'claude' ? '' : `♥ ${world.friendship[who] ?? 0}`
      return [
        <Box flexDirection="row">
          <Box width={NAME_WIDTH + 1} flexShrink={0}><Text bold color={COLORS[who]}>{NAMES[who]}</Text></Box>
          <Box width={6} flexShrink={0}><Text color="#f48fb1">{hearts}</Text></Box>
          <Text italic wrap="truncate">{diary ? `Day ${diary.day}: ${diary.text}` : last ? last.text : 'no memories yet'}</Text>
        </Box>,
        ...(facts.length ? [<Text dimColor wrap="truncate">{`${' '.repeat(NAME_WIDTH + 7)}knows: ${facts.join(' · ')}`}</Text>] : []),
      ]
    })

    const projectRows = projectIds(world).map(id => {
      const def = PROJECTS[id]
      const st = world.projects[id]
      const items = Object.entries(def.items).map(([k, n]) => `${st.items[k] ?? 0}/${n} ${k}`).join(', ')
      const have = st.bells + Object.values(st.items).reduce((a, b) => a + b, 0) * 100
      const total = def.bells + Object.values(def.items).reduce((a, b) => a + b, 0) * 100
      return (
        <Box flexDirection="row" columnGap={1}>
          <Box width={16} flexShrink={0}><Text>{def.name}</Text></Box>
          {st.done
            ? <Text color="#81c784">✓ built</Text>
            : <><Text color="#81c784">{bar(have, total)}</Text><Text dimColor wrap="truncate">{`${st.bells}/${def.bells} Bells · ${items}`}</Text></>}
        </Box>
      )
    })
    const museumRows = world.projects.museum.done
      ? Object.entries(MUSEUM).map(([section, pieces]) => {
        const have = pieces.filter(m => world.museum.includes(m)).length
        return (
          <Box flexDirection="row" columnGap={1}>
            <Box width={16} flexShrink={0}><Text>{section[0].toUpperCase() + section.slice(1)}</Text></Box>
            <Text color="#4fc3f7">{bar(have, pieces.length)}</Text>
            <Text dimColor>{`${have}/${pieces.length}`}</Text>
          </Box>
        )
      })
      : [<Text dimColor>Not built yet - fund it on the plaza board.</Text>]
    const requestRows = world.requests.length
      ? world.requests.map(r => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={NAME_WIDTH} flexShrink={0}><Text bold color={COLORS[r.who]}>{NAMES[r.who]}</Text></Box>
          {r.done
            ? <Text color="#81c784">✓ done</Text>
            : <Text>{`wants ${r.amount - r.given} ${r.item}`}<Text dimColor>{` · pays ${r.reward} Bells`}</Text></Text>}
        </Box>
      ))
      : [<Text dimColor>No requests today.</Text>]
    const villageRows = [
      header('Requests'), ...requestRows,
      header('Projects', 'fund them at the plaza board'), ...projectRows,
      header('Museum', `${world.museum.length} pieces`), ...museumRows,
    ]

    const panelRows = current === 'memories' ? memoryRows : current === 'village' ? villageRows : chatRows
    const panel = (
      <Box key={`panel-${current}`} flexDirection="column" borderStyle="round" borderColor="#6d5a45" paddingX={1} width={width}
        height={current === 'chat' ? room + 2 : undefined}>
        {current === 'chat' ? panelRows : panelRows.slice(0, Math.max(room, 8) + 6)}
      </Box>
    )

    const placeholder = isThinking ? 'Claude is thinking…' : 'Tell Claude what to do, e.g. "buy pumpkin seeds and plant them"'
    const submit = (value: string) => { void ask($, value) }

    if (e.surface === 'terminal') {
      const { Raster, Input } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Raster key="world" columns={viewCols} rows={ROWS} cells={encode(cells)} />
          {tabs}
          {panel}
          {replies ?? quick}
          <Box borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
            <Input key="wish" label="✎ " placeholder={placeholder} submitLabel="send" autoFocus onSubmit={submit} />
          </Box>
        </Box>
      )
    }
    const map = frameText(cells, viewCols).map(row => <Text>{row}</Text>)
    if (e.surface === 'mobile') return <Box flexDirection="column">{map}{tabs}{panel}</Box>
    const { Input } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {map}
        {tabs}
        {panel}
        <Box borderStyle="round" borderColor={ACCENT} paddingX={1}>
          <Input key="wish" label="✎ " placeholder={placeholder} submitLabel="send" onSubmit={submit} />
        </Box>
      </Box>
    )
  })
}
