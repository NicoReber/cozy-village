// The scripted scenes behind docs/browser.gif. tools/render_browser_gif.mjs copies this file into tests/ for one run
// of `claude plugin test`, then replays what it prints into the real browser view, tick by tick, and films it.

import { test } from 'claude-code/testing'

import { applyProject, createWorld, enqueue, step } from '../hooks/game'
import type { Action, VillagerId, World } from '../hooks/game'
import { mapPayload, statePayload } from '../hooks/web'
import type { LogLine } from '../types'

/** The test runner provides a console; the plugin types do not declare one. */
declare const console: { log: (...args: unknown[]) => void }

test('record the browser scenes', async () => {
  const w = createWorld()
  w.requests = []
  w.events = []
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
  const setTime = (day: number, hour: number) => { w.day = day; w.minutes = hour * 60 }
  const put = (who: VillagerId, x: number, y: number) => Object.assign(w.npcs[who], { x, y, path: [], hold: 300 })
  const plan = (actions: Action[]) => enqueue(w, actions)
  const calm = (x: World) => {
    x.events = []; x.weather = 'clear'; x.critters = []; x.queue = []; x.current = undefined
    x.player.bubble = undefined
    for (const v of Object.values(x.npcs)) v.bubble = undefined
  }

  for (const id of ['lamps', 'benches', 'park'] as const) { w.projects[id].done = true; applyProject(w, id) }

  // 1. A spring morning: Claude leaves home and says hello to Rosa
  calm(w)
  setTime(3, 8.5)
  w.player.x = w.places.home.x
  w.player.y = w.places.home.y
  put('rosa', w.places.home.x + 5, w.places.home.y + 3)
  put('pip', w.places.home.x - 3, w.places.home.y + 3)
  scene('Spring morning')
  plan([
    { do: 'say', text: 'Good morning, village!' },
    { do: 'walk', to: 'rosa' },
    { do: 'npc_say', who: 'rosa', text: 'Claude! The tulips smell lovely today.' },
    { do: 'say', text: 'Want to go fishing later?' },
  ])
  shoot(36)

  // 2. Dusk on the plaza: the lamps come on around the fountain
  calm(w)
  setTime(10, 18.6)
  w.player.x = w.places.plaza.x - 5
  w.player.y = w.places.plaza.y
  put('mabel', w.places.plaza.x + 3, w.places.plaza.y + 2)
  put('bruno', w.places.plaza.x + 2, w.places.plaza.y - 1)
  scene('Dusk on the plaza')
  plan([{ do: 'walk', to: 'plaza' }, { do: 'say', text: 'The lamps look so cozy tonight.' }, { do: 'npc_say', who: 'mabel', text: 'Pie at the cafe, dear?' }])
  shoot(30)

  // 3. Autumn rain at the river
  calm(w)
  setTime(17, 14)
  w.weather = 'rain'
  w.player.x = w.places.river.x
  w.player.y = w.places.river.y
  put('tom', w.places.river.x - 3, w.places.river.y + 1)
  scene('Autumn rain')
  plan([{ do: 'say', text: 'A little rain never stopped a fisher!' }, { do: 'npc_say', who: 'tom', text: 'The fish bite best in the rain!' }, { do: 'fish' }])
  shoot(30)

  // 4. Winter: snow on the roofs, and a chat by the shop
  calm(w)
  setTime(24, 11)
  w.weather = 'rain'
  w.player.x = w.places.shop.x - 3
  w.player.y = w.places.shop.y + 2
  put('pip', w.places.shop.x + 2, w.places.shop.y + 2)
  scene('Snow')
  plan([{ do: 'say', text: 'Brr! First snow of the year!' }, { do: 'npc_say', who: 'pip', text: 'Snowball fight!!' }, { do: 'walk', to: 'cafe' }])
  shoot(30)
})
