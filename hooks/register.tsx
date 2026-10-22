import { atom, read, update } from 'claude-code'
import type { EngineInterface, HttpResponse, Register } from 'claude-code'

import type { Info, LogLine, Tab } from '../types'
import { encode, MAX_VIEW, ROWS, VILLAGERS } from './game'
import type { Job } from './host'
import { CHORES } from './web'

// The village itself runs in one local server that every session shares (web/server.mjs, hooks/host.ts).
// This module connects to it: it says hello, reports what the session's real work is doing, draws the pane
// from the server's picture, and runs the model calls the village hands out, since only a session can.

const PANE = 'cozy-village'
/** The model behind the villagers; the `model` setting replaces it when the module loads. */
let MODEL = 'haiku'
/** Where the save lived before the shared server; moved into the server's save folder once. */
const STORE_KEY = 'world'
const log = atom({ plugin: 'cozy-village', key: 'log' } as const, [] as LogLine[])
const thinking = atom({ plugin: 'cozy-village', key: 'thinking' } as const, false)
const tab = atom({ plugin: 'cozy-village', key: 'tab' } as const, 'chat' as Tab)
/** The browser view's address once the server is there, empty before; the pane shows it. */
const webLink = atom({ plugin: 'cozy-village', key: 'web' } as const, '')
/** The Memories and Village tabs, as the server last sent them. */
const info = atom({ plugin: 'cozy-village', key: 'info' } as const, null as Info | null)
/** Whether the museum is built and Claude is inside it, for the tab bar's button. */
const museum = atom({ plugin: 'cozy-village', key: 'museum' } as const, { open: false, inside: false })
/** How many apprentices work at the office and whether Claude is inside it, for the tab bar's button. */
const office = atom({ plugin: 'cozy-village', key: 'office' } as const, { staff: 0, inside: false })

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
/** How an apprentice's desk reads in the Village tab. */
const DESK_STATUS: Record<Info['office'][number]['status'], [string, string]> = {
  working: ['busy', '#69f0ae'], idle: ['idle', '#90a4ae'], done: ['done', '#ffd54f'], error: ['trouble', '#ff5252'],
}
const bar = (have: number, total: number, width = 12) => {
  const full = Math.round((Math.min(have, total) / Math.max(1, total)) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}
const TESTS = /\b(test|tests|vitest|jest|pytest|dotnet\s+test|cargo\s+test|npm\s+run\s+build|dotnet\s+build|tsc)\b/i
/** How often a session that only reports its work checks in, takes model jobs and looks for a server. */
const LINK_MS = 3000

/** The link to the shared server; `port` is 0 while there is none. */
const server = { port: 0, token: '', session: `pane-${Math.random().toString(36).slice(2)}`, repo: '', branch: '', launching: false }
/** What the pane draws, as the server last sent it. */
const pane = { cells: '', cols: 0, chat: '', since: 0, polls: 0, polling: false, ticker: '' }
let viewCols = MAX_VIEW
let surface = 'terminal'
/** The pane's clock; null while the village is stopped in this session. */
let tick: { cancel: () => void } | null = null
let busyWithJob = false
/** The `ticker` setting; set when the module registers. */
let showTicker = false
let adults = false

/** An empty picture `cols` wide: spaces on the night sky's ink. */
function blank(cols: number): string {
  const cells = new Uint32Array(cols * ROWS * 3)
  for (let i = 0; i < cells.length; i += 3) { cells[i] = 0x20; cells[i + 1] = 0x808080; cells[i + 2] = 0x101820 }
  return encode(cells)
}

function open($: EngineInterface, focus?: true) {
  return $.ui.open({ id: PANE, title: 'Village', rows: ROWS + 12, columns: MAX_VIEW + 2, focus })
}

/** The folder the server keeps its save and server.json in (`VILLAGE_HOME` for a test village); the server is told the same. */
async function villageHome($: EngineInterface): Promise<string> {
  const own = await $.env.get('VILLAGE_HOME')
  if (own) return own.replaceAll('\\', '/')
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
  return `${(config || `${home}/.claude`).replaceAll('\\', '/')}/cozy-village`
}

/** Calls the shared server; null when it is not there (then the link is dropped, to be found again). */
async function api($: EngineInterface, method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResponse | null> {
  if (!server.port) return null
  try {
    const res = await $.http.fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-village-token': server.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // a new server took the port since, with a token of its own
    if (res.status === 403) throw new Error('not our server')
    return res
  } catch {
    server.port = 0
    await update($, webLink, () => '')
    return null
  }
}

const q = (params: Record<string, string | number>) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

/**
 * Finds the shared server, or with `start` starts it when none runs. A server stopped on purpose
 * (`/village stop` in any session) is only started again by a `start`; without one this session's pane stops too.
 */
async function connect($: EngineInterface, start: boolean): Promise<boolean> {
  if (server.port) return true
  if (server.launching) return false
  server.launching = true
  try {
    const home = await villageHome($)
    let found: { port?: unknown; token?: unknown; stopped?: unknown } | null = null
    try { found = JSON.parse(await $.fs.read(`${home}/server.json`) as string) } catch { /* no server yet */ }
    if (found?.stopped && !start) {
      stopClock($)
      return false
    }
    if (found && typeof found.port === 'number' && typeof found.token === 'string' && !found.stopped) {
      server.port = found.port
      server.token = found.token
      if (!(await api($, 'GET', '/api/ping'))?.ok) server.port = 0
    }
    if (!server.port && start) {
      // the save from before the shared server moves into its folder once, so nobody loses their village
      if (!(await $.fs.exists(`${home}/world.json`))) {
        const old = await $.store.get(STORE_KEY)
        if (old) await $.fs.write(`${home}/world.json`, JSON.stringify(old))
      }
      const done = await $.process.run(['node', `${$.plugin.root}/web/launch.mjs`], {
        env: { VILLAGE_HOME: home, VILLAGE_ADULTS: adults ? '1' : '0' }, timeoutMs: 30000,
      })
      const line = done.stdout.trim().split('\n').pop() ?? ''
      if (done.exitCode !== 0 || !line.startsWith('{')) {
        $.ui.log(`cozy-village: the village server did not start (${done.stderr.trim() || done.exitCode}); is Node.js 22.18+ installed?`, { to: 'debug' })
        return false
      }
      const launched = JSON.parse(line) as { port: number; token: string }
      server.port = launched.port
      server.token = launched.token
    }
    if (!server.port) return false
    await api($, 'POST', '/api/hello', { session: server.session, repo: server.repo, branch: server.branch })
    await update($, webLink, () => `http://localhost:${server.port}/?k=${server.token}`)
    return true
  } catch (err) {
    $.ui.log(`cozy-village: cannot reach the village server (${String(err)})`, { to: 'debug' })
    server.port = 0
    return false
  } finally {
    server.launching = false
  }
}

/** Takes one model job from the village, runs it with this session's model and answers it. */
async function runJob($: EngineInterface) {
  if (busyWithJob || !server.port) return
  busyWithJob = true
  try {
    const res = await api($, 'GET', `/api/jobs?${q({ session: server.session })}`)
    if (res?.status !== 200) return
    const job = JSON.parse(res.text) as Job
    const reply = await $.model.complete({ model: MODEL, system: job.system, prompt: job.prompt, maxTokens: job.maxTokens, timeoutMs: 60000 })
    await api($, 'POST', `/api/jobs/${job.id}`, reply.isAnswered ? { text: reply.text } : { text: null, reason: reply.reason })
  } catch (err) {
    $.ui.log(`cozy-village: a village job failed (${String(err)})`, { to: 'debug' })
  } finally {
    busyWithJob = false
  }
}

/** Reports what the session's real work is doing; nothing when no server runs. */
function report($: EngineInterface, event: Record<string, unknown>) {
  if (server.port) void api($, 'POST', '/api/event', { session: server.session, ...event })
}

/** Fetches what the pane shows and draws it: the picture, the chat, the headlines, the tab panels. */
async function pollPane($: EngineInterface) {
  pane.polling = true
  try {
    const current = await read($, tab)
    const wantInfo = current !== 'chat' && pane.polls++ % 10 === 0
    const res = await api($, 'GET', `/api/pane?${q({ session: server.session, cols: viewCols, since: pane.since, info: wantInfo ? 1 : 0, cells: surface === 'terminal' ? 1 : 0 })}`)
    if (!res?.ok) return
    const p = JSON.parse(res.text) as {
      cols: number; cells: string; chat: LogLine[]; thinking: boolean; scene: string; museumOpen: boolean; staff: number; ticker: string
      announce: string[]; seq: number; info?: Info
    }
    pane.since = p.seq
    for (const headline of p.announce) $.ui.toast(`★ ${headline}`)
    const chat = JSON.stringify(p.chat)
    if (chat !== pane.chat) { pane.chat = chat; await update($, log, () => p.chat) }
    if (p.thinking !== await read($, thinking)) await update($, thinking, () => p.thinking)
    const place = await read($, museum)
    if (place.open !== p.museumOpen || place.inside !== (p.scene === 'museum')) await update($, museum, () => ({ open: p.museumOpen, inside: p.scene === 'museum' }))
    const desks = await read($, office)
    if (desks.staff !== p.staff || desks.inside !== (p.scene === 'office')) await update($, office, () => ({ staff: p.staff, inside: p.scene === 'office' }))
    if (p.info) await update($, info, () => p.info!)
    if (p.cells) {
      pane.cells = p.cells
      pane.cols = p.cols
      void $.ui.blit({ requestId: PANE, key: 'world', columns: p.cols, rows: ROWS, cells: p.cells })
    }
    if (showTicker && p.ticker !== pane.ticker) { pane.ticker = p.ticker; $.ui.status(p.ticker) }
  } catch {
    // the next poll tries again
  } finally {
    pane.polling = false
  }
}

/** The pane runs between a start (`/village`, auto-open, the ticker) and a stop (`/village stop`). */
function startClock($: EngineInterface) {
  if (tick) return
  tick = $.clock.every(150, async () => {
    if (!server.port) { await connect($, false); return }
    if (!pane.polling) await pollPane($)
  })
}

function stopClock($: EngineInterface) {
  tick?.cancel()
  tick = null
  if (showTicker) $.ui.status(undefined)
  pane.ticker = ''
}

/** Sends a wish, a chore or the museum button; a wish's model call starts here right away. */
async function act($: EngineInterface, action: Record<string, unknown>) {
  if (!(await connect($, true))) { $.ui.toast('The village server is not running (it needs Node.js 22.18+).'); return }
  await api($, 'POST', '/api/do', { ...action, session: server.session })
  if (action.kind === 'wish') await runJob($)
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

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen === true
  showTicker = options.ticker === true
  MODEL = typeof options.model === 'string' && options.model ? options.model : 'haiku'
  adults = options.nightclub === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'village',
      description: 'Open the cozy village; "/village web" opens it in your browser, "/village stop" stops it for good, "/village memory" shows what everyone remembers, "/village forget" wipes it',
      argumentHint: '[web|stop|memory|forget]',
    })
    server.session = await $.session.id()
    const repo = await $.session.repo().catch(() => null)
    const cwd = (await $.session.cwd()).replaceAll('\\', '/')
    server.repo = (repo?.root ?? cwd).replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? ''
    const branch = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 }).catch(() => null)
    server.branch = branch?.exitCode === 0 ? branch.stdout.trim() : ''

    // every session joins a running village, pane or not: it reports its work and helps with model calls
    $.clock.every(LINK_MS, async () => {
      if (!server.port) await connect($, false)
      else await runJob($)
    })
    if (autoOpen || showTicker) startClock($)
    void connect($, autoOpen || showTicker)
    if (autoOpen) void open($)
    if (!showTicker) $.ui.status(undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (server.port) await api($, 'POST', '/api/bye', { session: server.session })
    return next(e)
  }).catch(($, e, next) => next(e))

  // the village mirrors the real session: tools become chores, finished turns get a cheer
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    report($, { type: 'tool', tool: String(e.tool) })
    const result = await next(e)
    const command = String((e as { input?: { command?: unknown } }).input?.command ?? '')
    if (/bash|powershell/i.test(String(e.tool)) && TESTS.test(command)) {
      report($, { type: 'tests', passed: !(result as { isError?: boolean }).isError })
    }
    return result
  }).catch(($, e, next) => next(e)) // the village only watches: whatever goes wrong here, the tool call runs untouched

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) report($, { type: 'turn', seconds: e.durationMs / 1000, outcome: e.reason === 'answer' ? 'answer' : e.reason === 'aborted' ? 'aborted' : 'error' })
    return next(e)
  })

  on('command.run', { command: 'village' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'stop') {
      stopClock($)
      await api($, 'POST', '/api/stop')
      server.port = 0
      await update($, webLink, () => '')
      await $.ui.close({ id: PANE })
      return { text: 'The village is stopped in every session: nothing runs in the background now. /village starts it again.' }
    }
    if (!(await connect($, true))) return { text: 'The village did not start. It needs Node.js 22.18 or newer on this computer.' }
    if (arg === 'memory') {
      const res = await api($, 'GET', '/api/memory')
      return { text: res?.ok ? (JSON.parse(res.text) as { text: string }).text : 'The village did not answer.' }
    }
    if (arg === 'web') {
      startClock($)
      const url = await read($, webLink)
      const opened = await openInBrowser($, url)
      return { text: opened ? `The village is open in your browser: ${url}` : `Open this link in your browser: ${url}` }
    }
    if (arg === 'forget') {
      await api($, 'POST', '/api/forget')
      return { text: 'Everyone in the village forgot everything. Fresh start!' }
    }
    startClock($)
    await open($, true)
    return { text: 'Welcome to the village! Type a wish into the field below the map.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    surface = e.surface
    viewCols = Math.max(24, Math.min(MAX_VIEW, e.props.bodyColumns))
    startClock($)
    const lines = await read($, log)
    const isThinking = await read($, thinking)
    const current = await read($, tab)
    const panels = await read($, info)
    const place = await read($, museum)
    const desks = await read($, office)
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
            : <Button key={`tab-${t.id}`} plain label={` ${t.label} `} dimColor onPress={async () => {
              await update($, tab, () => t.id)
              pane.polls = 0 // the next poll brings the panel's data
            }} />))}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          {isThinking ? <Text italic color={ACCENT}>Claude is thinking…</Text> : null}
          <Button
            key="postcard"
            plain
            label="Postcard"
            dimColor
            onPress={async press => {
              const res = await api($, 'GET', `/api/postcard?${q({ cols: viewCols })}`)
              if (!res?.ok) { $.ui.toast('The village is not running.'); return }
              const copied = await $.ui.copy({ text: (JSON.parse(res.text) as { text: string }).text, surface: press.surface })
              $.ui.toast(copied.isCopied ? 'Postcard copied to the clipboard!' : 'Could not copy the postcard here.')
            }}
          />
          <Button key="office" plain label={desks.inside ? 'Leave office' : `Office (${desks.staff})`} dimColor onPress={() => act($, { kind: 'office' })} />
          {place.open ? (
            <Button key="museum" plain label={place.inside ? 'Leave museum' : 'Museum tour'} dimColor onPress={() => act($, { kind: 'museum' })} />
          ) : null}
        </Box>
      </Box>
    )

    // ---- one-key chores, no model call needed ----
    const quick = (
      <Box flexDirection="row" columnGap={2} width={width}>
        <Text dimColor>Quick:</Text>
        {Object.entries(CHORES).map(([key, c]) => <Button key={`quick-${key}`} plain label={c.label} dimColor onPress={() => act($, { kind: 'chore', key })} />)}
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

    const loading = [<Text dimColor italic>Asking the village…</Text>]
    const memoryRows = panels ? panels.people.flatMap(p => [
      <Box flexDirection="row">
        <Box width={NAME_WIDTH + 1} flexShrink={0}><Text bold color={p.color}>{p.name}</Text></Box>
        <Box width={6} flexShrink={0}><Text color="#f48fb1">{p.hearts === null ? '' : `♥ ${p.hearts}`}</Text></Box>
        <Text italic wrap="truncate">{p.diary}</Text>
      </Box>,
      ...(p.facts.length ? [<Text dimColor wrap="truncate">{`${' '.repeat(NAME_WIDTH + 7)}knows: ${p.facts.slice(-2).join(' · ')}`}</Text>] : []),
    ]) : loading

    const projectRows = (panels?.projects ?? []).map(p => (
      <Box flexDirection="row" columnGap={1}>
        <Box width={16} flexShrink={0}><Text>{p.name}</Text></Box>
        {p.done
          ? <Text color="#81c784">✓ built</Text>
          : <><Text color="#81c784">{bar(Math.round(p.pct * 100), 100)}</Text><Text dimColor wrap="truncate">{`${p.bells}/${p.need} Bells · ${p.items.map(i => `${i.have}/${i.need} ${i.name}`).join(', ')}`}</Text></>}
      </Box>
    ))
    const museumRows = panels?.museum.open
      ? panels.museum.sections.map(s => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={16} flexShrink={0}><Text>{s.name[0].toUpperCase() + s.name.slice(1)}</Text></Box>
          <Text color="#4fc3f7">{bar(s.have, s.total)}</Text>
          <Text dimColor>{`${s.have}/${s.total}`}</Text>
        </Box>
      ))
      : [<Text dimColor>Not built yet - fund it on the plaza board.</Text>]
    const requestRows = panels?.requests.length
      ? panels.requests.map(r => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={NAME_WIDTH} flexShrink={0}><Text bold color={r.color}>{r.who}</Text></Box>
          {r.done
            ? <Text color="#81c784">✓ done</Text>
            : <Text>{`wants ${r.left} ${r.item}`}<Text dimColor>{` · pays ${r.reward} Bells`}</Text></Text>}
        </Box>
      ))
      : [<Text dimColor>No requests today.</Text>]
    const officeRows = panels?.office.length
      ? panels.office.map(a => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={NAME_WIDTH + 2} flexShrink={0}><Text bold color={a.color}>{a.name}</Text></Box>
          <Box width={8} flexShrink={0}><Text color={DESK_STATUS[a.status][1]}>{DESK_STATUS[a.status][0]}</Text></Box>
          <Text dimColor wrap="truncate">{`${a.repo || 'no repo'}${a.branch ? ` · ${a.branch}` : ''}${a.tool ? ` · ${a.tool}` : ''}`}</Text>
        </Box>
      ))
      : [<Text dimColor>Nobody at work: no Claude Code sessions are open.</Text>]
    const villageRows = panels ? [
      header('Office', 'one apprentice per open session'), ...officeRows,
      header('Requests'), ...requestRows,
      header('Projects', 'fund them at the plaza board'), ...projectRows,
      header('Museum', `${panels.museum.sections.reduce((n, s) => n + s.have, 0)} pieces`), ...museumRows,
    ] : loading

    const panelRows = current === 'memories' ? memoryRows : current === 'village' ? villageRows : chatRows
    const panel = (
      <Box key={`panel-${current}`} flexDirection="column" borderStyle="round" borderColor="#6d5a45" paddingX={1} width={width}
        height={current === 'chat' ? room + 2 : undefined}>
        {current === 'chat' ? panelRows : panelRows.slice(0, Math.max(room, 8) + 6)}
      </Box>
    )

    const placeholder = isThinking ? 'Claude is thinking…' : 'Tell Claude what to do, e.g. "buy pumpkin seeds and plant them"'
    const submit = async (value: string) => {
      const text = value.trim()
      if (text) await act($, { kind: 'wish', text })
    }

    if (e.surface === 'terminal') {
      const { Raster, Input } = $.ui.resolve(e)
      // until the server's first picture arrives, a blank one of the right size
      const cells = pane.cells && pane.cols === viewCols ? pane.cells : blank(viewCols)
      return (
        <Box flexDirection="column">
          <Raster key="world" columns={viewCols} rows={ROWS} cells={cells} />
          {tabs}
          {panel}
          {quick}
          <Box borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
            <Input key="wish" label="✎ " placeholder={placeholder} submitLabel="send" autoFocus onSubmit={submit} />
          </Box>
        </Box>
      )
    }
    // desktop and mobile: the village itself shows in the browser, where it can animate without reloading
    if (!server.port) void connect($, true)
    const url = await read($, webLink)
    const { Link } = $.ui.resolve(e)
    const browser = (
      <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
        <Text bold color={ACCENT}>🏡 The village lives in your browser</Text>
        <Text dimColor>{url ? 'Pixel art, walking villagers, day and night. Open the link in the Browser pane (Ctrl+Shift+B) or your own browser; this pane keeps the chat and your wishes.' : 'Starting the village… (it needs Node.js 22.18+)'}</Text>
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
