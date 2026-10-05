# digi-pet — implementation plan

A Claude Code mod: a Digimon-style V-Pet that you never feed or clean. It hatches,
grows and digivolves from **how you use Claude Code**, and the branch it takes
depends on your working style, the way Digital Monster's care, training and battles
decide its branches.

Status: plan only. Nothing has been written to `~/.claude/dev-mods` yet, because the
first file written there opens the hot-reload prompt.

---

## 1. What we're borrowing

### hoobnn `spinner` (installed here as `spinner@hoobnn-agent-mods`)
- Its companion keeps **xp and love in `$.store`**, shared across sessions: `levelOf(xp) = floor(sqrt(xp/2)) + 1`, with 1 xp per finished turn.
- It reacts to `tool.call` (the tool label, `newsOf()` for tests and commits), `turn.complete`, and `/spinner pet`.
- It draws half-block pixel art (`cells.ts`) in an `AbovePrompt` band.
- Its weak spot: the store write is read-then-set (`bumpPet`), so two sessions can lose updates. That's fine for cosmetic xp. It's a bug once counters gate evolution (see §5).
- The `TEST` and `COMMIT` regexes in `pet.ts` can be lifted almost as-is (MIT).

### Claude Code `/buddy` (April 2026)
- 18 species, 5 rarities, and stats (DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK).
- All of it is **hashed from your user ID and never changes with use**. Those facts come from third-party reconstructions of leaked source, not Anthropic docs.
- **That's the gap digi-pet fills:** stats that come from what you actually do.

### Digimon V-Pets
| Device | What drives evolution | What we take |
|---|---|---|
| Digital Monster / DM Color (1997 / 2023) | Stage timers, care mistakes, training count, overfeeds, sleep disturbances, battle **win ratio** (Stage V/VI need ≥40%; ≥80% guarantees it) | Time-gated stages, priority-ordered branch rules, a fallback species (Numemon), win-ratio gates |
| Pendulum | Shaking to train, plus attributes (Vaccine/Data/Virus) | An attribute decided by your style |
| Vital Bracelet / BE | **Real-world activity**: steps and heart rate give Vital Values, squats give PP, plus NFC battles and a win ratio | The core idea: the pet grows from real activity, not from caretaking |
| Digimon World (PS1) | Six stats (HP/MP/Off/Def/Speed/Brains), weight, care mistakes | A six-stat sheet, plus "weight" as a fun side stat |

What we drop, as asked: hunger, strength, poop, sickness and death. Nothing ever
de-evolves. Signals that would be "care mistakes" only **choose the branch**
(Numemon-style), and even the fallback species can still go on to evolve (Numemon →
Monzaemon, as on DMC).

---

## 2. Usage signals → stats (the core of the design)

Every row names an event field that exists in this build's API (checked in the
`plugin-authoring` types).

