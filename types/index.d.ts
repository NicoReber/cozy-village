/** `who` is `you`, `claude`, `event`, `mochi` or a villager's id. */
export type LogLine = { who: string; text: string }
/** Which view the panel under the map shows. */
export type Tab = 'chat' | 'memories' | 'village'

declare module 'claude-code' {
  interface PluginState {
    'cozy-village': { log: LogLine[]; thinking: boolean; tab: Tab; reply: string }
  }
}
