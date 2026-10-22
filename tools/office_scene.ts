// The scripted scene behind docs/office.gif. `node tools/render_browser_gif.mjs office` copies this file into tests/
// for one run of `claude plugin test`, then replays what it prints into the real browser view, tick by tick, and films it.

import { test } from 'claude-code/testing'

import { createWorld, enqueue, step } from '../hooks/game'
import { mapPayload, statePayload } from '../hooks/web'
import { joinOffice, OFFICE_ENTRANCE, officeWork, runOffice } from '../hooks/office'
import type { LogLine } from '../types'

/** The test runner provides a console; the plugin types do not declare one. */
declare const console: { log: (...args: unknown[]) => void }

test('record the office scene', async () => {
  const w = createWorld()
  w.requests = []
  w.events = []
  w.weather = 'clear'
  w.critters = []
  w.day = 5
  w.minutes = 10 * 60
  const chat: LogLine[] = []
  let lastMap = ''

  const scene = (label: string) => console.log(`SCENE ${label}`)
  const shoot = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      step(w)
      chat.push(...w.log.splice(0))
      const map = JSON.stringify(mapPayload(w))
      const state = JSON.stringify(statePayload(w, chat.slice(-12)))
      console.log(`TICK {"state":${state}${map !== lastMap ? `,"map":${map}` : ''}}`)
      lastMap = map
    }
  }

  // three sessions already at work: their apprentices sit at their desks before filming starts
  joinOffice(w.office, 's-1', { repo: 'cozy-village', branch: 'main' })
  joinOffice(w.office, 's-2', { repo: 'api-server', branch: 'fix/login' })
  joinOffice(w.office, 's-3', { repo: 'docs', branch: 'release-notes' })
  for (let i = 0; i < 200; i++) runOffice(w.office, i * 2)
  for (const a of w.office.staff) a.bubble = undefined
  officeWork(w.office, 's-1', { type: 'tool', tool: 'Edit' })
  officeWork(w.office, 's-2', { type: 'tool', tool: 'Bash' })
  // Claude has just stepped in through the door
  w.scene = 'office'
  w.inside = { ...OFFICE_ENTRANCE, path: [] }
  w.label = 'at the office'

  scene('The office')
  enqueue(w, [{ do: 'say', text: "Let's see how everyone is doing!" }, { do: 'office' }])
  shoot(12)
  officeWork(w.office, 's-3', { type: 'tool', tool: 'Grep' })
  shoot(12)
  // a fourth session opens and its apprentice comes in through the door
  joinOffice(w.office, 's-4', { repo: 'mobile-app', branch: 'feature/dark-mode' })
  shoot(10)
  officeWork(w.office, 's-1', { type: 'tool', tool: 'Read' })
  shoot(10)
  officeWork(w.office, 's-4', { type: 'tool', tool: 'Read' })
  officeWork(w.office, 's-2', { type: 'tests', passed: true })
  shoot(15)
  officeWork(w.office, 's-3', { type: 'tool', tool: 'WebSearch' })
  shoot(15)
  officeWork(w.office, 's-1', { type: 'turn', seconds: 45, outcome: 'answer' })
  officeWork(w.office, 's-4', { type: 'tool', tool: 'Write' })
  shoot(24)
  officeWork(w.office, 's-3', { type: 'turn', seconds: 10, outcome: 'error' })
  shoot(40)
})