### Six stats (Digimon World-style)
| Stat | Signal | Source |
|---|---|---|
| **STA** (HP) | Active minutes: Σ `durationMs` of main-loop turns | `turn.complete` (`!e.agentId`) |
| **INT** (Brains) | Successful research calls: Read, Grep, Glob, WebSearch, WebFetch, LSP, plus ExitPlanMode (a plan approved) | `tool.call`, `await next(e)`, `!result.isError` |
| **ATK** (Offense) | Code written: successful Edit/Write/NotebookEdit, weighted by line count of `new_string` / `content` (capped per call). **Not cost**: `SessionCost` is only `{ usd }`, so there's no lines-added counter. | `tool.call` args + result |
| **DEF** (Defense) | Verification that passed: test / build / typecheck / lint commands (spinner's `TEST` regex + `tsc`, `eslint`, `ruff`, `mypy`, `cargo check`…) | `tool.call` `Bash` + `isError` |
| **SPD** (Speed) | Parallel work: steps with ≥2 tool uses, plus quick turns (<60 s, ≥1 tool, ended `answer`) | `turn.step` result `toolUses.length`, `turn.complete` |
| **SYN** (Bond) | Active-day streak, pats (`/digi pet`), and prompts written | clock + `prompt.submit` |

### Gate resources (V-Pet "requirements")
| Resource | Signal | Analogue |
|---|---|---|
| **Age** | Active days: local dates with ≥5 main-loop turns | Stage timer, without punishing holidays |
| **Battles / win ratio** | A *battle* opens on a failing test/build run and is **won** when that runner later passes (red→green); a pass with no prior fail is an instant win; a battle still open when the session ends is a **loss**. Interrupts count as neither. | DMC battles, but the ratio actually varies. With "turn ended `answer`" the ratio would sit near 100%. |
| **Trophies** | Successful `git commit`, `gh pr create` | Vital Hero trophies / BE PP |
| **Summons** | Subagent runs (`Agent` tool calls; `turn.complete` with `agentId`) | Jogress flavour; used to gate Mega |

### Branch selectors (what were "care mistakes", never penalties)
| Selector | Signal | Steers toward |
|---|---|---|
| **Chaos** | Interrupts (`reason === 'aborted'`), tool errors, `--force` / `--no-verify` / `rm -rf` / `push -f` in Bash | Virus line (Devimon) |
| **Night owl** | Turns started 00:00–05:00 local | Dark / Virus line (DMC's "sleep disturbance") |
| **Overfeed** | Context fill crossing 85% (`session.measure` → `context`) and `session.compact` | DMC overfeed; also a **Weight** side stat |
| **Attribute** | At each evolution: DEF+Trophies dominant → **Vaccine**; INT dominant → **Data**; Chaos+Night dominant → **Virus** | Pendulum attributes |

### Anti-grind rules (avoiding Goodhart's law)
- **Tokens and cost never feed a stat.** If they did, the pet would reward burning money. They only feed Weight and Overfeed, which reward *lean* sessions.
- **Daily soft cap per stat:** full gain up to N per day, then ×0.25. Stats are computed from per-day buckets at read time, so the cap also holds across sessions running in parallel.
- Stages are gated on **active days** first, so binge-prompting can't skip the calendar.

---

## 3. Evolution tree (MVP: one Ver.1-style line, 11 species)

```
Digitama ─3 turns─▶ Botamon ─25 turns─▶ Koromon ─2 days+100 turns─▶ Agumon  (ATK ≥ INT)
                                                                   └▶ Betamon (INT > ATK)
Rookie ─5 days, ≥10 battles─▶  Greymon  (Vaccine)
                              Seadramon (Data)
                              Devimon   (Virus)
                              Numemon   (fallback: no rule matched)
Champion ─10 days, ≥25 battles, win ≥60%, ≥15 trophies─▶ MetalGreymon (Greymon | Devimon)
                                                         Monzaemon    (Numemon | Seadramon)
Ultimate ─21 days, ≥60 battles, win ≥80%, ≥50 trophies, ≥20 summons─▶ WarGreymon
```

That's about 38 active days from egg to Mega at a normal pace. A `pace` option
(`fast` ×0.25, `normal`, `slow` ×2) scales every gate.

As on DMC, each stage's branches are an **ordered rule list; the first match wins and
the fallback comes last**. Rules and sprites live in one data table (`species.ts`),
so adding a line (Gabumon → Garurumon …) or switching to homage names is a data
change only.

**Evolution is a pure, deterministic function of the ledgers.** Two sessions
evaluating it at the same moment get the same answer, so concurrent writes of the
`pet` snapshot agree.

---

## 4. UI

- **Band (one row above the prompt):** `▞▚ Agumon · Rookie · Vaccine │ ATK 42 INT 31 DEF 18 │ day 3/5 ▓▓▓░░ → Champion`. While a turn runs, a 2-frame idle wiggle; during a won battle, a short attack frame.
- **`/digi` pane:** the LCD view. A 16×16 sprite as 8 rows of half-blocks, 2-frame idle animation, stat bars, battle record, attribute and evolution history. A pane opened from a command seats at any width; opened unprompted, it needs ≥144 columns, so we only ever open it from the command.
- **Evolution moment:** a toast plus a flashing silhouette → new sprite in the band ("Agumon digivolve to… Greymon!").
- **Commands:**
  - `/digi` (status)
  - `/digi pane`
  - `/digi pet`
  - `/digi log` (evolution history)
  - `/digi sim <species>`: a dev preview of any sprite and its evolution animation, so every sprite can be checked without waiting weeks.
- **Coexisting with spinner:** keep spinner's stage animation, and turn off its pet with `/spinner companion off` so there aren't two pets. digi-pet does not take spinner's companion over.

---

## 5. Architecture

```
~/.claude/dev-mods/<session>/digi-pet/        (moved to its own repo once stable)
  .claude-plugin/plugin.json   name, version, types, userConfig { pace, band, reducedMotion }
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           event wiring only
  hooks/signals.ts    PURE     event → counter deltas (tool classes, TEST/COMMIT/CHAOS regexes)
  hooks/stats.ts      PURE     day buckets → six stats (daily caps), attribute, win ratio
  hooks/evolution.ts  PURE     (pet, stats, resources, today) → next species | null
  hooks/species.ts    DATA     names, stages, rules, 16×16 sprites (2 frames each)
  hooks/ledger.ts              store I/O
  hooks/draw.tsx               band + pane
  types/index.d.ts             PluginState contract
  tests/*.test.ts
```

### Persistence
`$.store` is per plugin and global: one JSON file under the Claude config directory,
so the pet is shared across every project.

- `ledger:<sessionId>` holds `{ [YYYY-MM-DD]: Counters }`. **Only the session that owns the key writes it**, so writes can't race each other.
- Reads sum every `ledger:*` from `$.store.keys()`.
- The key and the date are taken **at write time** (`$.session.id()`, `$.clock.now()`), because `/clear` changes the session id without firing `session.start`.
- `pet` holds `{ species, enteredAt, enteredDay, history[] }`, rewritten only when the pet evolves (deterministic, see §3).
- Size: about 300 B per session-day, so roughly 0.5 MB a year. Compaction can wait.

### Event wiring
| Event | Does |
|---|---|
| `tool.call` | `await next(e)`, classify by `e.tool`, args and `isError`; bump INT/ATK/DEF/Chaos/Trophies; open or close battles |
| `turn.step` | Count `toolUses.length ≥ 2` for SPD |
| `turn.complete` | Main loop: STA, quick-turn SPD, Chaos on abort, Night owl, active-day tick, then evaluate evolution. With `agentId`: Summons only |
| `session.measure` | Overfeed / Weight when the context fill crosses 85% |
| `session.compact` | Overfeed |
| `session.end` | Close open battles as losses |
| `prompt.submit` | SYN (prompts) |
| `command.run` | `/digi …` |
| `ui.render` | `AbovePrompt` band, `Pane` |

---

## 6. Build phases (each ends with observable proof)

| # | Phase | Proof |
|---|---|---|
| **P0** | Skeleton: manifest, `/digi` text status, ledger write on `turn.complete` | Mod loads under hot reload. `claude plugin validate` is clean. **Two sessions side by side, 20 turns each, and the ledgers sum to 40.** This checks that the single-file store keeps keys apart across processes. If it doesn't, persistence needs to change. |
| **P1** | Pure engine: `signals`, `stats`, `evolution` | `claude plugin test`: classification table, daily cap, battle red→green, every branch rule, fallback, determinism |
| **P2** | Band and pane with placeholder blocks | Band visible; `/digi pane` opens; `/digi sim Greymon` plays the evolution |
| **P3** | Sprites: 11 species × 2 frames, 16×16 | `/digi sim <each>` screenshot gallery |
| **P4** | Polish: `pace`, `reducedMotion`, toast copy, `/digi log` | Manual run-through documented in the README |
| P5 (opt) | More lines (Gabumon, Patamon …), Pendulum-style fields from file types or MCP use | — |

Two things P0 must confirm: whether a main-loop `turn.complete.usage` already
includes subagent tokens (it only matters for Weight), and how `$.store` behaves
under concurrent writers.

---

## 7. Open decisions (with defaults, so none of them block work)

1. **Real Digimon names and sprites, or homages?** Default: real names, hand-drawn sprites, **personal use only**. Digimon is Bandai IP, and ripped V-Pet sprites can't be published. If you ever publish it, swap `species.ts` for renamed homages, as spinner does with "sparky" and "bluecat".
2. **Coexist with spinner, or replace its companion?** Default: coexist, with `/spinner companion off`.
3. **Fresh egg or backfill?** You could seed the counters by scanning `~/.claude/projects/*.jsonl` history. Default: **fresh egg**. Backfill would hatch you straight into a Champion and skip the part that's fun.

## 8. Risks
- **Sprite effort** is the biggest cost: 22 hand-drawn frames. Mitigation: placeholders first (P2), then sprites (P3).
- **Thresholds are guesses.** Expose them in one table and tune after a week of real data. `/digi` shows progress toward the next gate.
- **Gaming the gates:** daily caps plus active-day gates. Tokens are never rewarded.
- **Store behaviour across processes** is unverified until P0.

## Sources
- spinner README: https://github.com/hoobnn/hoobnn-agent-mods/blob/main/claude-code/spinner/README.en.md
- Claude Buddy (third-party, reconstructed from leaked source): https://claudefa.st/blog/guide/mechanics/claude-buddy, https://github.com/FiroYu/Claude-Code-Buddy-Collection
- DM Color evolution and win-ratio rules: https://humulos.com/digimon/dmc/, https://humulos.com/digimon/dmc/manual/
- Vital Bracelet BE requirements: https://humulos.com/digimon/vbbe/, https://wikimon.net/Vital_Bracelet_BE
