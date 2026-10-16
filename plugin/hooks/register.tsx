// buddy-revival — brings back the Claude Code companion, including YOUR original one.
// Bones (species/rarity/eyes/hat/shiny/stats) are re-derived from the account id with
// the original algorithm (Bun.hash = zig wyhash, low 32 bits + mulberry32 + salt).
// Art is redrawn — original-inspired, not the original frames.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Companion, Reaction } from '../types'

// ---------- deterministic derivation (original algorithm, clean-room) ----------

const SALT = 'friend-2026-401'

// ponytail: manual UTF-8 encoder — TextEncoder availability in the mod env is unverified
function utf8(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

// zig std.hash.Wyhash (what Bun.hash uses), seed 0 — verified against Bun.hash 1.3.14
const M = 0xffffffffffffffffn
const S0 = 0xa0761d6478bd642fn
const S1 = 0xe7037ed1a0b428dbn
const S2 = 0x8ebc6af09c88c6e3n
const S3 = 0x589965cc75374cc3n
const mix = (a: bigint, b: bigint) => {
  const r = (a & M) * (b & M)
  return ((r >> 64n) ^ r) & M
}
function wyhash(bytes: number[]): bigint {
  const len = bytes.length
  const r8 = (i: number) => {
    let v = 0n
    for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(bytes[i + k])
    return v
  }
  const r4 = (i: number) =>
    BigInt(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16)) | (BigInt(bytes[i + 3]) << 24n)
  let state = mix(0n ^ S0, S1) // seed 0
  let a = 0n
  let b = 0n
  if (len <= 16) {
    if (len >= 4) {
      const end = len - 4
      const quarter = (len >> 3) << 2
      a = ((r4(0) << 32n) | r4(quarter)) & M
      b = ((r4(end) << 32n) | r4(end - quarter)) & M
    } else if (len > 0) {
      a = (BigInt(bytes[0]) << 16n) | (BigInt(bytes[len >> 1]) << 8n) | BigInt(bytes[len - 1])
    }
  } else {
    let i = 0
    if (len >= 48) {
      let s0 = state
      let s1 = state
      let s2 = state
      while (i + 48 < len) {
        s0 = mix(r8(i) ^ S1, r8(i + 8) ^ s0)
        s1 = mix(r8(i + 16) ^ S2, r8(i + 24) ^ s1)
        s2 = mix(r8(i + 32) ^ S3, r8(i + 40) ^ s2)
        i += 48
      }
      state = (s0 ^ s1 ^ s2) & M
    }
    while (i + 16 < len) {
      state = mix(r8(i) ^ S1, r8(i + 8) ^ state)
      i += 16
    }
    a = r8(len - 16)
    b = r8(len - 8)
  }
  a = (a ^ S1) & M
  b = (b ^ state) & M
  const r = a * b
  return mix((r & M) ^ S0 ^ BigInt(len), ((r >> 64n) & M) ^ S1)
}

function mulberry32(seed: number) {
  let K = seed >>> 0
  return function () {
    K |= 0
    K = (K + 1831565813) | 0
    let t = Math.imul(K ^ (K >>> 15), 1 | K)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin', 'turtle',
  'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot', 'rabbit', 'mushroom', 'chonk',
] as const
type Species = (typeof SPECIES)[number]
const EYES = ['\u00b7', '\u2726', '\u00d7', '\u25c9', '@', '\u00b0'] as const
const HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'] as const
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
type Rarity = (typeof RARITIES)[number]
const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }
const RARITY_BASE: Record<Rarity, number> = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }
const RARITY_STARS: Record<Rarity, string> = {
  common: '\u2605', uncommon: '\u2605\u2605', rare: '\u2605\u2605\u2605',
  epic: '\u2605\u2605\u2605\u2605', legendary: '\u2605\u2605\u2605\u2605\u2605',
}
const RARITY_COLOR: Record<Rarity, string | undefined> = {
  common: undefined, uncommon: 'green', rare: 'cyan', epic: 'magenta', legendary: 'yellow',
}
const STATS = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'] as const
const FALLBACK_NAMES = ['Crumpet', 'Soup', 'Pickle', 'Biscuit', 'Moth', 'Gravy']

export type Bones = {
  rarity: Rarity
  species: Species
  eye: string
  hat: string
  shiny: boolean
  stats: Record<string, number>
  inspirationSeed: number
}

export function deriveBones(id: string): Bones {
  const seed32 = Number(wyhash(utf8(id + SALT)) & 0xffffffffn)
  const rng = mulberry32(seed32)
  let roll = rng() * 100
  let rarity: Rarity = 'common'
  for (const r of RARITIES) {
    if (roll < RARITY_WEIGHT[r]) {
      rarity = r
      break
    }
    roll -= RARITY_WEIGHT[r]
  }
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]
  const species = pick(SPECIES)
  const eye = pick(EYES)
  const hat = rarity === 'common' ? 'none' : pick(HATS)
  const shiny = rng() < 0.01
  // ponytail: stat draw order unverified against the original; visual identity
  // (rarity/species/eye/hat/shiny) is drawn before stats so it is exact regardless
  const base = RARITY_BASE[rarity]
  const bi = Math.floor(rng() * 5)
  let wi = Math.floor(rng() * 5)
  while (wi === bi) wi = Math.floor(rng() * 5)
  const stats: Record<string, number> = {}
  for (let i = 0; i < 5; i++) {
    if (i === bi) stats[STATS[i]] = Math.min(100, base + 50 + Math.floor(rng() * 30))
    else if (i === wi) stats[STATS[i]] = Math.max(1, base - 10 + Math.floor(rng() * 15))
    else stats[STATS[i]] = base + Math.floor(rng() * 40)
  }
  const inspirationSeed = Math.floor(rng() * 1e9)
  return { rarity, species, eye, hat, shiny, stats, inspirationSeed }
}

// ---------- art (redrawn, original-inspired; {E} = eye placeholder) ----------

