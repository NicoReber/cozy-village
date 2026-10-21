import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LogLine, Tab } from '../types'
import { MUSEUM, PROJECTS } from './catalog'
import type { ProjectId } from './catalog'
import {
  applyDiary, createWorld, DIARY_SYSTEM, diaryPrompt, echoTests, echoTool, echoTurn, encode, enqueue, frame, heardWish, MAX_VIEW,
  memoryText, parseActions, postcard, projectIds, restore, ROWS, sayPlayer, snapshot, step, summary, systemPrompt, ticker, VILLAGERS,
} from './game'
import { CHORES, infoPayload, mapPayload, statePayload } from './web'

const PANE = 'cozy-village'
/** The model behind the villagers; the `model` setting replaces it when the module loads. */
let MODEL = 'haiku'
const STORE_KEY = 'world'
const log = atom({ plugin: 'cozy-village', key: 'log' } as const, [] as LogLine[])
const thinking = atom({ plugin: 'cozy-village', key: 'thinking' } as const, false)
const tab = atom({ plugin: 'cozy-village', key: 'tab' } as const, 'chat' as Tab)
/** The browser view's address once its server listens, empty before; the pane shows it. */
const webLink = atom({ plugin: 'cozy-village', key: 'web' } as const, '')

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
/** The browser view's server: started once, then fed the world every tick (see web/server.mjs). */
const web = { started: false, port: 0, token: '', posting: false, mapSent: '', mapAt: -1, infoSent: '', infoAt: -1, chat: [] as LogLine[] }
/** The village's tick; null while the village is stopped. */
let tick: { cancel: () => void } | null = null
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

/** Starts the browser view's server once; it lives as long as this module, which kills it on unload. */
function startWeb($: EngineInterface) {
  if (web.started || !tick) return
  web.started = true
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  web.token = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  void (async () => {
    try {
      const server = $.process.spawn({ argv: ['node', `${$.plugin.root}/web/server.mjs`], env: { VILLAGE_TOKEN: web.token } })
      for await (const { stream, text } of server) {
        const port = /LISTENING (\d+)/.exec(text)
        if (stream === 'stdout' && port) {
          web.port = Number(port[1])
          web.mapSent = ''; web.infoSent = ''
          await update($, webLink, () => `http://localhost:${web.port}/?k=${web.token}`)
        }
      }
    } catch (err) {
      $.ui.log(`cozy-village: the browser view could not start (${String(err)}); is Node.js installed?`, { to: 'debug' })
    }
    web.port = 0
    web.started = false
    await update($, webLink, () => '')
  })()
}

