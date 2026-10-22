/** `who` is `you`, `claude`, `event`, `mochi` or a villager's id. */
export type LogLine = { who: string; text: string }
/** Which view the panel under the map shows. */
export type Tab = 'chat' | 'memories' | 'village'
/** The Memories and Village tabs' data, as the village server sends it (hooks/web.ts `infoPayload`). */
export type Info = {
  /** The office's apprentices, one per open Claude Code session. */
  office: { name: string; color: string; repo: string; branch: string; status: 'idle' | 'working' | 'done' | 'error'; tool: string }[]
  projects: { name: string; about: string; done: boolean; bells: number; need: number; items: { name: string; have: number; need: number }[]; pct: number }[]
  museum: { open: boolean; reward: number; sections: { name: string; have: number; total: number; pieces: { name: string; got: boolean }[] }[] }
  requests: { who: string; color: string; item: string; left: number; reward: number; done: boolean }[]
  people: { name: string; color: string; hearts: number | null; diary: string; facts: string[] }[]
}

declare module 'claude-code' {
  interface PluginState {
    'cozy-village': { log: LogLine[]; thinking: boolean; tab: Tab; reply: string; web: string; info: Info | null; museum: { open: boolean; inside: boolean }; office: { staff: number; inside: boolean } }
  }
}