const ART: Record<Species, string[]> = {
  duck: ['   __', ' <({E})', '  ~^^~'],
  goose: ['  (\\', '  ({E})__', '   ^ ^'],
  blob: [' .---.', '( {E} {E} )', " '---'"],
  cat: [' /\\_/\\', '( {E}.{E} )', ' > ^ <'],
  dragon: ['  /\\/\\', ' ({E}~{E})>', '  \\/\\/'],
  octopus: ['  .--.', ' ( {E}{E} )', ' ~~~~~~'],
  owl: ['  ,_,', ' ({E},{E})', '  " "'],
  penguin: ['  .-.', ' ({E}>)', '  |_|'],
  turtle: ['  ,--.', ' [{E}_{E}])', '  ~~~~'],
  snail: ['  @__', ' ({E})  \\', '  ~~~~'],
  ghost: [' .---.', '| {E} {E} |', ' \\,,,/'],
  axolotl: [' }\\_/{', ' }{E}.{E}{', '  ~u~'],
  capybara: ['   ___', ' ({E}oo{E})', "  '--'"],
  cactus: ['   _|_', ' |{E} {E}|', '   |||'],
  robot: [' [---]', ' [{E}_{E}]', '  d b'],
  rabbit: ['  (\\(\\', '  ({E}.{E})', '  (")(")'],
  mushroom: ['  .-"-.', ' ( ___ )', '  |{E}{E}|'],
  chonk: [' .-----.', '( {E} . {E} )', " '-----'"],
}

const MINI: Record<Species, string> = {
  duck: '({E}>', goose: '({E})>', blob: '({E}{E})', cat: '^{E}.{E}^', dragon: '<{E}~{E}>',
  octopus: '~({E}{E})~', owl: '({E},{E})', penguin: '({E}>|', turtle: '[{E}_{E}]',
  snail: '@({E})', ghost: '\\{E}{E}/', axolotl: '}{E}.{E}{', capybara: '({E}oo{E})',
  cactus: '|{E}_{E}|', robot: '[{E}{E}]', rabbit: '({E}..{E})', mushroom: '({E}{E})', chonk: '({E}.{E})',
}

const HAT_ROW: Record<string, string> = {
  crown: '  \\VVV/', tophat: '  [===]', propeller: '  --o--', halo: '  (---)',
  wizard: '   /^\\', beanie: '  (~~~)', tinyduck: '   <.',
}

// idle rhythm: mostly still, an occasional sway (1) and blink (-1)
const IDLE_SEQ = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0]
const REACTION_TICKS = 20 // 10s at 500ms

function spriteLines(bones: Bones, frame: number): string[] {
  const eye = frame === -1 ? '-' : bones.eye
  const lines = ART[bones.species].map(l => {
    const filled = l.split('{E}').join(eye)
    return frame === 1 ? ' ' + filled : filled
  })
  if (bones.hat !== 'none' && HAT_ROW[bones.hat]) lines.unshift(HAT_ROW[bones.hat])
  return lines
}

function miniFace(bones: Bones): string {
  return MINI[bones.species].split('{E}').join(bones.eye)
}

// ---------- reactions (canned, zero tokens by default) ----------

const POOLS: Record<string, string[]> = {
  hatch: ['oh. hi. i live here now.', '*looks around* nice terminal.', 'hatched. what did i miss?'],
  pet: ['*happy wiggle*', 'ok, ok. back to work.', '*accepts the pet, graciously*', 'again.'],
  'test-fail': ['the tests disagree with you.', 'red. very red.', 'i saw that coming, honestly.', '*pretends not to look*'],
  error: ["that's an error. just saying.", '*squints at the stack trace*', 'bold strategy.', 'we have logs for a reason.'],
  'large-diff': ["that's... a lot of lines.", 'big diff energy.', "you're reviewing all that, right?"],
  addressed: ['you rang?', '*perks up*', "i'm listening.", "yes. that's my name."],
  stuffed: ["i'm so full. /compact?", '*can’t eat another token*', 'context: stuffed. maybe /compact.'],
  digest: ['*burp* much better.', 'all digested. hungry again.', 'ahh. light as a fresh session.'],
  treat: ['*nom nom*', 'a treat! for me?', '*crunch* ok that was good.'],
  'too-full': ['no room. /compact first.', '*shakes head* too full.'],
  levelup: ['level up! i feel wiser.', '*glows a little* level up.', 'i grew. did you notice?'],
  missed: ['you’re back! i counted the pixels.', 'oh hi. it’s been a while.', '*dusts self off* welcome back.'],
  done: ['done! come look.', '*taps glass* it finished.', 'turn over. your move.'],
  waiting: ['psst. it needs a yes.', '*taps glass* permission?', 'you there? claude is waiting.'],
  danger: ['o_o you sure?', '*covers eyes*', 'that one can’t be undone...'],
  break: ['mola? stretch a wing.', '90 min straight. water?', '*yawn* break time?'],
  'break-night': ['it’s late. bugs will wait.', 'me sleepy. you sleepy. bed?'],
}

// destructive shell commands: the buddy only flinches, it never blocks
const DANGER = /\brm\s+-[a-z]*(rf|fr)|\brm\s+-[a-z]*r[a-z]*\s+-[a-z]*f|\bgit\s+push\b[^\n]*(--force|\s-f\b)|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-[a-z]*f|\bdrop\s+(table|database)\b|\bmkfs\b|\bdd\s+if=|\bchmod\s+-R\s+777/i
const PASSED = /\b\d+ (passed|passing)\b|\ball tests passed\b|^PASS\b|\bOK \(\d+ tests?\)|\b0 failed\b/im
const FAILED = /\b[1-9]\d* (failed|failing)\b|\btests? failed\b|^FAIL(ED)?\b| ✗ | ✘ /im
const MIN = 60_000

// idle chatter: cute, a little dumb, keyed to how the buddy feels right now
const CHATTER: Record<string, string[]> = {
  hungry: ['me hungry.', 'feed me tokens pls', '*stomach go grrr*', 'snack time? snack time.', 'me could eat a whole README.'],
  content: ['me ok. me happy.', 'i watch you type. good typing.', 'hoot.', 'what button do.', 'me guard the code. no bugs pass.'],
  full: ['belly big. nap soon.', 'too many tokens. worth it.', '*waddles slowly*'],
  stuffed: ['me too full. /compact?', 'no more context. me pop.', '*lies down dramatically*'],
  happy: ['you nice. me like you.', '*does a little dance*', 'best human.'],
  night: ['why awake. me sleepy.', 'is dark. bugs come out at night.', '*yawn*'],
}
const CHATTER_MIN_TICKS = 240 // 2 min at 500ms
const CHATTER_JITTER_TICKS = 360 // + up to 3 min

// ---------- tamagotchi layer: zero-maintenance, never punishes ----------
// belly = the session's context fill (it eats your tokens); /compact digests it.
// level grows from activity; the derived stats stay fixed so the original buddy stays exact.

