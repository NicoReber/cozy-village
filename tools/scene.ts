// The scripted scenes behind docs/village.gif. tools/render_gif.py copies this file into tests/ for one run of
// `claude plugin test`, reads the frames it prints and draws them into an animated GIF.

import { test } from 'claude-code/testing'

import { applyProject, createWorld, encode, enqueue, frame, step } from '../hooks/game'
import type { Action, VillagerId, World } from '../hooks/game'

const COLS = 80
/** The test runner provides a console; the plugin types do not declare one. */
declare const console: { log: (...args: unknown[]) => void }

test('record the README scenes', async () => {
  const w = createWorld()
  w.requests = []
  w.events = []

  const scene = (label: string) => console.log(`SCENE ${label}`)
  const shoot = (frames: number, stepsPerFrame = 2) => {
    for (let i = 0; i < frames; i++) {
      for (let k = 0; k < stepsPerFrame; k++) step(w)
      console.log(`FRAME ${encode(frame(w, COLS))}`)
    }
  }
  const setTime = (day: number, hour: number) => {
    w.day = day
    w.minutes = hour * 60
  }
  const put = (who: VillagerId, x: number, y: number) => {
    const n = w.npcs[who]
    n.x = x
    n.y = y
    n.path = []
    n.hold = 200
  }
  const plan = (actions: Action[]) => enqueue(w, actions)
  const calm = (x: World) => { x.events = []; x.weather = 'clear'; x.critters = [] }

  // 1. A spring morning: Claude says hello and walks over to Rosa
  calm(w)
  setTime(3, 9)
  w.player.x = w.places.plaza.x - 6
  w.player.y = w.places.plaza.y - 2
  put('rosa', w.places.plaza.x + 4, w.places.plaza.y + 1)
  put('tom', w.places.plaza.x - 2, w.places.plaza.y + 3)
  scene('Spring morning on the plaza')
  plan([
    { do: 'say', text: 'Good morning, village!' },
    { do: 'walk', to: 'rosa' },
    { do: 'npc_say', who: 'rosa', text: 'Claude! The tulips smell lovely today.' },
    { do: 'say', text: 'Want to go fishing later?' },
  ])
  shoot(55)

  // 2. Summer rain at the pond, with a catch
  calm(w)
  setTime(10, 13)
  w.weather = 'rain'
  w.player.x = w.places.pond.x
  w.player.y = w.places.pond.y
  put('tom', w.places.pond.x - 3, w.places.pond.y)
  scene('Summer rain at the pond')
  plan([{ do: 'say', text: 'A little rain never stopped a fisher!' }, { do: 'fish' }])
  shoot(50)

  // 3. Fireworks night on the plaza, under the new street lamps
  calm(w)
  setTime(11, 20.6)
  w.projects.lamps.done = true
  applyProject(w, 'lamps')
  w.events = [{ kind: 'season', start: 20 * 60, end: 22.5 * 60, started: true }]
  w.player.x = w.places.plaza.x
  w.player.y = w.places.plaza.y + 1
  put('pip', w.places.plaza.x - 3, w.places.plaza.y + 2)
  put('mabel', w.places.plaza.x + 3, w.places.plaza.y + 2)
  put('bruno', w.places.plaza.x + 2, w.places.plaza.y)
  scene('Fireworks night')
  plan([{ do: 'say', text: 'Ooooh! Look at that one!' }, { do: 'npc_say', who: 'pip', text: 'BEST. NIGHT. EVER!' }])
  shoot(45)

  // 4. Autumn: leaves fall while Claude chops wood
  calm(w)
  setTime(17, 11)
  w.player.x = 24
  w.player.y = 8
  scene('Autumn in the orchard')
  plan([{ do: 'say', text: 'Wood for the pier!' }, { do: 'chop', count: 2 }])
  shoot(45)

  // 5. Winter: snow, smoke from the chimney, a frozen pond
  calm(w)
  setTime(24, 16)
  w.weather = 'rain'
  w.player.x = w.places.home.x + 2
  w.player.y = w.places.home.y + 1
  put('mabel', w.places.home.x + 6, w.places.home.y + 2)
  scene('Snow at home')
  plan([{ do: 'say', text: 'Brr! First snow of the year!' }, { do: 'npc_say', who: 'mabel', text: 'Come by the cafe for something hot, dear.' }])
  shoot(45)
})
