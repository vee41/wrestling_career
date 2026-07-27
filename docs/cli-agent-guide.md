# CLI Guide for Future Agents

This document is the operational guide for `apps/cli`: use it to inspect and
play a persisted world, or to run the deterministic six-month validation
harness. It is intentionally separate from the game design documents. The
machine-authoritative command implementation is `apps/cli/src/cli.ts` and the
authoritative action tokens live in `packages/contracts`.

## Start Here

Run the CLI through its workspace script from the repository root:

```powershell
pnpm --filter @wrestling/cli run cli help
```

Pass command arguments directly after `cli`; **do not add an extra `--`**.
For example, this is correct:

```powershell
pnpm --filter @wrestling/cli run cli seed --scenario wwe-2026 --humans 1 --seed agent-demo
```

This is not correct, because the CLI receives `--` as its command:

```powershell
pnpm --filter @wrestling/cli run cli -- seed --scenario wwe-2026
```

The default save file is `wrestling-save.json` in the current working
directory. For agent work, always isolate experiments with the global
`--file <path>` option. It can appear anywhere in the command line.

```powershell
pnpm --filter @wrestling/cli run cli seed --scenario wwe-2026 --humans 1 --seed agent-demo --file .tmp/agent-demo.json
```

`seed` overwrites the chosen save file. All other play commands load and
update that same file. The `slice` command is read-only: it does not create or
alter a save file.

## Fast Workflows

### Inspect a scenario world

Seed a deterministic world, then use the human-controlled ID printed by
`seed`:

```powershell
pnpm --filter @wrestling/cli run cli seed --scenario wwe-2026 --humans 1 --seed inspect-1 --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli status cm-punk --file .tmp/inspect.json
```

`status` is the first choice for investigation. It returns qualitative career
state, current booking, active stories, and pending decisions. Add `--debug`
only when diagnosing simulation numbers; normal player-facing behavior should
be evaluated without raw values.

```powershell
pnpm --filter @wrestling/cli run cli status cm-punk --debug --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli sheet --limit 40 --file .tmp/inspect.json
```

### Play one decision period

Each wrestler may queue one interaction and one action for the upcoming tick.
Submitting the same slot again replaces the earlier choice, so agents should
build a complete intended turn before resolving it.

```powershell
pnpm --filter @wrestling/cli run cli interact cm-punk gm request_opportunity --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli act cm-punk recover --invest --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli tick --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli status cm-punk --file .tmp/inspect.json
```

For a GM feud pitch, name the opponent with `--about`:

```powershell
pnpm --filter @wrestling/cli run cli interact cm-punk gm pitch_feud --about seth-rollins --file .tmp/inspect.json
```

Use `tick --count N` only for headless advancement. For interactive diagnosis,
prefer one tick at a time and inspect the new event log after consequential
choices.

### Set a booking intent

The GM books a show one tick ahead. Once `status` shows an upcoming match,
copy its match-slot ID and set an intent before the show resolves:

```powershell
pnpm --filter @wrestling/cli run cli intent cm-punk slot-12 chase_quality --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli tick --file .tmp/inspect.json
```

Use only these match-intent tokens:

```text
protect_character  elevate_opponent  chase_quality
work_safely        play_to_crowd     advance_story
take_risks         follow_plan       steal_spotlight
```

### Handle pending decisions and proposals

`status` lists pending reactive decisions and proposals, including the
available response tokens. Pass that exact ID and one listed response to
`respond` before its deadline:

```powershell
pnpm --filter @wrestling/cli run cli respond cm-punk reactive-12 accept --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli respond cm-punk proposal-9 counter "I want the title match at the PLE" --file .tmp/inspect.json
```

A `counter` proposal response requires a payload. Do not invent a response
token: the command validates it against the individual decision.

### Change career stance

Stance changes are queued this tick and apply at the start of the next one:

```powershell
pnpm --filter @wrestling/cli run cli stance cm-punk pursue_championships --file .tmp/inspect.json
pnpm --filter @wrestling/cli run cli tick --file .tmp/inspect.json
```

Valid stance tokens are:

```text
prioritize_health      chase_popularity       cooperate_with_creative
protect_character      support_allies         pursue_championships
maximize_income        seek_match_quality     avoid_conflict
```

## Action and Interaction Reference

Actions:

```text
train_skill <skill>    recover    promote_match <matchSlotId>
develop_character [--concept ...] [--promo-tone ...] [--traits a,b]
                  [--presentation ...] [--direction ...]
```

Add `--invest` to an action only when intentionally spending money for its
quality upgrade. For `train_skill`, use a canonical skill token from the
current status/debug output rather than guessing.

Interactions target either `gm` or a wrestler ID. GM-only tokens are
`request_opportunity`, `pitch_feud`, `pitch_alliance`, `challenge_booking`,
`request_promo_time`, `propose_character_change`, `request_feedback`, and
`offer_help`. Wrestler-target tokens are `pitch_feud`, `propose_alliance`,
`build_trust`, `request_support`, `offer_elevation`, `provoke`,
`repair_relationship`, `undermine`, and `coordinate_pitch`.

The CLI validates target/token combinations, but agents should choose tokens
from this list rather than using error-driven discovery.

## Slice Validation Workflow

Use the slice harness for system-level simulation work, not ordinary career
play. It loads the scenario afresh with zero human wrestlers, samples
popularity after each show, and emits Markdown to stdout.

```powershell
pnpm --filter @wrestling/cli run cli slice --scenario wwe-2026 --seeds 3
```

This is the Phase 3.7 gate command. It evaluates SL-1 through SL-9 for each
seed and evaluates SL-10 across all seeds. A valid gate result requires every
MUST clause to pass on every seed; embedded SHOULD clauses and SL-10 should
pass on a majority of runs. The report includes title lineages, story
timelines, PLE cards, injury/return arcs, and a popularity sparkline for every
wrestler, so use the failed criterion's supporting section to identify a
tuning target.

For a quick report-format smoke test, use fewer weeks. Do not treat that as a
slice verdict because the SL thresholds are defined for 26 weeks.

```powershell
pnpm --filter @wrestling/cli run cli slice --scenario wwe-2026 --seeds 1 --weeks 4
```

## Efficient Agent Practices

- Keep one disposable `--file` per hypothesis. Re-seed with the same
  `--seed` to reproduce it exactly.
- Prefer `status` and `sheet` before changing state. Then make the smallest
  choice needed to exercise the path under investigation.
- Check a show booking before attempting `intent` or `promote_match`; both
  require a real, currently known match-slot ID.
- After any code tuning that affects booking, popularity, stories, titles, or
  injuries, run the three-seed `slice` command and then `pnpm test`.
- Scenario content belongs in `data/<scenario>/`; do not hard-code wrestler,
  title, faction, or show names in `packages/sim` or `packages/contracts`.
- Treat CLI output as a view of persisted state. The simulation remains
  authoritative in `packages/sim`; do not hand-edit save JSON to simulate a
  gameplay outcome.

## Troubleshooting

- **`no saved world`**: seed the selected `--file` first, or supply the same
  path used when seeding.
- **Unknown wrestler or match-slot ID**: inspect `status`; IDs, not display
  names, are required by mutation commands.
- **An intent/response is rejected**: use the canonical tokens printed by the
  CLI or listed above. For reactive decisions, only the offered responses are
  legal.
- **A stale experiment is confusing results**: create a new isolated save
  path and re-seed with an explicit seed instead of trying to repair the old
  state.