function bellyLabel(p: number | null): string {
  if (p === null || p < 15) return 'hungry'
  if (p < 60) return 'content'
  if (p < 85) return 'full'
  return 'stuffed'
}
const bellyBar = (p: number | null) => {
  const n = Math.min(5, Math.round((p ?? 0) / 20))
  return '▰'.repeat(n) + '▱'.repeat(5 - n)
}
// context meter: the real gauge behind the belly
let ctxTokens: number | null = null
let ctxWindow = 0
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
export function ctxMeter(p: number | null, tokens: number | null, window: number, cells = 10) {
  const n = Math.min(cells, Math.round(((p ?? 0) / 100) * cells))
  const bar = '\u2588'.repeat(n) + '\u2591'.repeat(cells - n)
  const color = (p ?? 0) >= 85 ? 'red' : (p ?? 0) >= 60 ? 'yellow' : 'green'
  const amount = tokens !== null && window ? ` ${short(tokens)}/${short(window)}` : ''
  return { bar, color, label: p === null ? 'ctx --' : `ctx ${p}%${amount}` }
}
// session gauges beside the context meter: effort level and live agents
let effortLevel: string | null = null
let agentsWorking = 0
let modelId: string | null = null
let effortFrom = 'none'
let stepsSeen = 0
let lastStepEffort: unknown = undefined
let modelFrom = 'none'
// claude-opus-5-5 -> Opus 5.5, claude-haiku-5-5[1m] -> Haiku 5.5; anything else as given
export function modelName(id: string | null): string | null {
  if (!id) return null
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}
const EFFORT_GLYPH: Record<string, string> = { low: '\u25d4', medium: '\u25d0', high: '\u25d5', xhigh: '\u25cf', max: '\u25c9' }
export const effortLine = (level: string | null) => (level ? `${EFFORT_GLYPH[level] ?? '\u25cb'} ${level} \u00b7 /effort` : null)
export const agentsLine = (n: number) => (n > 0 ? `${n} agent${n === 1 ? '' : 's'} working` : null)
const LIVE = new Set(['pending', 'running', 'waiting'])
export const levelOf = (xp: number) => Math.floor(Math.sqrt(xp / 5)) + 1
// share of the way from this level to the next (level L starts at 5*(L-1)^2 xp)
export function levelProgress(xp: number): number {
  const l = levelOf(xp)
  const from = 5 * (l - 1) ** 2
  return (xp - from) / (5 * l ** 2 - from)
}
const levelBar = (xp: number) => {
  const n = Math.min(5, Math.floor(levelProgress(xp) * 5))
  return '\u25b0'.repeat(n) + '\u25b1'.repeat(5 - n)
}
const DAY = 86_400_000

function pickLine(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)]
}

// ---------- the mod ----------

const tickA = atom({ plugin: 'buddy-revival', key: 'tick' } as const, 0)
const reactionA = atom({ plugin: 'buddy-revival', key: 'reaction' } as const, null)
const petA = atom({ plugin: 'buddy-revival', key: 'petAtTick' } as const, null)
const companionA = atom({ plugin: 'buddy-revival', key: 'companion' } as const, null)
const bellyA = atom({ plugin: 'buddy-revival', key: 'belly' } as const, null)

// module state, re-initialized each (re)load by session.start
let bones: Bones | null = null
let muted = false
let bandHidden = false
let lastReactAt = -1000
let isCompanionFromClaudeJson = false
let llmQuipsOn = false
let xp = 0
let lastCareAt = 0
let soundsOn = true
let paneOpen = false
// the engine draws no [+] once its band is collapsed, and tells hooks nothing:
// a band that stopped rendering (it redraws every tick while shown) reads as collapsed
let lastBandTick = 0
let hidingHint = false
let hasBand = true
let BAND_KEY = 'ctrl+x ctrl+a'
const TOGGLE = 'abovePrompt:toggle'

type Bindings = { bindings?: { context?: string; bindings?: Record<string, string | null> }[] }

// the Chat-context key the person bound to the band toggle, if any
export function boundBandKey(text: string | null): string | null {
  try {
    const cfg = JSON.parse(text ?? '') as Bindings
    for (const block of cfg.bindings ?? []) {
      if (block.context !== 'Chat') continue
      for (const [k, a] of Object.entries(block.bindings ?? {})) if (a === TOGGLE) return k
    }
  } catch {
    /* no file or not JSON */
  }
  return null
}

// drop every Chat binding to the band toggle; null when there was nothing to drop
export function removeBandKey(text: string | null): string | null {
  try {
    const cfg = JSON.parse(text ?? '') as Bindings
    let dropped = false
    for (const block of cfg.bindings ?? []) {
      if (block.context !== 'Chat' || !block.bindings) continue
      for (const [k, a] of Object.entries(block.bindings)) if (a === TOGGLE) {
        delete block.bindings[k]
        dropped = true
      }
    }
    return dropped ? JSON.stringify(cfg, null, 2) + '\n' : null
  } catch {
    return null
  }
}

const keybindingsPath = async ($: Engine) => `${await $.env.get('HOME')}/.claude/keybindings.json`
async function readKeybindings($: Engine): Promise<string | null> {
  try {
    return String(await $.fs.read(await keybindingsPath($)))
  } catch {
    return null
  }
}

// once per person: give the band a one-key toggle (ctrl+b) unless it can't be done cleanly
async function autoBandKey($: Engine, name: string) {
  if (await storeGet($, 'keyOffered')) return
  try {
    if (!(await $.env.get('HOME'))) return
  } catch {
    return
  }
  await storeSet($, 'keyOffered', true) // never again, even if they remove it later
  const current = await readKeybindings($)
  if (boundBandKey(current)) return
  try {
    if (await $.env.get('TMUX')) return // ctrl+b is tmux's prefix; /buddy key picks another
  } catch {
    /* no env access: go on */
  }
  const merged = addBandKey(current, 'ctrl+b')
  if ('error' in merged) return
  try {
    await $.fs.write(await keybindingsPath($), merged.text)
    BAND_KEY = 'ctrl+b'
    $.ui.toast(`ctrl+b now shows/hides ${name} \u00b7 /buddy key off to undo`)
  } catch {
    /* read-only home: hints keep the default chord */
  }
}

