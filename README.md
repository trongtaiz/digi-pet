# digi-pet

A Digimon V-Pet that lives above the Claude Code prompt. It eats your session's
prompt cache, fights while Claude works, and digivolves by the Digital Monster
Color's rules from what you actually do: turns, tests, commits and how well you
look after it.

## Install

```
/plugin marketplace add trongtaiz/digi-pet
/plugin install digi-pet@digi-pet
```

Then `/reload-plugins`, or start a new session. Your pet hatches from a random
egg (one of the five DMC versions).

digi-pet is a hooks-module plugin: it needs a Claude Code build that loads
plugin hook modules. Notifications use `osascript`, so they are macOS only;
everything else runs anywhere.

## What it does

- **Hunger is the prompt cache.** The pet gets peckish, hungry, then starving as
  the session's cache nears expiry (60 min by default), and warns you before it
  goes cold. A prompt feeds it. A cache that goes cold and is picked up again
  the same day is a care mistake, at most one per session per day.
- **It rests.** Lunch and evenings (configurable), `/digi break 90m`, `/digi
  sleep` and side sessions: no hunger, no alerts, no care mistakes.
- **It fights.** While a turn runs, monsters run in and the pet shoots them. A
  failing check (tests, type-check, lint) becomes a boss that stays until the
  check goes green again in the same turn: that's a won battle.
- **It grows.** Stages follow the Digital Monster Color charts: training from
  your work, care mistakes, overfeeding, battles and win ratio pick the branch.
  `/digi jogress` fuses with a partner where the chart allows it.

## Commands

| Command | |
|---|---|
| `/digi` or `/digi stats` | Stats, hunger, and what the next evolution needs |
| `/digi pane` | Open the side pane: the Digivice, stats and evolution log |
| `/digi log` | Evolution history |
| `/digi pet` | Pat it (the first three a day raise SYN) |
| `/digi jogress` | Fuse with a partner, where the chart allows |
| `/digi sleep` | Sleep until your next prompt |
| `/digi break 90m` / `until 15:30` / `off` | A one-off rest window |
| `/digi side [off]` | Mark this session as side work: no hunger |
| `/digi sim <species> [state]` / `sim off` | Preview any species and state |
| `/digi debug ttl <min>` / `off` | Shorten the cache TTL to watch hunger play out |

## Options

Set them with `claude plugin configure digi-pet@digi-pet`:

| Option | Default | |
|---|---|---|
| `ttlMinutes` | 60 | Your cache TTL: 60 on a 1-hour cache, 5 on the default one |
| `restHours` | `12:00-14:00,18:00-08:00` | Nap windows, local time |
| `dayStartsHour` | 4 | A late night counts as the evening before |
| `sidePaths` | | Globs whose sessions are side sessions |
| `minContextTokens` | 20000 | Below this the cache is cheap to rebuild; no hunger |
| `notify` | true | macOS notifications when hungry or starving |
| `pace` | normal | `fast`, `normal` or `slow` growth |
| `reducedMotion` | false | Draw everything still |

## Development

```
bun install
claude plugin test plugin       # tests
claude plugin validate plugin
bun run preview                 # preview/index.html: every state, rendered
```

To run your working copy, add the folder as a marketplace:
`/plugin marketplace add /path/to/digi-pet`.

## License

The code is MIT (see `LICENSE`). The Digimon sprites, names and evolution data
are not: they belong to Bandai / Toei, and digi-pet is an unofficial fan
project. See `NOTICE.md`.
