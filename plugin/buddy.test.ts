import { test, expect } from 'claude-code/testing'
import { deriveBones, addBandKey, boundBandKey, removeBandKey, ctxMeter, levelOf, levelProgress, effortLine, agentsLine, modelName } from './hooks/register'

// In the test env HOME is unset, so the plugin falls back to the deterministic
// 'anon' identity — every assertion below is stable across runs.
const ANON = deriveBones('anon')

test('derivation is deterministic and distribution matches the original weights', () => {
  expect(deriveBones('anon')).toEqual(ANON)
  expect(deriveBones('some-user')).toEqual(deriveBones('some-user'))
  expect(deriveBones('a').species === deriveBones('b').species
    && deriveBones('a').eye === deriveBones('b').eye
    && deriveBones('a').rarity === deriveBones('b').rarity).toBe(false)

  const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }
  const N = 20000
  for (let i = 0; i < N; i++) counts[deriveBones(`user-${i}`).rarity]++
  // original weights 60/25/10/4/1 (%) — allow generous tolerance
  expect(counts.common / N).toBeGreaterThan(0.55)
  expect(counts.common / N).toBeLessThan(0.65)
  expect(counts.uncommon / N).toBeGreaterThan(0.21)
  expect(counts.uncommon / N).toBeLessThan(0.29)
  expect(counts.rare / N).toBeGreaterThan(0.07)
  expect(counts.rare / N).toBeLessThan(0.13)
  expect(counts.legendary / N).toBeGreaterThan(0.003)
  expect(counts.legendary / N).toBeLessThan(0.02)

  for (const s of Object.values(ANON.stats)) {
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(101)
  }
})