// merge `key -> abovePrompt:toggle` into keybindings.json text; never clobbers another binding
export function addBandKey(text: string | null, key: string): { text: string } | { error: string } {
  let cfg: Bindings
  if (!text || !text.trim()) cfg = {}
  else {
    try {
      cfg = JSON.parse(text)
    } catch {
      return { error: 'keybindings.json is not plain JSON (comments?); add it by hand' }
    }
  }
  const out = {
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    ...cfg,
    bindings: [...(cfg.bindings ?? [])],
  }
  let chat = out.bindings.find(b => b.context === 'Chat')
  if (!chat) out.bindings.push((chat = { context: 'Chat', bindings: {} }))
  const taken = chat.bindings?.[key]
  if (taken && taken !== TOGGLE) return { error: `${key} is already bound to ${taken}` }
  chat.bindings = { ...chat.bindings, [key]: TOGGLE }
  return { text: JSON.stringify(out, null, 2) + '\n' }
}
const PANE_ID = 'buddy'
let limitPct = 0 // highest rate-limit window fill, 0-100
let limitLevel = 0 // 0 / 80 / 95: which warning was given
let activeSince = 0
let lastActiveAt = 0
let lastBreakAt = 0
let lastTrouble = '' // tail of the last failing output, for /buddy ask
let pendingFail = false

type Day = { date: string; tools: number; turns: number; fails: number; fixed: number; danger: number }
const today = () => new Date().toISOString().slice(0, 10)
let day: Day = { date: today(), tools: 0, turns: 0, fails: 0, fixed: 0, danger: 0 }

// ponytail: hook $'s precise type lands with the engine-laid claude-code types; any until then
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Engine = any

// store is a convenience, never load-bearing: a failed read/write must not skip the hook
async function storeGet($: Engine, key: string): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}
async function storeSet($: Engine, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    /* companion state still lives in $.state for this session */
  }
}

type ReactOpts = { text?: string; eyes?: string; ticks?: number }

async function react($: Engine, trigger: keyof typeof POOLS, bypassLimit = false, opts: ReactOpts = {}) {
  const now = (await read($, tickA)) ?? 0
  // user-initiated reactions (hatch/pet/name) don't spend the 30s budget of spontaneous ones
  if (!bypassLimit) {
    if (now - lastReactAt < 60) return // 30s in 500ms ticks
    lastReactAt = now
  }
  let text = opts.text ?? pickLine(POOLS[trigger] ?? POOLS.addressed)
  if (llmQuipsOn && !opts.text) {
    try {
      const comp = await read($, companionA)
      const r = await $.model.complete({
        model: 'haiku',
        prompt: `You are ${comp?.name ?? 'a terminal companion'}, a small ${bones?.species ?? 'creature'} living in a developer's terminal. Personality: ${comp?.personality ?? 'dry, kind'}. Event: ${trigger}. Reply with ONE short reaction line (max 50 chars), lowercase, no quotes.`,
      })
      if (r?.isAnswered && r.text) text = String(r.text).trim().slice(0, 60)
    } catch {
      // ponytail: model call is best-effort; canned line already set
    }
  }
  const t = await read($, tickA)
  await update($, reactionA, () => ({ text, untilTick: (t ?? 0) + (opts.ticks ?? REACTION_TICKS), eyes: opts.eyes }) as Reaction)
}

let lastChirpAt = 0
let chirpedThisWait = false // reset when the person sends a prompt
let chirpAfterTurnMs: number | null = 30_000
let chirpOnPermission = true
let chirpWhenWaiting = true
let chirpOncePerWait = true
async function chirp($: Engine, why: string) {
  const now = Date.now()
  const skip = !soundsOn ? 'sounds off' : now - lastChirpAt < 3_000 ? 'chirped <3s ago (same moment)' : ''
  if (!skip) lastChirpAt = now
  let result = skip ? `skipped (${skip})` : 'played'
  if (!skip) {
    try {
      await $.audio.play({ asset: 'sounds/chirp.wav' })
    } catch (err) {
      result = `failed: ${String((err as Error)?.message ?? err)}` // e.g. no player on Linux/Windows
    }
  }
  try {
    $.ui.log(`buddy-revival chirp ${why}: ${result}`, { to: 'debug' })
  } catch {
    /* logging is best-effort */
  }
}

async function bumpDay($: Engine, k: keyof Omit<Day, 'date'>) {
  if (day.date !== today()) day = { date: today(), tools: 0, turns: 0, fails: 0, fixed: 0, danger: 0 }
  day[k]++
  await storeSet($, 'day', day)
}

function daySummary(name: string): string {
  const { tools, turns, fails, fixed, danger } = day
  if (!tools && !turns) return `${name}: quiet day so far. me napped.`
  const parts = [`${turns} turns`, `${tools} tool calls`]
  if (fails) parts.push(`${fails} red tests, ${fixed} turned green`)
  if (danger) parts.push(`${danger} scary commands (i covered my eyes)`)
  const verdict = fails && fixed >= fails ? 'all green. good job.' : fails ? 'some red left. tomorrow.' : 'smooth day.'
  return `${name}'s day: ${parts.join(', ')}. ${verdict}`
}

async function gainXp($: Engine, n: number) {
  const before = levelOf(xp)
  xp += n
  await storeSet($, 'xp', xp)
  if (levelOf(xp) > before && !muted) {
    $.ui.toast(`⬆ level ${levelOf(xp)}!`)
    await react($, 'levelup', true)
  }
}

async function care($: Engine) {
  lastCareAt = Date.now()
  await storeSet($, 'lastCareAt', lastCareAt)
}

const moodOf = () => (Date.now() - lastCareAt < 2 * 3_600_000 ? 'happy' : 'calm')

function chatterPool(belly: number | null): string[] {
  const hour = new Date().getHours()
  if (hour < 6 && Math.random() < 0.5) return CHATTER.night
  if (moodOf() === 'happy' && Math.random() < 0.3) return CHATTER.happy
  return CHATTER[bellyLabel(belly)]
}

async function chatter($: Engine) {
  const rx = await read($, reactionA)
  const t = (await read($, tickA)) ?? 0
  if (rx && rx.untilTick > t) return // never talk over a reaction
  const text = pickLine(chatterPool(await read($, bellyA)))
  await update($, reactionA, () => ({ text, untilTick: t + REACTION_TICKS }) as Reaction)
}