/** Posts the world to the browser view and acts on what its viewers asked for since the last post. */
async function feedWeb($: EngineInterface) {
  web.posting = true
  try {
    let map: string | undefined
    if (world.tick - web.mapAt >= 10 || !web.mapSent) {
      web.mapAt = world.tick
      const next = JSON.stringify(mapPayload(world))
      if (next !== web.mapSent) { map = next; web.mapSent = next }
    }
    let info: string | undefined
    if (world.tick - web.infoAt >= 10 || !web.infoSent) {
      web.infoAt = world.tick
      const next = JSON.stringify(infoPayload(world))
      if (next !== web.infoSent) { info = next; web.infoSent = next }
    }
    const body = `{"state":${JSON.stringify(statePayload(world, web.chat))}${map ? `,"map":${map}` : ''}${info ? `,"info":${info}` : ''}}`
    const res = await $.http.fetch(`http://127.0.0.1:${web.port}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-village-token': web.token }, body })
    if (!res.ok) { web.mapSent = ''; web.infoSent = ''; return }
    const { inbox } = JSON.parse(res.text) as { inbox?: { kind?: unknown; text?: unknown; key?: unknown; index?: unknown }[] }
    for (const a of inbox ?? []) {
      if (a.kind === 'wish' && typeof a.text === 'string') void ask($, a.text.slice(0, 500))
      else if (a.kind === 'chore' && typeof a.key === 'string' && CHORES[a.key]) enqueue(world, CHORES[a.key].plan as Parameters<typeof enqueue>[1])
      else if (a.kind === 'museum' && world.projects.museum.done) enqueue(world, [{ do: world.scene === 'museum' ? 'exit' : 'tour' }])
    }
  } catch {
    web.mapSent = ''; web.infoSent = ''
  } finally {
    web.posting = false
  }
}

/** Opens a link in the person's browser, the way their system does it. */
async function openInBrowser($: EngineInterface, url: string): Promise<boolean> {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const tries = windows ? [['rundll32', 'url.dll,FileProtocolHandler', url]] : [['open', url], ['xdg-open', url]]
  for (const argv of tries) {
    try {
      const done = await $.process.run(argv, { timeoutMs: 10000 })
      if (done.exitCode === 0) return true
    } catch { /* try the next opener */ }
  }
  return false
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

  /** The village only runs between a start (`/village`, auto-open, the ticker) and a stop (`/village stop`). */
  const startClock = ($: EngineInterface) => {
    if (tick) return
    tick = $.clock.every(150, async () => {
      step(world)
      const lines = world.log.splice(0)
      if (lines.length) {
        web.chat = [...web.chat, ...lines].slice(-60)
        await update($, log, list => [...list, ...lines].slice(-60))
      }
      if (web.port && !web.posting) void feedWeb($)
      for (const headline of world.announce.splice(0)) $.ui.toast(`★ ${headline}`)
      if (world.diaryDue.length && !isReflecting) void reflect($)

      if (surface === 'terminal') {
        void $.ui.blit({ requestId: PANE, key: 'world', columns: viewCols, rows: ROWS, cells: encode(frame(world, viewCols)) })
      }

      if (showTicker && world.tick % 20 === 0) {
        const line = ticker(world)
        if (line !== lastTicker) { lastTicker = line; $.ui.status(line) }
      }

      const hour = Math.floor(world.minutes / 60)
      if (hour !== savedHour) {
        savedHour = hour
        void $.store.set(STORE_KEY, snapshot(world))
      }
    })
  }

  const stopVillage = async ($: EngineInterface) => {
    tick?.cancel()
    tick = null
    const port = web.port
    if (port) await $.http.fetch(`http://127.0.0.1:${port}/api/stop`, { method: 'POST', headers: { 'x-village-token': web.token } }).catch(() => {})
    await $.store.set(STORE_KEY, snapshot(world))
    if (showTicker) $.ui.status(undefined)
    lastTicker = ''
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'village',
      description: 'Open the cozy village; "/village web" opens it in your browser, "/village stop" stops it for good, "/village memory" shows what everyone remembers, "/village forget" wipes it',
      argumentHint: '[web|stop|memory|forget]',
    })
    restore(world, await $.store.get(STORE_KEY))

    if (autoOpen || showTicker) startClock($)

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
    if (arg === 'stop') {
      await stopVillage($)
      await $.ui.close({ id: PANE })
      return { text: 'The village is stopped: nothing runs in the background now. /village starts it again.' }
    }
    if (arg === 'web') {
      startClock($)
      startWeb($)
      for (let i = 0; i < 40 && !web.port; i++) await $.clock.sleep(100)
      const url = await read($, webLink)
      if (!url) return { text: 'The browser view did not start. It needs Node.js on this computer.' }
      const opened = await openInBrowser($, url)
      return { text: opened ? `The village is open in your browser: ${url}` : `Open this link in your browser: ${url}` }
    }
    if (arg === 'forget') {
      const fresh = createWorld()
      world.memory = fresh.memory
      world.friendship = fresh.friendship
      world.diaryDue = []
      await $.store.set(STORE_KEY, snapshot(world))
      return { text: 'Everyone in the village forgot everything. Fresh start!' }
    }
    startClock($)
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
          <Raster key="world" columns={viewCols} rows={ROWS} cells={encode(frame(world, viewCols))} />
          {tabs}
          {panel}
          {quick}
          <Box borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
            <Input key="wish" label="✎ " placeholder={placeholder} submitLabel="send" autoFocus onSubmit={submit} />
          </Box>
        </Box>
      )
    }
    // desktop and mobile: the village itself runs in the browser, where it can animate without reloading
    startWeb($)
    const url = await read($, webLink)
    const { Link } = $.ui.resolve(e)
    const browser = (
      <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
        <Text bold color={ACCENT}>🏡 The village lives in your browser</Text>
        <Text dimColor>{url ? 'Pixel art, walking villagers, day and night. Open the link in the Browser pane (Ctrl+Shift+B) or your own browser; this pane keeps the chat and your wishes.' : 'Starting the browser view… (it needs Node.js)'}</Text>
        {url ? <Link href={url} label={url} /> : null}
        {url ? (
          <Box flexDirection="row" columnGap={2}>
            <Button key="open-browser" label="Open in my browser" onPress={async () => {
              if (!(await openInBrowser($, url))) $.ui.toast('Could not open a browser here; copy the link instead.')
            }} />
            <Button key="copy-link" plain dimColor label="Copy link" onPress={async press => {
              const copied = await $.ui.copy({ text: url, surface: press.surface })
              $.ui.toast(copied.isCopied ? 'Link copied!' : url)
            }} />
          </Box>
        ) : null}
      </Box>
    )
    if (e.surface === 'mobile') return <Box flexDirection="column">{browser}{tabs}{panel}{quick}</Box>
    const { Input } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {browser}
        {tabs}
        {panel}
        {quick}
        <Box borderStyle="round" borderColor={ACCENT} paddingX={1}>
          <Input key="wish" label="✎ " placeholder={placeholder} submitLabel="send" onSubmit={submit} />
        </Box>
      </Box>
    )
  })
}