test('/buddy hatches, then shows stats, pet and rename work', async ($) => {
  const hatched = await $.command.run({ command: 'buddy' })
  const card = String((hatched as { text?: string }).text ?? '')
  expect(card).toContain(ANON.species)
  expect(card).toContain(ANON.rarity)
  expect(card).toContain('DEBUGGING')

  const again = await $.command.run({ command: 'buddy', args: 'hatch' })
  expect(String((again as { text?: string }).text)).toContain('already')

  const pet = await $.command.run({ command: 'buddy', args: 'pet' })
  expect(String((pet as { text?: string }).text)).toContain('You pet')

  const fed = await $.command.run({ command: 'buddy', args: 'feed' })
  expect(String((fed as { text?: string }).text)).toContain('treat')

  const renamed = await $.command.run({ command: 'buddy', args: 'rename Vanewick' })
  expect(String((renamed as { text?: string }).text)).toContain('Vanewick')

  const stats = await $.command.run({ command: 'buddy', args: 'stats' })
  expect(String((stats as { text?: string }).text)).toContain('Vanewick')
  expect(String((stats as { text?: string }).text)).toMatch(/Lv \d+ [▰▱]{5} · mood happy · belly/)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band renders the companion on ${surface}`, async ($) => {
    await $.command.run({ command: 'buddy' })
    const m = await $.ui.mount({
      plugin: 'buddy-revival',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10 },
    })
    const tree = JSON.stringify(await m.drawn())
    // sprite + name line are present; name is the deterministic fallback
    expect(tree.length).toBeGreaterThan(0)
    const fallbackNames = ['Crumpet', 'Soup', 'Pickle', 'Biscuit', 'Moth', 'Gravy']
    expect(fallbackNames.some(n => tree.includes(n))).toBe(true)
    await m.unmount()
  })
}

test('a failing-test tool result triggers a reaction bubble', async ($, on) => {
  on('tool.call', () => ({ result: { text: 'FAIL: 3 tests failed\n' } }) as never)
  await $.command.run({ command: 'buddy' })
  await $.tool.call({ tool: 'Bash', input: { command: 'npm test' } } as never)
  const m = await $.ui.mount({
    plugin: 'buddy-revival',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10 },
  })
  await m.advance(600)
  const tree = JSON.stringify(await m.drawn())
  const failLines = ['the tests disagree with you.', 'red. very red.', 'i saw that coming, honestly.', '*pretends not to look*']
  expect(failLines.some(l => tree.includes(l))).toBe(true)
  expect(tree).toContain('round') // drawn as a bordered bubble beside the sprite
  await m.unmount()
})

const band = async ($: any) => {
  const m = await $.ui.mount({
    plugin: 'buddy-revival',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10 },
  })
  const tree = JSON.stringify(await m.drawn())
  await m.unmount()
  return tree
}

test('a destructive command makes the buddy cover its eyes, and today counts it', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '' } }) as never)
  await $.command.run({ command: 'buddy' })
  await $.tool.call({ tool: 'Bash', input: { command: 'git push --force origin main' } } as never)
  const tree = await band($)
  expect(['o_o you sure?', '*covers eyes*', 'can’t be undone'].some(l => tree.includes(l))).toBe(true)
  expect(tree).toMatch(/-[.,_ ]?-/) // eyes drawn closed
  const today = await $.command.run({ command: 'buddy', args: 'today' })
  expect(String((today as { text?: string }).text)).toContain('1 scary commands')
})

test('a red test then a green run counts as fixed', async ($, on) => {
  let n = 0
  on('tool.call', () => ({ result: { stdout: n++ === 0 ? 'FAIL: 2 tests failed' : '12 passed' } }) as never)
  await $.command.run({ command: 'buddy' })
  await $.tool.call({ tool: 'Bash', input: { command: 'npm test' } } as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'npm test' } } as never)
  const today = await $.command.run({ command: 'buddy', args: 'today' })
  expect(String((today as { text?: string }).text)).toContain('1 red tests, 1 turned green')
})

test('/buddy ask sends the last failure to the model and relays the hint', async ($, on) => {
  let prompt = ''
  on('tool.call', () => ({ result: { stdout: 'TypeError: x is undefined\nerror: build failed' } }) as never)
  on('model.complete', (_$: any, e: any) => {
    prompt = String(e.prompt ?? JSON.stringify(e))
    return {
      value: {
        isAnswered: true,
        text: 'check where x is assigned before line 3.',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    } as never
  })
  await $.command.run({ command: 'buddy' })
  await $.tool.call({ tool: 'Bash', input: { command: 'npm run build' } } as never)
  const r = await $.command.run({ command: 'buddy', args: 'ask' })
  expect(prompt).toContain('x is undefined')
  expect(String((r as { text?: string }).text)).toContain('check where x is assigned')
})

test('/buddy show opens a pane that draws the buddy', async ($) => {
  await $.command.run({ command: 'buddy' })
  const r = await $.command.run({ command: 'buddy', args: 'show' })
  const text = String((r as { text?: string }).text)
  expect(text).toMatch(/is here|can't fit/)
  for (const placement of ['inline', 'dock']) {
    const m = await $.ui.mount({ plugin: 'buddy-revival', surface: 'terminal', component: 'Pane', requestId: 'buddy', props: { placement } } as never)
    const tree = JSON.stringify(await m.drawn())
    expect(['Crumpet', 'Soup', 'Pickle', 'Biscuit', 'Moth', 'Gravy'].some(n => tree.includes(n))).toBe(true)
    expect(tree).toContain(placement === 'dock' ? '"flexDirection":"column"' : '"flexDirection":"row"')
    await m.unmount()
  }
})

test('/buddy key merges a band toggle into keybindings.json without clobbering', () => {
  const fresh = addBandKey(null, 'ctrl+b') as { text: string }
  expect(boundBandKey(fresh.text)).toBe('ctrl+b')
  const existing = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } }] })
  const merged = addBandKey(existing, 'ctrl+b') as { text: string }
  expect(merged.text).toContain('chat:externalEditor')
  expect(boundBandKey(merged.text)).toBe('ctrl+b')
  expect(addBandKey(existing, 'ctrl+e')).toEqual({ error: 'ctrl+e is already bound to chat:externalEditor' })
  expect('error' in addBandKey('{ // jsonc', 'ctrl+b')).toBe(true)
  const removed = removeBandKey(merged.text) as string
  expect(boundBandKey(removed)).toBe(null)
  expect(removed).toContain('chat:externalEditor')
  expect(removeBandKey(existing)).toBe(null)
})

test('context meter: bar, color thresholds and token amounts', () => {
  expect(ctxMeter(null, null, 0)).toEqual({ bar: '\u2591'.repeat(10), color: 'green', label: 'ctx --' })
  const mid = ctxMeter(42, 84_000, 200_000)
  expect(mid.bar).toBe('\u2588'.repeat(4) + '\u2591'.repeat(6))
  expect(mid.label).toBe('ctx 42% 84k/200k')
  expect(ctxMeter(70, 700_000, 1_000_000).color).toBe('yellow')
  expect(ctxMeter(90, 900_000, 1_000_000)).toMatchObject({ color: 'red', label: 'ctx 90% 900k/1M' })
})

test('level progress runs 0 to 1 within each level', () => {
  expect(levelOf(0)).toBe(1)
  expect(levelProgress(0)).toBe(0)
  expect(levelOf(5)).toBe(2) // level 2 starts at 5 xp
  expect(levelProgress(5)).toBe(0)
  expect(Math.abs(levelProgress(12) - 7 / 15)).toBeLessThan(1e-9) // 5..20 is level 2
  expect(levelProgress(19)).toBeLessThan(1)
})

test('sound options load and the buddy still works', { options: { chirpAfterTurn: 'never', chirpWhenWaiting: false, chirpOncePerWait: false } } as never, async ($) => {
  const r = await $.command.run({ command: 'buddy' })
  expect(String((r as { text?: string }).text)).toContain('DEBUGGING')
})

test('effort and agents lines', () => {
  expect(effortLine('medium')).toBe('\u25d0 medium \u00b7 /effort')
  expect(effortLine(null)).toBe(null)
  expect(agentsLine(0)).toBe(null)
  expect(agentsLine(1)).toBe('1 agent working')
  expect(agentsLine(3)).toBe('3 agents working')
})

test('model id reads as a name', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
  expect(modelName('claude-fable-5')).toBe('Fable 5')
  expect(modelName('opus')).toBe('opus')
  expect(modelName(null)).toBe(null)
})

test('/buddy sound lists the chirp settings', async ($) => {
  await $.command.run({ command: 'buddy' })
  const r = await $.command.run({ command: 'buddy', args: 'sound' })
  const text = String((r as { text?: string }).text)
  expect(text).toContain('turn: 30s')
  expect(text).toContain('waiting: on')
})

test('desktop band: a close control hides it, /buddy show brings it back', async ($, on) => {
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never) // the engine's own band beneath the plugin: nothing
  await $.command.run({ command: 'buddy' })
  const mount = () => $.ui.mount({ plugin: 'buddy-revival', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } })
  let m = await mount()
  expect((await m.find({ type: 'Button' }))?.props.role).toBe('dismiss')
  await m.press({ key: 'hide' })
  await m.unmount()
  m = await mount()
  expect(JSON.stringify(await m.drawn())).not.toContain('Lv')
  await m.unmount()
  const back = await $.command.run({ command: 'buddy', args: 'show' })
  expect(String((back as { text?: string }).text)).toContain('back above the prompt')
  m = await mount()
  expect(JSON.stringify(await m.drawn())).toContain('Lv')
  await m.unmount()
  await $.command.run({ command: 'buddy', args: 'hide' })
  m = await mount()
  expect(JSON.stringify(await m.drawn())).not.toContain('Lv')
  await m.unmount()
})