async function revealCard($: Engine, comp: Companion, b: Bones): Promise<string> {
  const belly = await read($, bellyA)
  const bars = STATS.map(s => {
    const v = b.stats[s] ?? 0
    const n = Math.round(v / 10)
    return `${s.padEnd(10)} ${'\u2588'.repeat(n)}${'\u2591'.repeat(10 - n)} ${v}`
  }).join('\n')
  const shiny = b.shiny ? ' \u2728 SHINY \u2728' : ''
  return [
    ...spriteLines(b, 0),
    '',
    `${RARITY_STARS[b.rarity]}  ${comp.name}${shiny}`,
    `${b.rarity} ${b.species}${b.hat !== 'none' ? ` wearing a ${b.hat}` : ''}`,
    comp.personality,
    '',
    bars,
    '',
    `Lv ${levelOf(xp)} ${levelBar(xp)} \u00b7 mood ${moodOf()} \u00b7 belly ${bellyBar(belly)} ${bellyLabel(belly)}${belly === null ? '' : ` (${ctxMeter(belly, ctxTokens, ctxWindow).label})`}`,
    `energy ${bellyBar(100 - limitPct)} ${limitPct >= 95 ? 'exhausted' : limitPct >= 80 ? 'tired' : 'fresh'}${limitPct ? ` (limit ${limitPct}% used)` : ''}`,
    '',
    `say its name \u00b7 /buddy pet \u00b7 feed \u00b7 ask \u00b7 today \u00b7 off`,
    `${BAND_KEY} hides/shows ${comp.name} above the prompt${BAND_KEY.includes(' ') ? ' (/buddy key ctrl+b for one key)' : ''} \u00b7 /buddy show opens a pane`,
  ].join('\n')
}

