export type Reaction = { text: string; untilTick: number; eyes?: string }

export type Companion = {
  name: string
  personality: string
  hatchedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'buddy-revival': {
      tick: number
      reaction: Reaction | null
      petAtTick: number | null
      companion: Companion | null
      belly: number | null
    }
  }
}
