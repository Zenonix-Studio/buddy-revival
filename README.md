# buddy-revival

> "Apologies friends, maybe one day your buddy will return."
> — the only reply on [anthropics/claude-code#45596](https://github.com/anthropics/claude-code/issues/45596) (2,000+ reactions)

Claude Code shipped a terminal companion in v2.1.88 and quietly removed it in v2.1.97.
**buddy-revival brings it back, and it brings back *yours*.** The original companion was
derived from your account, not rolled at random, and this plugin re-derives it the same way.
Same species, rarity, eyes, hat and shiny status that Claude Code gave you.

```
╭──────────────────────╮     ,_,
│ the tests disagree   │ ─  (·,·)
│ with you.            │     " "
╰──────────────────────╯   Crumpet Lv5 ▰▰▱▱▱ (level progress)
 ████░░░░░░ ctx 42% 84k/200k
```

## Install

At the prompt of a Claude Code session:

```
/plugin install buddy-revival --marketplace Zenonix-Studio/buddy-revival
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install buddy-revival --marketplace Zenonix-Studio/buddy-revival
```

Then type `/buddy` to hatch (or greet) your companion. No Bun, no jq, and it does not
replace your status line.

## Updating

```
claude plugin marketplace update buddy-revival
claude plugin update buddy-revival@buddy-revival
```

Then `/reload-plugins` in an open session, or start a new one.

## What it does

Your buddy sits in the band above the prompt. It blinks, sways, and occasionally says
something dumb in a speech bubble. It also keeps an eye on things:

| It notices | It says |
|---|---|
| A test fails, an error shows up, a diff passes 80 lines | a short reaction (at most one every 30s) |
| The session | beside the sprite: context meter with model (`ctx 39% 387k/1M · Opus 5.5`), effort (`◐ medium · /effort`) and, while any run, `N agents working` |
| The context window fills up | the meter (green → yellow at 60% → red at 85%, with tokens used / window); its belly fills with your tokens, at 85% it asks for `/compact`, after compaction it burps |
| Your usage limit nears 80% / 95% | it gets tired and tells you |
| A turn over 30 s finishes, Claude needs your permission, or Claude has been waiting on you (window in the background) | it chirps once per wait and taps the glass |
| `rm -rf`, `git push --force`, `reset --hard`, `DROP TABLE`… | it covers its eyes (it never blocks anything) |
| 90 minutes of non-stop work (45 after midnight) | it suggests a break |

Nothing to maintain: it never dies, never sulks, and never nags you to feed it.

## Commands

| Command | |
|---|---|
| `/buddy` | hatch, or show its card (species, rarity, stats, level, belly, energy) |
| `/buddy hide` · `/buddy show` | hide the band; bring it back (or, with the band up, open it in a pane of its own) |
| `/buddy pet` · `/buddy feed` | the tamagotchi part |
| `/buddy ask [question]` | sends the last failing output to Haiku and relays one debugging hint |
| `/buddy today` | today's recap: turns, tool calls, red tests turned green |
| `/buddy rename <name>` | |
| `/buddy key [ctrl+letter]` · `/buddy key off` | set or remove the one-key band toggle |
| `/buddy sound` | show and change the chirp settings (`/buddy sound turn 60s`, `/buddy sound waiting off`, …) |
| `/buddy debug` | where the gauges' values come from |
| `/buddy off` · `/buddy on` | mute / unmute |

Say its name in a prompt and it answers.

## Showing and hiding the band

The band is Claude Code's own plugin panel above the prompt. **`ctrl+x ctrl+a` hides and
shows it.** Once hidden, Claude Code draws no button to bring it back, so:

- On first run buddy-revival binds **`ctrl+b`** to the same toggle in
  `~/.claude/keybindings.json` and tells you so. It does this once, keeps your other bindings,
  and skips it when `ctrl+b` is taken, the file isn't plain JSON, or you're inside tmux.
  `/buddy key off` removes it.
- While the band is hidden, the status line says `Crumpet is hiding · ctrl+b to show`.
- In a fullscreen terminal, `/buddy show` docks to the right; Claude Code decides where panes go.
- `/buddy hide` hides it anywhere, and in the desktop app the band has its own close button.
  `/buddy show` brings it back.

## Settings

In `/plugin` → buddy-revival:

| Setting | Default | |
|---|---|---|
| Compact mode | off | a one-line status entry instead of the band |
| LLM reactions | off | reactions written by Haiku instead of canned lines (costs tokens) |
| Sounds | on | master switch for the chirp (macOS; silent elsewhere) |
| Chirp when a turn finishes | 30s | chirp when a turn longer than this ends: never / 15s / 30s / 60s / 120s |
| Chirp on permission asks | on | every time Claude needs your permission |
| Chirp when Claude is waiting | on | on Claude Code's "waiting for your input" notice (window in the background) |
| Chirp once per wait | on | one chirp per wait, quiet until your next prompt (permission asks excepted) |

## How the restoration works

The original companion came from `mulberry32(wyhash(accountId + "friend-2026-401"))`. The
hash is Bun's `Bun.hash` (zig's wyhash, low 32 bits), not FNV-1a, which is why other
revivals get your buddy wrong. buddy-revival ports wyhash to TypeScript and checks it
against Bun's output (`node tools/selfcheck.mjs`). Rarity weights (60/25/10/4/1), the 18
species, 6 eyes, 8 hats, the 1% shiny roll and the stat ranges follow the original.

The ASCII art is redrawn from scratch. It is not Claude Code's original artwork. If your
`~/.claude.json` still holds the companion name you had, it is used as is.

## Privacy

Everything runs locally inside Claude Code. The only network calls are the ones you opt
into: `/buddy ask` and the "LLM reactions" setting use your own Claude Code session to
call Haiku.

## Development

```
claude plugin validate plugin
claude plugin test plugin
node tools/selfcheck.mjs
claude --plugin-dir plugin   # run a session with your working copy
```

## License

MIT. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are
trademarks of Anthropic.