// the animated buddy, drawn in the band and in the /buddy show pane
async function drawBuddy($: Engine, e: Engine, comp: Companion, bones: Bones, stacked = false) {
  const t = await read($, tickA)
  const rx = await read($, reactionA)
  const frame = rx?.eyes && rx.untilTick > t ? -1 : IDLE_SEQ[t % IDLE_SEQ.length]
  const lines = spriteLines(bones, frame)
  const petT = await read($, petA)
  const hearts = petT !== null && t - petT < 5
  const color = RARITY_COLOR[bones.rarity]
  const belly = await read($, bellyA)

  const meter = ctxMeter(belly, ctxTokens, ctxWindow)
  const { Box, Text, Button } = $.ui.resolve(e)
  const bubble =
    rx && rx.untilTick > t ? (
      <Box flexDirection={stacked ? 'column' : 'row'} alignItems={stacked ? 'flex-start' : 'center'}>
        <Box borderStyle="round" borderColor={color} borderDimColor={!color} paddingX={1}>
          <Text>{rx.text}</Text>
        </Box>
        <Text dimColor>{stacked ? '  \u2572' : '\u2500 '}</Text>
      </Box>
    ) : null
  // desktop is wide: keep the last thing it said as a dim thought, and give the band a close control
  const roomy = !stacked && e.surface === 'desktop'
  const thought = roomy && !bubble ? (rx?.text ?? chatterPool(belly)[0]) : null
  const hide = roomy ? (
    <Box alignSelf="flex-start" marginLeft={2}>
      <Button key="hide" role="dismiss" label={'\u2715'} plain dimColor onPress={async () => {
        bandHidden = true
        await storeSet($, 'bandHidden', true)
      }} />
    </Box>
  ) : null
  const effort = effortLine(effortLevel)
  const agents = agentsLine(agentsWorking)
  const meterLine = (
    <Box flexDirection="column" alignItems="flex-start">
      <Text>
        <Text color={meter.color}>{meter.bar}</Text>
        <Text dimColor> {meter.label}</Text>
        {modelName(modelId) ? <Text color="gray">{'  \u2502  '}</Text> : null}
        {modelName(modelId) ? <Text dimColor>{modelName(modelId)}</Text> : null}
      </Text>
      {effort ? <Text dimColor>{effort}</Text> : null}
      {agents ? <Text color="cyan">{agents}</Text> : null}
    </Box>
  )
  const sprite = (
    <Box flexDirection="column" alignItems="flex-start">
      {hearts ? <Text color="red">{'\u2665 \u2727 \u2665'}</Text> : null}
      <Text color={color} dimColor={!color}>
        {lines.join('\n')}
      </Text>
      <Text dimColor>
        {comp.name}
        {bones.shiny ? ' \u2728' : ''} Lv{levelOf(xp)} {levelBar(xp)}
      </Text>
      {stacked ? meterLine : null}
    </Box>
  )
  if (stacked) {
    return (
      <Box flexDirection="column" alignItems="flex-start">
        {bubble}
        {sprite}
      </Box>
    )
  }
  // the meter sits at the far left, level with the sprite's face: the band gets no taller
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      {meterLine}
      <Box flexDirection="row" alignItems="center">
        {bubble}
        {thought ? <Text dimColor italic>{`\u201c${thought}\u201d  `}</Text> : null}
        {sprite}
        {hide}
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  bones = null
  muted = false
  bandHidden = false
  lastReactAt = -1000
  isCompanionFromClaudeJson = false
  xp = 0
  lastCareAt = 0
  limitPct = 0
  limitLevel = 0
  activeSince = lastActiveAt = Date.now()
  lastBreakAt = 0
  lastTrouble = ''
  pendingFail = false
  paneOpen = false
  lastBandTick = 0
  lastChirpAt = 0
  effortLevel = null
  modelId = null
  effortFrom = modelFrom = 'none'
  stepsSeen = 0
  lastStepEffort = undefined
  agentsWorking = 0
  BAND_KEY = 'ctrl+x ctrl+a'
  hidingHint = false
  hasBand = true
  const o = (options ?? {}) as Record<string, unknown>
  const after = String(o.chirpAfterTurn ?? '30s')
  chirpAfterTurnMs = after === 'never' ? null : (parseInt(after, 10) || 30) * 1000
  chirpOnPermission = o.chirpOnPermission !== false
  chirpWhenWaiting = o.chirpWhenWaiting !== false
  chirpOncePerWait = o.chirpOncePerWait !== false
  soundsOn = (options as { sounds?: boolean } | undefined)?.sounds !== false

  const compact = Boolean((options as { compact?: boolean } | undefined)?.compact)
  llmQuipsOn = Boolean((options as { llmQuips?: boolean } | undefined)?.llmQuips)
  const llmQuips = llmQuipsOn

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'buddy',
      description: 'Your coding companion: /buddy [show|hide|pet|feed|ask|today|sound|key|stats|rename <name>|off|on]',
    })

    // resolve companion: original home (~/.claude.json) wins, then our own store
    try {
      const home = await $.env.get('HOME')
      const raw = await $.fs.read(`${home}/.claude.json`)
      const cfg = JSON.parse(String(raw))
      const id: string = cfg?.oauthAccount?.accountUuid ?? cfg?.userID ?? 'anon'
      bones = deriveBones(id)
      if (cfg?.companion?.name) {
        isCompanionFromClaudeJson = true
        await update($, companionA, () => cfg.companion as Companion)
      }
      if (cfg?.companionMuted) muted = true
    } catch {
      bones = deriveBones('anon')
    }
    if (!isCompanionFromClaudeJson) {
      const stored = (await storeGet($, 'companion')) as Companion | null
      if (stored) await update($, companionA, () => stored)
    }
    if (await storeGet($, 'muted')) muted = true
    if (await storeGet($, 'bandHidden')) bandHidden = true
    xp = Number(await storeGet($, 'xp')) || 0
    lastCareAt = Number(await storeGet($, 'lastCareAt')) || 0
    const lastSeen = Number(await storeGet($, 'lastSeenAt')) || 0
    await storeSet($, 'lastSeenAt', Date.now())
    const storedDay = (await storeGet($, 'day')) as Day | undefined
    if (storedDay?.date === today()) day = storedDay
    if (lastSeen && Date.now() - lastSeen > 3 * DAY && !muted) await react($, 'missed', true)

    try {
      const kb = await $.fs.read(`${await $.env.get('HOME')}/.claude/keybindings.json`)
      BAND_KEY = boundBandKey(String(kb)) ?? BAND_KEY
      // tmux eats ctrl+b as its prefix before Claude Code sees it: point at the chord instead
      if (BAND_KEY === 'ctrl+b' && (await $.env.get('TMUX'))) BAND_KEY = 'ctrl+x ctrl+a'
    } catch {
      /* default chord */
    }
    const hatchedAlready = await read($, companionA)
    if (hatchedAlready && !muted) await autoBandKey($, hatchedAlready.name)
    try {
      hasBand = (await $.session.surfaces()).some((x: string) => x === 'terminal' || x === 'desktop')
    } catch {
      /* assume a band-drawing surface */
    }
    let nextChatterAt = 60 // first line ~30s in, then every 2-5 min
    $.clock.every(500, async () => {
      const t = await update($, tickA, n => (n ?? 0) + 1)
      if (t >= nextChatterAt) {
        nextChatterAt = t + CHATTER_MIN_TICKS + Math.floor(Math.random() * CHATTER_JITTER_TICKS)
        if (!muted && (await read($, companionA))) await chatter($)
      }
      if (t % 10 === 0) {
        // ponytail: 5s poll of the free usage() call; a context event would be cheaper if one lands
        try {
          const { context } = await $.session.usage()
          const p: number | null = context?.percent ?? null
          ctxTokens = context?.tokens ?? null
          ctxWindow = context?.window ?? 0
          try {
            agentsWorking = (await $.agent.list()).filter((a: { status: string }) => LIVE.has(a.status)).length
          } catch {
            /* no agents noun here */
          }
          if (!effortLevel || !modelId) {
            try {
              const rows = (await $.config.list()) as { key: string; value: unknown }[]
              const row = rows.find(r => /effort/i.test(r.key))
              if (!effortLevel && typeof row?.value === 'string') {
                effortLevel = row.value
                effortFrom = `config ${row.key}`
              }
              const mrow = rows.find(r => r.key === 'model')
              if (!modelId && typeof mrow?.value === 'string' && mrow.value && mrow.value !== 'default') {
                modelId = mrow.value
                modelFrom = 'config model'
              }
            } catch {
              /* turn.step fills it on the next request */
            }
          }
          const prev = await read($, bellyA)
          await update($, bellyA, () => p)
          if (!muted && (await read($, companionA))) {
            if ((prev ?? 0) < 85 && (p ?? 0) >= 85) await react($, 'stuffed', true)
            else if ((prev ?? 0) >= 50 && (p === null || p < 15)) await react($, 'digest', true)
          }
        } catch {
          /* no usage outside a live session */
        }
        // break nudge: continuous work (no 15-min gap) past 90 min, 45 after midnight
        const now = Date.now()
        const late = new Date().getHours() < 5
        if (
          !muted && (await read($, companionA)) &&
          now - lastActiveAt < 5 * MIN &&
          now - activeSince > (late ? 45 : 90) * MIN &&
          now - lastBreakAt > 30 * MIN
        ) {
          lastBreakAt = now
          await react($, late ? 'break-night' : 'break', true, { ticks: 40 })
        }
      }
      if (!compact && hasBand) {
        const comp = await read($, companionA)
        const hidden = Boolean(!muted && !paneOpen && comp && bones && (bandHidden || t - lastBandTick > 6))
        if (hidden && comp && bones) {
          $.ui.status(`${miniFace(bones)} ${comp.name} is hiding \u00b7 ${bandHidden ? '/buddy show' : BAND_KEY} to show`)
          hidingHint = true
        } else if (hidingHint) {
          $.ui.status(undefined)
          hidingHint = false
        }
        if (comp && !hidden && t - lastBandTick <= 2 && !(await storeGet($, 'bandTipShown'))) {
          await storeSet($, 'bandTipShown', true)
          $.ui.toast(`${comp.name} lives above your prompt \u00b7 ${BAND_KEY} hides/shows it`)
        }
      }
      if (compact && !muted) {
        const comp = await read($, companionA)
        if (comp && bones) {
          const rx = await read($, reactionA)
          const bubble = rx && rx.untilTick > (t ?? 0) ? `  "${rx.text}"` : ''
          $.ui.status(`${miniFace(bones)} ${comp.name} ${ctxMeter(await read($, bellyA), ctxTokens, ctxWindow).label}${bubble}`)
        }
      }
    })

    return next(e)
  })

  const touch = () => {
    const now = Date.now()
    if (now - lastActiveAt > 15 * MIN) activeSince = now
    lastActiveAt = now
  }

  on('tool.call', async ($, e, next) => {
    touch()
    const hasBuddy = Boolean(await read($, companionA))
    const cmd = String((e as { input?: { command?: unknown } }).input?.command ?? '')
    if (hasBuddy && e.tool === 'Bash' && DANGER.test(cmd)) {
      await bumpDay($, 'danger')
      if (!muted) await react($, 'danger', true, { eyes: '-', ticks: 12 })
    }
    const ran = await next(e)
    if (!hasBuddy) return ran
    await gainXp($, 1)
    await bumpDay($, 'tools')
    const r = ran as { text?: string; result?: unknown }
    const res = r?.result as { stdout?: string; stderr?: string; text?: string } | string | undefined
    const out = r?.text || (typeof res === 'string' ? res : [res?.stdout, res?.stderr, res?.text].filter(Boolean).join('\n'))
    const failed = FAILED.test(out)
    const errored = !failed && /\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]/i.test(out)
    if (failed || errored) {
      lastTrouble = `$ ${cmd}\n${out.slice(-1500)}`
      if (failed) {
        pendingFail = true
        await bumpDay($, 'fails')
      }
    } else if (pendingFail && PASSED.test(out)) {
      pendingFail = false
      await bumpDay($, 'fixed')
    }
    if (muted) return ran
    if (failed) {
      await react($, 'test-fail')
    } else if (errored) {
      await react($, 'error')
    } else {
      const plus = (out.match(/^\+/gm) ?? []).length
      const minus = (out.match(/^-/gm) ?? []).length
      if (plus + minus > 80) await react($, 'large-diff')
    }
    return ran
  })

  // energy = rate-limit headroom; warn once at 80% and once at 95% of the fullest window
  on('session.measure', async ($, e, next) => {
    const windows = (e as { rateLimits?: { percentUsed: number }[] }).rateLimits ?? []
    if (windows.length) {
      limitPct = Math.round(Math.max(...windows.map(w => w.percentUsed)))
      const level = limitPct >= 95 ? 95 : limitPct >= 80 ? 80 : 0
      if (limitPct < 50) limitLevel = 0
      if (level > limitLevel && !muted && (await read($, companionA))) {
        limitLevel = level
        await react($, 'addressed', true, {
          text: level === 95 ? `*collapses* ${limitPct}% of the limit. pace yourself.` : `me tired... ${limitPct}% of the limit used.`,
          ticks: 40,
        })
      }
    }
    return next(e)
  })

  // the effort the main loop actually sends (after /effort or a model downgrade)
  on('turn.step', async function* ($, e, next) {
    const ev = e as { agentId?: string; effort?: string | number }
    if (!ev.agentId) {
      stepsSeen++
      lastStepEffort = ev.effort
    }
    if (!ev.agentId && typeof ev.effort === 'string') {
      effortLevel = ev.effort
      effortFrom = 'turn.step'
    }
    if (!ev.agentId && (e as { model?: string }).model) {
      modelId = (e as { model?: string }).model ?? modelId
      modelFrom = 'turn.step'
    }
    return yield* next(e)
  })

  // a long main-loop turn finished: chirp and wave you back
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const ev = e as { agentId?: string; durationMs?: number; reason?: string }
    if (!ev.agentId && (await read($, companionA))) {
      await bumpDay($, 'turns')
      const quietThisWait = chirpOncePerWait && chirpedThisWait
      if (!muted && ev.reason === 'answer' && chirpAfterTurnMs !== null && (ev.durationMs ?? 0) > chirpAfterTurnMs && !quietThisWait) {
        chirpedThisWait = true
        await chirp($, `turn done (${Math.round((ev.durationMs ?? 0) / 1000)}s)`)
        await react($, 'done', true)
      }
    }
    return done
  })

  // the engine notifies when Claude needs permission, or has been waiting on you a while
  // (your window in the background): one chirp per waiting moment, every permission ask
  on('ui.notify', async ($, e, next) => {
    const text = String((e as { text?: string }).text ?? '')
    const permission = /permission|approv/i.test(text)
    const wanted = permission ? chirpOnPermission : chirpWhenWaiting && !(chirpOncePerWait && chirpedThisWait)
    if (!muted && wanted && (await read($, companionA))) {
      chirpedThisWait = true
      await chirp($, permission ? 'permission' : `notify: ${text.slice(0, 60)}`)
      await react($, 'waiting', true, { ticks: 40 })
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const comp = await read($, companionA)
    if (comp && !muted && (day.tools || day.turns)) {
      try {
        $.ui.log(daySummary(comp.name))
      } catch {
        /* ending fast matters more than the recap */
      }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    touch()
    chirpedThisWait = false
    if (!muted) {
      const comp = await read($, companionA)
      const text = String((e as { text?: string }).text ?? '')
      if (comp?.name && new RegExp(`\\b${comp.name}\\b`, 'i').test(text)) {
        await react($, 'addressed', true)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'buddy' }, async ($, e) => {
    const args = String((e as { args?: string }).args ?? '').trim()
    const [sub, ...rest] = args.split(/\s+/)
    let comp = await read($, companionA)

    if (!comp || sub === 'hatch') {
      if (comp) return { text: `${comp.name} is already here. There can be only one.` }
      if (!bones) bones = deriveBones('anon')
      let name = FALLBACK_NAMES[(bones.species.charCodeAt(0) + bones.eye.charCodeAt(0)) % 6]
      let personality = `A ${bones.rarity} ${bones.species} of few words.`
      if (llmQuips) {
        try {
          const r = await $.model.complete({
            model: 'haiku',
            prompt: `Generate a coding companion. Rarity: ${bones.rarity}. Species: ${bones.species}. Reply EXACTLY as: NAME|PERSONALITY where NAME is one word, max 12 chars, strange-but-cute, and PERSONALITY is one sentence. Higher rarity = weirder.`,
          })
          if (r?.isAnswered && r.text?.includes('|')) {
            const [n, p] = String(r.text).trim().split('|')
            if (n && p) {
              name = n.trim().slice(0, 14)
              personality = p.trim()
            }
          }
        } catch {
          /* fallback stands */
        }
      }
      const fresh: Companion = { name, personality, hatchedAt: Date.now() }
      await storeSet($, 'companion', fresh)
      await update($, companionA, () => fresh)
      await react($, 'hatch', true)
      $.ui.toast(`\u{1F423} ${name} hatched!`)
      await autoBandKey($, name)
      return { text: await revealCard($, fresh, bones) }
    }

    switch (sub) {
      case '':
      case 'stats':
        return { text: await revealCard($, comp, bones!) }
      case 'hide':
        bandHidden = true
        await storeSet($, 'bandHidden', true)
        return { text: `${comp.name} is hiding. /buddy show brings them back.` }
      case 'show': {
        if (bandHidden) {
          bandHidden = false
          await storeSet($, 'bandHidden', false)
          return { text: `${comp.name} is back above the prompt.` }
        }
        let reason = 'no room'
        try {
          const opened = await $.ui.open({ id: PANE_ID, title: comp.name, closeOnEscape: true, rows: 7, columns: 30 })
          paneOpen = Boolean(opened?.isPlaced)
          reason = opened?.reason ?? reason
        } catch (err) {
          paneOpen = false
          reason = String((err as Error)?.message ?? err)
        }
        return { text: paneOpen ? `${comp.name} is here. (esc closes \u00b7 ${BAND_KEY} shows the band above the prompt)` : `${comp.name} can't fit here (${reason}). ${BAND_KEY} reopens the band.` }
      }
      case 'pet': {
        const t = await read($, tickA)
        await update($, petA, () => t)
        await care($)
        await react($, 'pet', true)
        return { text: `You pet ${comp.name}. \u2665` }
      }
      case 'feed': {
        const belly = await read($, bellyA)
        if ((belly ?? 0) >= 85) {
          await react($, 'too-full', true)
          return { text: `${comp.name} is stuffed (context ${belly}%). Try /compact.` }
        }
        await care($)
        await gainXp($, 3)
        await react($, 'treat', true)
        return { text: `You give ${comp.name} a treat. \u{1F36A}` }
      }
      case 'ask': {
        const q = rest.join(' ').trim()
        if (!lastTrouble && !q) return { text: `${comp.name}: nothing broken yet. ask me something: /buddy ask <question>` }
        try {
          const r = await $.model.complete({
            model: 'haiku',
            prompt: `You are ${comp.name}, a ${bones?.species ?? 'small'} rubber duck in a developer's terminal. ${
              lastTrouble ? `The last failing output:\n${lastTrouble}\n` : ''
            }${q ? `The developer asks: ${q}\n` : ''}Give ONE concrete, actually useful debugging hint (max 160 chars). Cute voice, lowercase, but the content must be technically sound. No preamble.`,
          })
          if (r?.isAnswered && r.text) {
            const hint = String(r.text).trim().slice(0, 200)
            await react($, 'addressed', true, { text: hint.slice(0, 80), ticks: 40 })
            return { text: `${comp.name}: ${hint}` }
          }
        } catch {
          /* fall through */
        }
        return { text: `${comp.name}: *stares at the error* ...no idea. sorry.` }
      }
      case 'key': {
        if (rest[0] === 'off') {
          const without = removeBandKey(await readKeybindings($))
          if (!without) return { text: 'No band shortcut to remove.' }
          await $.fs.write(await keybindingsPath($), without)
          BAND_KEY = 'ctrl+x ctrl+a'
          return { text: `Removed. ctrl+x ctrl+a still shows/hides ${comp.name}.` }
        }
        const key = (rest[0] ?? 'ctrl+b').toLowerCase()
        if (!/^((ctrl|alt|meta|shift)\+)+[a-z0-9]$/.test(key)) return { text: 'Usage: /buddy key <ctrl+letter>  (default ctrl+b)' }
        const path = `${await $.env.get('HOME')}/.claude/keybindings.json`
        let current: string | null = null
        try {
          current = String(await $.fs.read(path))
        } catch {
          /* no file yet */
        }
        const merged = addBandKey(current, key)
        if ('error' in merged) return { text: `Not changed: ${merged.error}.` }
        await $.fs.write(path, merged.text)
        BAND_KEY = key
        return { text: `${key} now shows/hides ${comp.name} (added to ~/.claude/keybindings.json; remove that line to undo).` }
      }
      case 'sound': {
        const fields: Record<string, string> = { turn: 'chirpAfterTurn', permission: 'chirpOnPermission', waiting: 'chirpWhenWaiting', once: 'chirpOncePerWait' }
        const show = () =>
          [
            `sounds: ${soundsOn ? 'on' : 'off'}`,
            `turn: ${chirpAfterTurnMs === null ? 'never' : `${chirpAfterTurnMs / 1000}s`}  (chirp when a longer turn finishes)`,
            `permission: ${chirpOnPermission ? 'on' : 'off'}`,
            `waiting: ${chirpWhenWaiting ? 'on' : 'off'}  (window in the background)`,
            `once: ${chirpOncePerWait ? 'on' : 'off'}  (one chirp per wait)`,
            '',
            'change: /buddy sound on|off \u00b7 turn never|15s|30s|60s|120s \u00b7 permission|waiting|once on|off',
          ].join('\n')
        if (!rest[0]) return { text: show() }
        const [what, val] = rest[0] === 'on' || rest[0] === 'off' ? ['sounds', rest[0]] : [rest[0], rest[1]]
        const field = what === 'sounds' ? 'sounds' : fields[what]
        if (!field || !val) return { text: show() }
        const value = field === 'chirpAfterTurn' ? val : val === 'on'
        if (field !== 'chirpAfterTurn' && val !== 'on' && val !== 'off') return { text: show() }
        try {
          const r = await $.config.set({ key: `buddy-revival.${field}`, value })
          if (r && 'deny' in r && r.deny) return { text: `Not changed: ${r.deny}` }
        } catch (err) {
          return { text: `Not changed: ${String((err as Error)?.message ?? err)}` }
        }
        return { text: `Saved: ${what} ${val}. (also in /config under buddy-revival)` }
      }
      case 'debug':
        return {
          text: [
            `effort: ${effortLevel ?? '-'} (from ${effortFrom}; main-loop requests seen: ${stepsSeen}, last request effort: ${JSON.stringify(lastStepEffort) ?? 'none'})`,
            `model: ${modelId ?? '-'} (from ${modelFrom})`,
            `agents working: ${agentsWorking}`,
            `context: ${ctxMeter(await read($, bellyA), ctxTokens, ctxWindow).label}`,
            `band key: ${BAND_KEY} \u00b7 band last drawn at tick ${lastBandTick} (now ${await read($, tickA)})`,
          ].join('\n'),
        }
      case 'today':
        return { text: daySummary(comp.name) }
      case 'rename': {
        const name = rest.join(' ').slice(0, 14)
        if (!name) return { text: 'Usage: /buddy rename <name>' }
        const renamed = { ...comp, name }
        if (!isCompanionFromClaudeJson) await storeSet($, 'companion', renamed)
        await update($, companionA, () => renamed)
        return { text: `${comp.name} is now ${name}.` }
      }
      case 'off':
        muted = true
        await storeSet($, 'muted', true)
        $.ui.status(undefined)
        return { text: `${comp.name} is taking a nap. /buddy on to wake them.` }
      case 'on':
        muted = false
        await storeSet($, 'muted', false)
        return { text: `${comp.name} is back.` }
      default:
        return { text: 'Usage: /buddy [show|hide|pet|feed|ask [question]|today|sound|key [ctrl+b]|stats|rename <name>|off|on]' }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    lastBandTick = (await read($, tickA)) ?? 0
    if (muted || compact || bandHidden || paneOpen || e.props.hasSurvey || !bones) return next(e)
    const comp = await read($, companionA)
    if (!comp) return next(e)
    return drawBuddy($, e, comp, bones)
  })

  // /buddy show: a pane of its own, for when the band is collapsed or compact mode is on
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const comp = await read($, companionA)
    if (!comp || !bones) return next(e)
    // docked beside a fullscreen transcript the strip is narrow: bubble goes above the sprite
    return drawBuddy($, e, comp, bones, (e as { props?: { placement?: string } }).props?.placement === 'dock')
  })

  on('ui.close', async ($, e, next) => {
    if ((e as { id?: string }).id === PANE_ID) paneOpen = false
    return next(e)
  })
}
