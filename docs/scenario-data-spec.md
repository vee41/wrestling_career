# Scenario Data Specification

**Status:** Accepted (v1.0)
**Purpose:** Define the data files that describe a game world. Everything world-specific — promotion, roster, titles, calendar, seed relationships, tuning config — lives in a per-scenario data directory that can be swapped for every game. The simulation is **scenario-agnostic**: no wrestler, title, show, or faction name may appear in `packages/sim` or `packages/contracts` source (fixtures and tests use synthetic names).

The zod schemas in `packages/contracts/src/scenario.ts` are the machine canon for these formats; this document explains intent and layout.

---

## 1. Directory layout

```
data/
  <scenario-id>/           # kebab-case, e.g. wwe-2026
    scenario.json          # manifest: id, name, description, format version
    promotion.json         # promotion name, weekly TV show name, PLE calendar
    roster.json            # wrestlers: identity, skills, gimmick, starting popularity, stance
    titles.json            # title lines: id, name, tier, initial holder
    relationships.json     # seed relationship rows (factions, history, grudges)
    stories.json           # optional: feuds already running at week 0
    config.json            # cadence and tuning knobs
```

A scenario is loaded by the CLI (`seed --scenario <scenario-id>`), validated file-by-file against contracts schemas, and converted to a `WorldState` by a **pure** function in `packages/sim` (`worldFromScenario(scenario, seed)`). File I/O stays in the app layer; the sim only ever sees parsed, validated data.

## 2. File contents

### promotion.json
- Promotion name and short identity blurb (used by the narrative layer).
- Weekly TV show name.
- Ordered PLE calendar: the names of the PLEs, cycled through in order (`pleIntervalWeeks` in config decides when they land).

### roster.json
One entry per wrestler:
- Identity: id (kebab-case, unique), ring name.
- The full wrestler block from contracts: 8 skills (0–100), condition, money, alignment, gimmick (concept, promo tone, traits, presentation, current direction).
- Starting popularity block (all dimensions — this seeds the card hierarchy). Includes `starPower`, the earned-status anchor popularity is pulled toward (GDD §10.2); author it equal to `generalPopularity` unless a wrestler starts with a spot they have not yet fully earned (a hot prospect: `starPower` below `generalPopularity`) or established status they are currently under-delivering on (`starPower` above).
- Starting career stance.
- `controlledBy` is **not** in the data — every scenario wrestler starts `ai`; human players claim slots at seed time (CLI `--humans N` flag / web onboarding).

Authoring guidance for the starting hierarchy: established main eventers ~70–90 general popularity, upper midcard ~55–70, midcard ~40–55, lower card ~20–40. Skills and popularity are hand-judged from the real-world source material; accuracy is an authoring concern, not a schema concern.

### titles.json
One entry per title line: id, name, `tier` (`world` | `midcard`), initial holder id (optional — vacant is valid), reign-start note. Lineage during play is derived from `title_change` events, not stored here.

### relationships.json
Seed rows in the contracts relationship shape (directed, sparse). Use these for factions (high mutual affinity/trust/influence), real recent history (rivalry/resentment between recent opponents), and mentorships (respect asymmetries). Only author rows that matter — everything else starts neutral.

### stories.json (optional)
Feuds in progress at week 0, in the contracts story shape. Use sparingly — one or two hot feuds make week 1 feel mid-season rather than cold-started.

### config.json
The knobs the sim reads instead of hardcoding:
- `decisionTicksPerWeek` (default 2)
- `pleIntervalWeeks` (default 4)
- `tvCardSize` / `pleCardSize` ranges (defaults 4–6 / 6–8)
- `sliceWeeks` (default 26 — what the `slice` runner uses)
- `popularity`: the surprise/crowd model: segment weights, fatigue penalty,
  movement caps, momentum/anchor behaviour, crowd-ignition odds, and
  `starPower` milestone values. Start by changing `momentumPushFactor`,
  `crowdIgnitionChance`, `lossEdgeBase`, and `gravityFactor`.
- `match`: match-outcome and crowd-response inputs: the four primary skill
  weights, condition, story/intent influence, and performance/crowd variance.
  `starPower` deliberately does not decide a match; it affects booking and the
  durable-status/popularity layer instead.

All tuning fields are optional and schema-defaulted, so a smaller scenario can
override only the values it needs.

## 3. Rules

1. Every id referenced anywhere (title holders, relationship endpoints, story participants) MUST resolve to a roster id — validated at load.
2. Ids are kebab-case and stable; they end up in event logs and URLs.
3. A new game = point the seeder at a different scenario directory. Nothing else changes.
4. The sim MUST behave sensibly on any valid scenario, not just the default — synthetic test worlds are themselves valid scenarios.
5. Real names in a dataset are an authoring choice for private use; the format is name-agnostic.

## 4. Default scenario: `wwe-2026`

A direct remodel of WWE as of early 2026, scoped to the MVP slice (single brand, men's singles — [six-month-slice.md](six-month-slice.md) §5):

- ~40 hand-authored real wrestlers with judged skills, gimmicks, alignments, stances, and starting popularity.
- Titles: **World Heavyweight Championship** (world) and **Intercontinental Championship** (midcard), with their real early-2026 holders.
- Weekly TV (**Raw**) plus a 6-PLE calendar in real order.
- Faction and recent-history relationships seeded (e.g. stable-mates with high mutual trust/influence; fresh rivals with high rivalry).
- One or two active feuds in stories.json so week 1 opens hot.
