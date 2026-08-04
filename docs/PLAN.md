# MVP Prototype — AI Agent Execution Plan

Companion to [GDD.md](GDD.md) (v0.5), the [player decision loop spec](player-decision-loop-spec.md) (v0.2, "the spec"), the [six-month slice spec](six-month-slice.md) ("the slice spec"), the [booking AI vision](booking_ai.md), and the [scenario data spec](scenario-data-spec.md). This plan turns those documents into an ordered set of build phases an AI agent can execute autonomously. Each phase has a goal, concrete tasks, and acceptance criteria that can be verified without human judgement wherever possible.

**Precedence:** GDD owns the overall vision and canonical tick pipeline (GDD §4); the spec owns the player choice structure and all choice vocabularies (its tokens are normative); the booking AI vision owns creative-planning architecture and intent; the slice spec owns the 26-week MVP acceptance bar (SL-1…SL-10); the scenario data spec owns world-data formats; this plan owns execution order. `packages/contracts` is the machine canon for implemented tokens and data formats.

## Guiding decisions (already made — do not re-litigate)

1. **Simulation first, UI last.** The core risk in the GDD is whether the simulation produces careers worth talking about (§21). Build and playtest the sim headlessly before investing in screens.
2. **Monorepo with a framework-independent sim package.** Per GDD §19, the simulation must not import SvelteKit, Supabase, or any LLM SDK.
3. **Deterministic simulation.** All randomness flows through a single seeded RNG passed into the tick function. Same state + same actions + same seed = same result. This makes the sim testable and replayable.
4. **The LLM never mutates game state.** Narrative jobs are produced by the sim as structured facts; narrative output is stored as display text only (GDD §15–16).
5. **Template provider before Ollama.** The narrative provider interface ships with a deterministic template provider and a mock provider first. Ollama is an optional later swap — no phase may block on a local LLM being available.
6. **Manual ticks only** for the prototype. No schedulers, no cron.
7. **Persistence is a snapshot, not event sourcing.** Store the full world state as versioned JSON plus an append-only event log for the dirt sheet. Do not build per-entity relational CRUD for sim internals.
8. **The decision-loop spec is authoritative for player choices.** One interaction slot + one action slot per tick (both tick types), reactive decisions, match/segment intent, persistent stance with next-tick inertia. Stance doubles as the AI utility weighting (spec §7.2). Players see qualitative projections, never raw numbers (spec §8).
9. **Data-driven scenarios.** All world content — promotion, roster, titles, calendar, seed relationships/feuds, cadence config — comes from replaceable `data/<scenario>/` files per the scenario data spec. The sim is scenario-agnostic: no wrestler/title/show name in `packages/sim` or `packages/contracts` source. The default scenario is `wwe-2026`, a direct remodel of WWE (single brand, men's singles, ~40 real wrestlers, World Heavyweight + Intercontinental titles). *(Decided 2026-07-27.)*
10. **The MVP bar is layered.** The simulation must first pass the eight-week/two-PLE creative-booking gate in Phase 3.13, then produce an interesting, wrestling-logical 26-week slice headlessly — feuds that arc to PLE blowoffs, meaningful title lineages, acts that rise *and fall*, visible history. Both gates block narrative/UI phases. Interesting-and-logical beats feature count.

## Repository layout

```
wrestling_career/
  CLAUDE.md
  docs/
    GDD.md
    booking_ai.md
    PLAN.md
    player-decision-loop-spec.md
    six-month-slice.md
    scenario-data-spec.md
  data/
    wwe-2026/             # default scenario dataset (see scenario-data-spec.md)
  package.json            # pnpm workspaces
  packages/
    contracts/            # shared TypeScript types + zod schemas (world state, turns, events, narrative jobs)
    sim/                  # pure domain package: tick engine, match resolution, GM, AI wrestlers, crowd
    narrative/            # provider interface, template/mock/ollama providers, job validation
  apps/
    cli/                  # headless harness: seed world, submit turns, run ticks, dump reports
    web/                  # SvelteKit mobile-first client + server routes (added in Phase 5)
```

Tooling: pnpm workspaces, TypeScript strict, Vitest for tests, one shared tsconfig/eslint base. Keep it minimal — no build orchestration beyond what pnpm scripts need.

---

## Phase 0 — Scaffolding ✅ (done)

**Goal:** Empty but working monorepo.

- Init pnpm workspace with `packages/contracts`, `packages/sim`, `packages/narrative`, `apps/cli`.
- TypeScript strict mode, Vitest wired in every package, a trivial passing test in each.
- Root scripts: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

**Done when:** `pnpm test` and `pnpm typecheck` pass at the root.

---

## Phase 1 — Contracts: the world in types ✅ (done)

**Goal:** The whole GDD vocabulary exists as types and zod schemas in `packages/contracts`. This is the spine everything else hangs on.

Model (keep every numeric system as a small integer scale, e.g. 0–100):

- **Wrestler:** identity, controlled-by (human | ai), 8 skills (GDD §7), condition/physical strain, money, alignment + gimmick block (§9: concept, promo tone, traits, presentation, current direction).
- **Popularity block** (§10): current reaction, general popularity, momentum, heat (positive/negative), fatigue. *Not one number.*
- **Relationship** (directed pair): affinity, respect, trust, rivalry, resentment, influence (§12).
- **Story** (§13): participants, tension (typed enum + free text), stakes, audience interest, momentum, coherence, phase (building | peaking | cooling | resolved), unresolved developments.
- **Show & booking:** card of match slots, each with participants, story link, GM intent.
- **Match result** (§14): winner, per-participant performance, quality, crowd response, physical cost, story advancement, GM/backstage reaction deltas.
- **Player actions:** a flat discriminated union (superseded by Phase 1.5 — see below).
- **World event** (append-only log entry): typed, tick-stamped, references entity ids — the single source for dirt sheet + personal feeds.
- **Narrative job / result** exactly as GDD §16 (jobType, facts, characters+voice, constraints; result headline/body/mentionedCharacterIds).
- **WorldState:** everything above + tick counter + RNG seed, serializable to JSON. Include a `schemaVersion`.

**Done when:** schemas round-trip (parse → serialize → parse) in tests, and an example `WorldState` fixture with 3 wrestlers validates.

---

## Phase 1.5 — Contracts reconciliation with the decision-loop spec ✅ (done)

**Goal:** Reshape `packages/contracts` from the Phase 1 flat action union into the spec's slot-based turn structure, and add the entities the spec introduced. This phase touches only `packages/contracts` (nothing downstream consumes it yet beyond trivial imports).

**Tasks:**

1. **Split `actions.ts`.** The current flat `playerActionSchema` mixes three concepts. Replace with:
   - `interaction.ts` — `interactionSchema`: target (`{ kind: 'gm' } | { kind: 'wrestler', wrestlerId }` — extensible to spec §3.1's post-prototype targets), intent token (spec §3.2–3.3: `request_opportunity`, `pitch_feud`, `pitch_alliance`, `challenge_booking`, `request_promo_time`, `propose_character_change`, `request_feedback`, `offer_help`, `propose_alliance`, `build_trust`, `request_support`, `offer_elevation`, `provoke`, `repair_relationship`, `undermine`, `coordinate_pitch`), optional free-text emphasis. Include an `interactionOutcomeSchema` (`accepted | rejected | deferred | conditional | countered`).
   - `actions.ts` (rewritten) — the action-slot union only, MVP set per spec §12: `train_skill` (carries skill name), `recover`, `promote_match` (carries match slot id), `develop_character` (absorbs old `adjust_gimmick`; carries a `gimmickSchema.partial()`). Old members `pitch_feud`, `ask_for_push`, `support_wrestler`, `undermine_rival`, `improve_relationship`, `speak_to_gm` are deleted — they are interactions now (`ask_for_push` → `request_opportunity`, `support_wrestler` → `offer_elevation` or `request_support` as fits, `improve_relationship` → `build_trust`, `speak_to_gm` → the relevant GM intent).
   - `intent.ts` — `matchIntentSchema` and `segmentIntentSchema` as plain token enums per spec §6.1–6.2 (canonical 9 + 8). Delete the six per-intent action variants (`protect_character`, `make_opponent_look_strong`, `emphasise_story`, `chase_spectacle`, `work_safely`, `take_risks` as *actions*); apply the legacy mapping in spec §6.1 (`make_opponent_look_strong` → `elevate_opponent`, `emphasise_story` → `advance_story`, `chase_spectacle` → `chase_quality`).
2. **New entities:**
   - `stance.ts` — `careerStanceSchema` token enum (spec §7.1, all 9). Document that stance = AI utility-weight preset (spec §7.2).
   - `reactive.ts` — `reactiveDecisionSchema`: id, type token (spec §5.1), target wrestler, originating entity refs (story/match/wrestler ids), offered response tokens (subset of spec §5.2), deadline tick, status (`pending | responded | expired`). Plus `reactiveResponseSchema`.
   - `proposal.ts` — `proposalSchema` for human↔human interactions (spec §3.3): proposer, recipient, originating interaction intent, payload, `deadlineTick` (creation tick + 2), status (`pending | accepted | rejected | countered | ignored`). Expiry resolves as `ignored`.
   - `turn.ts` — `playerTurnSchema`: wrestler id, optional `interaction`, optional `action`, `responses: reactiveResponse[]` + proposal responses, `matchIntents: Record<matchSlotId, matchIntent>` (+ segment intents), optional `stanceChange`. This replaces "array of PlayerAction" as the per-tick submission shape.
3. **WorldState extensions** (`world.ts`): per-wrestler `stance` + optional `pendingStance` (next-tick inertia, spec §7.3); `pendingProposals: Proposal[]`; `pendingReactiveDecisions: ReactiveDecision[]`. Bump `schemaVersion`; no migration code needed (pre-release — regenerate fixtures instead).
4. **Qualitative projections** (`projections.ts`): pure functions mapping numeric state to the player-facing tiers of spec §8.2 — e.g. `relationshipTier(value)` → `hostile | cold | neutral | warm | trusted`, `popularityBand(...)`, `momentumDirection(...)` → `rising | steady | falling`, coarse `skillBand(...)`. These live in contracts so CLI and web render identical projections; the raw numbers never leave the server/sim boundary in player-facing surfaces.
5. **Fixtures and tests** updated to the new shapes; round-trip tests for every new schema.

**Done when:** `pnpm test` and `pnpm typecheck` pass; the fixture world validates with stances, a pending proposal, and a pending reactive decision; a grep of `packages/` finds no legacy tokens (`ask_for_push`, `emphasise_story`, `chase_spectacle`, `make_opponent_look_strong`, `adjust_gimmick`, `speak_to_gm`); every token in spec §§3–7 exists verbatim in contracts.

---

## Phase 2 — Sim core: the tick engine ✅ (done)

**Goal:** `runTick(world, playerTurns, seed) → { world, events, narrativeJobs }` as a pure function in `packages/sim`. This is the heart of the game; spend the most effort here.

Implement the canonical tick pipeline exactly as GDD §4:

1. **Collect turns** — validate submitted `PlayerTurn`s: at most one interaction and one action per wrestler per tick; relationship/state gates (§12: some intents require trust/affinity thresholds); stance changes are queued into `pendingStance` and applied at the *start of the next tick* (spec §7.3). Invalid submissions become "rejected" events, not errors.
2. **AI decisions** — every wrestler has stance-derived utility weights (spec §7.2). AI wrestlers build a full `PlayerTurn` (interaction + action + responses) by utility scoring (ambition vs. loyalty vs. condition; personality weights modulate the stance preset). **Absent human players go through this exact same code path** with safe-fallback behavior — no special cases (DL-7).
3. **GM decisions** — respond to interactions/pitches (weighted by popularity, reliability, relationships, current story needs — §11), with **GM patience**: repeated identical asks within a window reduce receptiveness and trust (spec §4.2). For show ticks: book a card of 4–6 matches by scoring candidate pairings (active stories first, then popularity/momentum, then GM objectives). GM has one active objective from the §11 list, rotating every few weeks.
4. **Resolve interactions and responses** — resolve interactions and reactive-decision responses; deliver new proposals; expire proposals/reactive decisions past their deadline as `ignored`/`expired`, applying the small negative relationship effect for ignoring (spec §3.3).
5. **Resolve the show** (show ticks) — match resolution: skills + condition + chemistry + story context + match intents + seeded variance → winner, quality, performances. Intents come from the canonical enum (spec §6.1). **Conflicting intents** resolve per spec §6.4: a psychology+professionalism-weighted contest decides whose intent dominates; both sides accrue consequences for what they *attempted*. Losing must be able to raise popularity when performance/story warrants it (§14 — hard requirement, add a test). When a booked player set no intent, derive the default from their stance (spec §7.1).
6. **Crowd & popularity update** — reaction from match quality, character clarity, story momentum, surprise; fatigue rises with overexposure; momentum decays. Popularity moves *gradually* — cap per-tick deltas. **Training plateau:** repeated `train_skill` on the same skill has diminishing returns unless refreshed by match experience or working with stronger wrestlers (spec §4.2 — add a test: N consecutive training ticks yield visibly sublinear gains).
7. **Story engine + dramatic director** — advance active stories (audience interest, momentum, coherence), resolve or cool stale ones, and scan for new tension opportunities (§15: underused popular wrestler, repetitive feud, champion lacks challenger, two allies want the same spot). Director proposes; GM adopts. The director is also the source of **reactive decisions** (spec §5): emit 0–2 important ones per player per period, derived from sim state, never disconnected prompts (DL-2); more only during major stories. Participants in the same match/segment MUST receive complementary, non-contradictory prompts (spec §5.4).
8. **Emit events + narrative jobs** — every consequential fact becomes a world event; show recaps, personal summaries, GM messages, and rumours become narrative jobs referencing only facts from events. Player-facing event payloads carry qualitative projections (Phase 1.5 task 4), not raw values.

Two tick types: `decision` and `show`. A week = N decision ticks + 1 show tick (make N configurable, default 2). Both tick types accept full player turns (spec §2).

**Simplifications allowed:** money as simple earn/spend with 3–4 sinks (training, recovery, presentation) that upgrade action quality per GDD §8; injuries as a strain threshold that forces reduced performance, no injury taxonomy; titles as a single championship belt.

**Testing:** unit tests per subsystem, plus property-style tests: determinism (same inputs → identical output), absent players remain simulated via stance fallback, popularity bounded, every match produces all §14 outputs, training plateau and GM patience observable (DL-3), proposals expire correctly.

**Done when:** all tests pass and a 12-week simulated season with 30 AI wrestlers and 0 humans runs without errors, producing a non-degenerate world (title changes hands or is credibly defended, ≥5 distinct stories occur, popularity rankings shuffle).

**Post-implementation amendments (applied after review):**
- Money flows both ways: every match participant earns appearance pay scaled by crowd response (GDD §8 "appearances"), and quality upgrades happen only when a turn explicitly sets `invest: true` on its action — auto-spending was removed so saving stays a real choice. The AI invests above a stance-driven cash reserve.
- `runTick` mixes the tick counter into the seeded RNG, so callers (Phase 3 CLI included) may safely pass a constant seed across ticks without decision rolls repeating.

---

## Phase 3 — CLI harness: headless playtesting ✅ (done)

**Goal:** `apps/cli` lets a human (or the agent itself) play the game in the terminal before any UI exists.

- `seed` — generate a world: 30 AI wrestlers with varied skills/personalities/gimmicks (hand-write ~10 archetypes, vary with RNG), 1 GM, 1+ human-controlled slots.
- `status <wrestlerId>` — career view rendered through the qualitative projections (spec §8): relationship tiers, popularity bands, momentum direction, active stories, money, next booking, current stance, pending proposals/reactive decisions. Raw numbers only behind a `--debug` flag.
- `interact <wrestlerId> <target> <intent> [emphasis]` — fill the interaction slot.
- `act <wrestlerId> <action> [...args]` — fill the action slot.
- `respond <wrestlerId> <decisionId|proposalId> <response>` — answer reactive decisions and proposals.
- `intent <wrestlerId> <matchSlotId> <intent>` — set match/segment intent.
- `stance <wrestlerId> <stance>` — queue a stance change (applies next tick).
- `tick [--count N]` — run ticks, print events.
- `sheet` — render the dirt sheet from the event log (template text is fine at this stage).
- World state persists to a local JSON file between invocations.

**Done when:** the agent can play a 4-week career via CLI exercising all five choice types: pitch a feud, get booked, set an intent, answer a reactive decision, change stance, read the show result, and see relationship/popularity consequences — and the transcript is legible enough to evaluate against GDD §21.

**⚠ Gate:** After this phase, run 2–3 full seasons and write `docs/playtest-notes.md` evaluating against GDD §21 and the spec's design rules DL-1…DL-7 (cite rule IDs): do careers diverge? do stories emerge that don't revolve around one wrestler? does "train stats → champion" fail as a strategy (DL-3)? does an absent player survive a season intact (DL-7)? Tune Phase 2 weights before proceeding. Do not start the UI until this gate passes.

The tuning pass must also close these known Phase 2 gaps (found in review — each currently weakens a promise the spec makes):

1. **Dead reactive types / no named injuries.** The director never generates `injury_decision` or `finish_changed`, though their consequence code exists in `responses.ts`, and no `injury` event is ever emitted. Wire `injury_decision` to a low-condition trigger and `finish_changed` to story-linked bookings (or delete the dead branches), and emit an `injury` event when strain forces reduced performance.
2. **Heel/face turns unreachable for aligned wrestlers.** `turn_proposal` is gated on `alignment === "tweener"`; spec §10's flagship example (GM proposes turning a *face* heel) can never occur. Gate it on alignment/heat contradiction instead (e.g. a face whose negative heat overtakes positive), with the turn flipping toward the crowd's actual reaction.
3. **GM reaction is computed but never consumed.** Fold recent `gmReactionDelta`/`backstageReactionDelta` (windowed event scan, same pattern as patience) into `gmAcceptanceProbability` and `bookingScore`, so refusing a `booking_request` has a GM-side cost (spec §5.2's own example) and being a good soldier pays off.
4. **Accepted GM pitches have no material effect.** An accepted `pitch_feud` should seed or boost a story (may need an optional subject-wrestler field on the interaction), and an accepted `request_opportunity` should boost the wrestler's next-show booking score — otherwise the interaction slot cannot cause the things it exists to cause (GDD §13).

Minor, address opportunistically during the same pass: feed `fatigue` into crowd response (GDD §10 overexposure); the patience/plateau event-log scans are O(all events) and `world.events` grows unboundedly — window or prune before the Phase 6 soak; proposal `counter` currently resolves without creating a counter-proposal.

**Post-implementation amendments (applied after review):**
- All four required gaps and all three minor items above were closed in this pass; see `docs/playtest-notes.md` for the gate write-up and the per-gap evidence from headless seasons.
- Closing gap 4 needed the "optional subject-wrestler field" the plan anticipated: `interaction.ts` gained `subjectWrestlerId` (optional, only meaningful with a `pitch_feud` toward the GM). The CLI's `interact` command exposes it as `--about <wrestlerId>`. This is a new optional field, not a token change, so it needed no spec amendment.
- `apps/cli` has no build step (matching every other package): its `bin` entry and tests run the TypeScript sources directly. Node's own `.ts` type-stripping doesn't rewrite the `./foo.js`-referencing-`foo.ts` NodeNext import style this monorepo uses, so a `tsx` devDependency plus a `"cli": "tsx src/index.ts"` script is the actual way to run it (`pnpm --filter @wrestling/cli run cli -- <args>`), not `node src/index.ts` directly.
- The CLI's `intent` command only wires match intents (`matchIntents`); `segmentIntents` remain unconsumed by `runTick` (`mergeMatchIntents` in tick.ts never reads them) — this is a pre-existing Phase 2 gap, not something this phase's gap list called out, and is left for a future pass since there's no segment-slot entity yet to attach them to.

> **Note (2026-07-27):** this gate ran and passed for the generic world. The MVP was then re-targeted at the six-month slice (guiding decisions 9–10), which adds Phases 3.5–3.7 below. **The Phase 3.7 slice gate now supersedes this one as the condition for starting Phases 4–5.**

---

## Phase 3.5 — WWE world structure

**Goal:** Give the world the structural shape the slice spec requires: show kinds with a PLE calendar, two title lines, card positions, blowoff-aware booking, injury absence, and fall mechanics with teeth. Touches contracts + sim. Everything here stays scenario-agnostic — names and calendars arrive in Phase 3.6.

**Contracts changes** (bump `schemaVersion`, regenerate fixtures):

1. **Show kinds:** `showSchema` gains `kind: "tv" | "ple"`. `matchSlotSchema` gains `position` (`main_event | upper | mid | opener`) and optional `titleId`.
2. **Titles:** replace `championId`/`championSince` with `titles: Title[]` — `titleSchema`: id, name, `tier` (`world | midcard`), optional `holderId`/`since`. Lineage stays derived from `title_change` events (which gain a `titleId` in `data`). World superRefine: holder ids resolve; at most one title per id.
3. **World config:** `worldStateSchema` gains a `config` block sourced from scenario config: `decisionTicksPerWeek`, `pleIntervalWeeks`, `tvCardSize`/`pleCardSize` ranges, `sliceWeeks`. `booking.ts`'s hardcoded cadence constants move here (defaults preserved).

**Sim changes:**

4. **Calendar-aware booking:** show tick kind derives from week number + `pleIntervalWeeks`. TV cards use `tvCardSize`, PLEs `pleCardSize`. PLE booking priorities: (a) every peaking story gets a **blowoff** slot, (b) each title is defended — world title in the main event, midcard title in an upper slot — against the highest-scoring eligible contender (story participant first, then popularity/momentum/GM-reaction), (c) remaining slots by the existing scoring. TV booking: build story matches (non-blowoff pairings, promos-by-proxy), test lower-card acts, **avoid** title changes: title matches on TV are allowed but rare and story-justified.
5. **Blowoff resolution:** a peaking story whose participants meet on a PLE resolves after that match (winner takes the momentum; relationship consequences land). High-quality, close blowoffs MAY extend one more PLE (rematch demand) — once. Stories no longer resolve purely by interest decay while their blowoff is booked.
6. **Card position effects:** popularity/reaction swings and appearance pay scale by position (main event > upper > mid > opener). GM assigns positions from title involvement + popularity; working above your popularity is an opportunity, bombing in the main event costs more.
7. **Injury absence:** wrestlers below a bookable-condition threshold (~40) are excluded from booking until recovered; the AI brain already prioritizes `recover` when hurt. Emits the absence arc SL-8 needs (injury event exists since the Phase 3 pass; this adds the missed-shows consequence and the return).
8. **Falls with teeth:** (a) losing streaks (≥3 losses in the window) drag momentum and credibility, (b) sustained overexposure produces net popularity *decline*, not just damped growth, (c) the GM's `cool_down_overexposed_act` objective actively books the act down the card or off shows. Together these must make SL-2/SL-3 achievable.

**Testing:** title lineage per belt; PLE cadence from config; blowoff-at-PLE behavior (peaking story booked and resolved at PLE); position assignment sanity; injured wrestler skips ≥1 show then returns; a scripted losing-streak/overexposure scenario produces net popularity decline.

**Done when:** all tests pass; a 26-week synthetic-world run books 6 PLEs and ~20 TV shows, defends both titles per SL-4/SL-5 shape, and produces at least one blowoff-resolved story at a PLE.

---

## Phase 3.6 — Scenario data & the `wwe-2026` dataset

**Goal:** World content moves out of code into `data/<scenario>/` per the scenario data spec; the default WWE dataset exists and loads.

1. **Contracts:** `scenario.ts` — schemas for scenario.json, promotion.json, roster.json, titles.json, relationships.json, stories.json, config.json exactly per scenario-data-spec.md, plus a combined `scenarioSchema` with cross-file referential-integrity checks (every referenced id resolves to a roster id).
2. **Sim:** pure `worldFromScenario(scenario, seed) → WorldState` — no file I/O; assigns starting stances/popularity from data; wrestlers all start `ai`.
3. **CLI:** `seed --scenario <id> [--humans N]` reads `data/<id>/`, validates file-by-file (validation errors name the file and path), converts, persists. The synthetic generator in `test-helpers.ts` remains for unit tests only.
4. **Author `data/wwe-2026/`:** ~40 real WWE men's singles wrestlers (early-2026 knowledge): judged skills, alignments, gimmicks, stances, starting popularity per the authoring guidance; World Heavyweight + Intercontinental titles with real holders; weekly TV (Raw) + 6-PLE calendar in real order; faction/history relationship seeds; 1–2 hot feuds in stories.json.
5. **Scenario-agnosticism check:** a test (or lint grep) asserts no `data/` names appear in `packages/` source.

**Done when:** the dataset validates; `seed --scenario wwe-2026` produces a valid world; a 26-week headless run on it completes; the grep check passes.

---

## Phase 3.7 — Slice tuning & validation ⚠ THE GATE

**Goal:** Tune the simulation until the default scenario's six-month slice meets the slice spec — the whole point of the MVP re-target.

1. **CLI `slice` command:** `slice --scenario wwe-2026 --seeds N [--weeks 26]` runs N headless slices, sampling popularity weekly, and emits a markdown report per seed plus a combined verdict: every SL-1…SL-10 criterion computed and marked pass/fail, plus title lineages, story timelines (start → blowoff), PLE cards, injury/return arcs, and each wrestler's popularity trajectory sparkline. The report is the tuning instrument — it must make *why* a criterion failed visible.
2. **`slice.test.ts` (sim):** encodes the MUST criteria against the default scenario on 3 fixed seeds — the regression net that keeps later phases from silently breaking the slice. Long-running; keep it a single describe block so it can be filtered.
3. **Tune:** iterate on weights (booking scores, popularity deltas, fall mechanics, story pacing, GM behavior) until all MUSTs pass on the 3 fixed seeds and SHOULDs pass on a majority of 10 seeds. Record every tuning change and its observed effect in `playtest-notes.md` (append a "slice tuning" section, cite SL ids).
4. **Qualitative gate:** per slice spec §3 — read one full slice end to end; write the verdict in `playtest-notes.md` naming one rise story and one fall story in plain wrestling terms.

**Done when:** `slice.test.ts` is green; the qualitative write-up exists and is positive. **Do not start Phases 4–5 until then.**

---

## Phase 3.7.1 — Popularity model redesign (surprise-based, anchored) ⚙ within the gate

**Goal:** Replace the skill-chasing popularity update — which lets high-workrate lower-card acts drift up for free and lets flat penalties ratchet others to zero — with the four-timescale, surprise-driven model in **GDD §10**. Movement must be *earned and bounded*, and every notable move must surface as a `popularity_changed` event the narrative layer can explain. This is a structural change fed into the 3.7 tuning loop; the constants below are **starting points to tune against `slice`, not final values**. It stays scenario-agnostic (no dataset names in `packages/`) and touches contracts + sim + data.

### Tokens & schema (machine canon — land with GDD §10 in the same change)
1. **`starPower`** — add to `popularityBlockSchema` in [packages/contracts/src/popularity.ts](packages/contracts/src/popularity.ts) as `scale100Schema`, the earned-status anchor (GDD §10.2). Update `packages/contracts/src/fixtures.ts` and any `test-helpers` popularity factories so every block carries it.
2. **`popularityChangeReasonSchema`** — add an exported `z.enum` in contracts with the normative tokens from GDD §10.3: `breakout`, `crowd_ignition`, `upset`, `burial`, `overexposure`, `slump`, `status_rise`, `status_fall`. The `popularity_changed` event's `data` stays the loose record, but its `reason` MUST be one of these and `direction` MUST be `rise` | `fall`.
3. **Scenario data:** add `starPower` to every entry's popularity block in `data/<scenario>/roster.json` (seed `= generalPopularity` unless the authoring exceptions in scenario-data-spec apply). `scenario.ts:24` already `structuredClone`s the block, so no seeding-code change; the scenario zod validation in [packages/contracts/src/scenario.ts](packages/contracts/src/scenario.ts) picks the field up automatically once the schema has it.

### Sim rewrite — [packages/sim/src/popularity.ts](packages/sim/src/popularity.ts)
`updatePopularity` currently ignores `ctx` (`_ctx`); it now needs it for `addEvent`/`ids`. Per **participant appearance**:
```
segment  = 0.55·performanceScore + 0.35·crowdResponse + 0.10·storyAdvancement − max(0, fatigue−50)·0.3
expected = trailing mean of this wrestler's last 5 segments (seed first-ever appearance = segment ⇒ surprise 0)
edge     = won ?  +max(0, oppAvgPop − generalPopularity)·0.5
                : −max(0, generalPopularity − oppAvgPop)·0.5 − 3
surprise = (segment − expected) + edge
momentum        = clamp(momentum·0.7 + surprise·0.3, −100, 100)
currentReaction = moveToward(currentReaction, segment, 15)
gravity  = (starPower − generalPopularity)·0.05
push     = momentum·0.15·(momentum ≥ 0 ? (1 − pop/100) : (pop/100))     // diminishing near ceiling/floor
generalPopularity += clampStep(gravity + push, ±3)                       // POP_MAX_STEP = 3
```
`oppAvgPop` = mean `generalPopularity` of the other participants. `expected` is computed from `world.matchResults` history (same pattern as today's 3-loss lookup at [popularity.ts:93-95](packages/sim/src/popularity.ts#L93-L95)) — no new stored field. Keep the existing `fatigue += physicalCost·0.3` and the face/heel/tweener heat moves.

Per **idle tick** (no appearance): keep `currentReaction → generalPopularity` (step 5), `momentum ×= 0.85`, `fatigue −= 3`; add gentle anchor settle `generalPopularity += clampStep((starPower − generalPopularity)·0.03, ±1)`.

**Delete:** the `popularityTarget = (currentReaction + performanceScore)/2` block, the flat `−3` on 3-straight-losses, and the flat `−3 pop / −5 momentum` at `fatigue ≥ 65` (all replaced above — overexposure now flows through `segment`, losing through `edge`).

### starPower milestones (the only durable movers)
- Title win/loss applied where `title_change` is emitted ([title.ts](packages/sim/src/title.ts) / [match.ts](packages/sim/src/match.ts)): world `+12 / −10`, midcard `+8 / −6`.
- PLE main event with `crowdResponse ≥ 70`: `+2`, once per show.
- Momentum held `≥ +25` for ≥3 consecutive weeks: `+1/week`; held `≤ −25`: `−1/week` (detect from the momentum trajectory / recent events).
- Clamp `starPower` to `[0,100]`. Each milestone that moves the anchor emits `status_rise` / `status_fall`.

### Moments & event surfacing
- **`crowd_ignition`** — rare seeded flavour, e.g. `ctx.rng.fork("moment:"+id).chance(0.04)` per appearance → momentum spike `+20…30` and a reaction bump. This is load-bearing for **SL-3** (keeps the mid/lower card from flatlining) — tune its rate deliberately, don't drop it.
- **Emit `popularity_changed`** when a moment/milestone fires OR `|Δ generalPopularity|` this appearance `≥ 2` OR momentum crosses `±25`. Map to `reason`: large positive `segment − expected` → `breakout`; large positive/negative `edge` → `upset` / `burial`; high fatigue dulling a face who's slipping → `overexposure`; momentum crossing `−25` → `slump`; anchor moved → `status_rise` / `status_fall`; the random moment → `crowd_ignition`. `summary` is a qualitative fact (no numbers); `data = { reason, direction, ... }`. Routine drift emits nothing. These flow to the narrative layer for free via `buildNarrativeJobs` (dirt-sheet + personal-summary jobs already include all tick events) — no narrative change required now.
- **Projections:** confirm `starPower` is **not** leaked in [packages/contracts/src/projections.ts](packages/contracts/src/projections.ts) — the player-facing popularity band + rising/steady/falling indicator stay derived from `generalPopularity`/`momentum` only (spec §8.2).

### Tests
- `packages/sim/src/popularity.test.ts`: routine-at-baseline ⇒ ~no change; breakout/upset ⇒ momentum & pop rise (capped at 3); burial & sustained losing ⇒ fall with a floor (never 0 from one streak); anchor gravity pulls an idle over/under-performer back toward `starPower`; a title win raises `starPower`; a `popularity_changed` event with a valid `reason` fires on a moment and does **not** fire on quiet drift.
- Update `phase35.test.ts` / `season.test.ts` expectations touching popularity fields.
- Re-run the 3.7 `slice` harness; record deltas and SL-1/2/3/7/10 effects in `playtest-notes.md` under the "slice tuning" section, citing SL ids.

**Done when:** contracts/sim/data all typecheck with `starPower`, the popularity unit tests are green, no raw numbers leak into projections, and the 3.7 slice gate still passes (or is closer, with the report showing *why*). Constants remain open for 3.7 tuning.

### Follow-up: reinstate card-position weighting (found in review, 2026-07-27)

The pre-3.7.1 model scaled `REACTION_MAX_STEP`/`POPULARITY_MAX_STEP` by `CARD_POSITION_MULTIPLIER` (main_event 1.3× … opener 0.8×, [match.ts:39](../packages/sim/src/match.ts#L39)) so a bigger spot moved the needle further. The rewrite dropped this: `CARD_POSITION_MULTIPLIER` now only scales appearance pay ([match.ts:172](../packages/sim/src/match.ts#L172)); nothing in `segmentFor`, `reactionMaxStep`, or `popularityMaxStep` considers `slot.position` any more (the only remaining tie is the specific PLE-main-event-at-70+-crowd star-power bonus). A great opener currently moves popularity exactly as much as a great main event, stakes aside — which undersells "the wrestler's current spot on the card" (GDD §10's own description of `generalPopularity`).

Reinstate it against the *segment*, not the raw step caps, to keep the anchored/bounded shape 3.7.1 built: `updatePopularity` needs the resolved `slot` before calling `segmentFor` (currently looked up afterward, at [popularity.ts:172](../packages/sim/src/popularity.ts#L172) — move that lookup earlier), then fold a `positionWeight` (starting point: `main_event 1.2, upper 1.1, mid 1.0, opener 0.9`) into the segment value or into `edge` — a bigger stage should raise the stakes of both over- and under-performing, not just widen the cap. Tune this alongside the SL-1/2/3 gap the direction fix opened up (see the "settles idle popularity" fix committed this session) — a stakes-aware segment may itself help close some of that gap, since main-event swings carry more weight without loosening the per-appearance cap for everyone else.

**Done when:** a scripted test shows the same underlying performance producing a larger `|Δ generalPopularity|` in a main event than in an opener; `slice.test.ts` re-run alongside the SL-1/2/3 retune this follow-up is bundled with.

---

## Phase 3.7.2 — Booking realism: tiered rotation & multi-way matches

**Goal:** Close two booking gaps found in review. (a) `gm.ts`'s rotation scoring lets high-popularity wrestlers dominate every open slot indefinitely — nothing distinguishes "protected star being paced" from "filler getting a look," which is backwards from what a real card looks like. (b) `matchSlotSchema`/`resolveMatch`/`updatePopularity` already generalize cleanly to 3+ participants — no code assumes exactly 2 (`resolveMatch` maps every calculation over `participants`/`rawScores` arrays; `popularity.ts`'s opponent-average calc already filters `participantWrestlerIds` down to "everyone but me") — but `bookShow` never constructs a slot bigger than a pair. Both are additive to the existing booking pipeline, not a rewrite of it.

### 1. Tiered rotation (rest the stars, keep undercard churn)

Today's `rotationScore` ([gm.ts:204-219](../packages/sim/src/gm.ts#L204-L219)) is `bookingScore − appearances·7 + max(0, 3−appearances)·100 + returnBonus`. Since `bookingScore` includes raw `generalPopularity`, a wrestler in the 80-90 popularity range needs on the order of a dozen consecutive appearances before the `-7`/appearance penalty catches up — in practice a top guy not currently absorbed into a story/title slot outranks the rest of `remaining` almost every single week. That's backwards from the ask: a star not tied to an active program should rest *more*, not less; undercard rotation without a story attached is *supposed* to look scattershot, and already does.

- Add a `recentlyAppeared(wrestlerId)` check — did this wrestler work the immediately preceding show (same windowed-scan pattern as `recentPerformanceReaction`/`patience.ts`).
- Add a popularity-tiered rest penalty to `rotationScore`, applied only within the `remaining` pool — story/title slots are earned appearances and stay exempt, since a star mid-feud should still work every week. If `generalPopularity >= restTierThreshold` (starting point: 65) and `recentlyAppeared`, subtract a `restPenalty` large enough to usually cede the slot to someone else next show (starting point: 150 — bigger than the realistic `bookingScore` gap between two contending stars). No penalty below the threshold, so undercard rotation keeps its existing, intentionally noisy behavior.
- New config fields (extend `worldConfigSchema` or add a small `bookingTuningSchema` alongside `popularityTuning`/`matchTuning`): `restTierPopularityThreshold`, `restPenalty`.

### 2. Multi-wrestler matches

Scope: triple threats and fatal four-ways (cap at 4 participants), sourced from the undercard rotation pool only — not story or title slots. That keeps this pass additive and sidesteps two larger design questions this phase deliberately defers: a multi-way *title* match (would need `highestScoringContender` to pick more than one contender) and a 3-participant *story* (`director.ts`'s `scanForNewStory` always creates exactly 2-participant stories today, [director.ts:83](../packages/sim/src/director.ts#L83); a 3-way blowoff isn't reachable until/unless that changes). Both are natural follow-ups, not required here.

- Generalize the two `story.participantWrestlerIds.length === 2` filters in `bookShow`'s PLE-blowoff and TV-story loops ([gm.ts:141](../packages/sim/src/gm.ts#L141), [gm.ts:180](../packages/sim/src/gm.ts#L180)) to `>= 2` and stop destructuring `[a, b]`. Free, forward-compatible, zero behavior change today since no story is ever created with 3+ participants yet — but it means the booking side won't silently strand a multi-party story if the director ever grows one.
- In the `remaining`-pool loop ([gm.ts:220-224](../packages/sim/src/gm.ts#L220-L224)), before falling back to pairing exactly 2, roll a config-driven `multiWayChance` (starting point: 0.15 per TV show) to instead pull 3 or 4 off the top of the ranked `remaining` list (whichever fits the slot budget) into one `slot()` call. `resolveMatch`/`updatePopularity` need no code changes — both already iterate `participantWrestlerIds` generically; this is purely a `gm.ts` construction change.
- `winnerWrestlerId` stays singular (the existing max-raw-score pick), which is already correct for "won the triple threat" — no schema change needed there.
- New config: `maxMultiWayParticipants` (default 4), `multiWayChance`.

**Testing:** a scripted test books a multi-way when the roll hits and confirms `resolveMatch` produces correct performances/payouts for 3-4 participants (a regression guard, not new logic — this should already pass); a test confirms a wrestler above `restTierPopularityThreshold` who worked last show is deprioritized this show unless in a story/title slot; re-run `slice.test.ts` — packing more wrestlers per slot changes how many distinct people a show can carry, so verify SL-9 ("nobody appears on every show") still holds alongside the rest-penalty change.

**Done when:** `slice.test.ts` passes (or the report shows why not, same bar as 3.7.1); a 26-week run shows at least one multi-way match and at least one top-5-popularity wrestler sitting out a show it wasn't story-obligated to work; `playtest-notes.md` gets a short section citing the SL ids affected.

---

## Phase 3.7.3 — Roster roles: status vs usage, scarcity & absence ⚙ within the gate

**Goal:** 3.7.1 captures *how big* a wrestler is (`starPower`) but not *how the promotion uses them*. A full-time champion and a semi-retired legend can share `starPower` 92 yet must be booked in opposite rhythms — weekly vs rarely-but-huge — so usage cannot be derived from status; it is an authored **`role`** axis (GDD §10.5). This phase adds that field, makes the popularity curve role-aware (scarcity rewards rare big stars, overexposure punishes them, absence stops uniformly eroding everyone), and gates booking by role. Additive to 3.7.1/3.7.2. **Every new number is a scenario-tunable knob in `config.ts` — nothing inline** (the slice loop must retune without editing sim code). Stays scenario-agnostic.

### Tokens & schema (contracts)
1. **`role`** — add `roleSchema = z.enum(["legend", "part_timer", "regular", "prospect"])` and a required `role` on `wrestlerSchema` ([wrestler.ts](../packages/contracts/src/wrestler.ts)). Bump `schemaVersion`; regenerate `fixtures.ts`.
2. **`rolesTuningSchema`** — a per-role parameter block in [config.ts](../packages/contracts/src/config.ts), keyed by role token, `.default({})` at each level, added to `worldConfigSchema` as `roles`. Starting-point defaults:

   | param | legend | part_timer | regular | prospect |
   | --- | --- | --- | --- | --- |
   | `idealGapWeeks` | 8 | 3 | 1 | 2 |
   | `scarcityMagnitude` | 1.0 | 0.6 | 0.15 | 0.15 |
   | `overexposureSensitivity` | 2.0 | 1.4 | 1.0 | 0.8 |
   | `relevanceDecay` (bool) | false | false | **true** | false |
   | `storyGated` (bool) | true | true | false | false |
   | `titleEligibility` | `none` | `all` | `all` | `midcard` |

3. **New top-level `popularityTuning` knobs** (scarcity + absence — add to `popularityTuningSchema`, all defaulted): `scarcityCrowdBonusMax` (18), `scarcityStarPowerFloor` (55 — below this `starPower`, scarcity pays ~nothing), `relevanceGraceWeeks` (3 — absence within this is free for everyone), `relevanceDecayRatePerWeek` (2), `relevanceDecayCap` (20), `relevanceHardFloor` (10), `rubStarPowerGain` (3).

### Sim — popularity ([popularity.ts](../packages/sim/src/popularity.ts))
4. **Scarcity ↔ overexposure (one axis).** Derive `gapRatio = weeksSinceLastAppearance / roles[role].idealGapWeeks` from match-result history (same derive-don't-store pattern as `expectedSegment`, [popularity.ts:46](../packages/sim/src/popularity.ts#L46)). Fold a two-sided modifier into `segmentFor` ([popularity.ts:38](../packages/sim/src/popularity.ts#L38)): `gapRatio > 1` adds a scarcity bonus `min(scarcityCrowdBonusMax, (gapRatio−1)·k) · roles[role].scarcityMagnitude · clamp01((starPower − scarcityStarPowerFloor)/(100 − scarcityStarPowerFloor))`; `gapRatio < 1` scales the existing `overexposureFatigueFloor` penalty by `roles[role].overexposureSensitivity`. This subsumes the current flat overexposure term.
5. **Absence = heat decay + bounded relevance dip (regulars only).** In the idle branch ([popularity.ts:138-148](../packages/sim/src/popularity.ts#L138-L148)) replace the `starPower`-only gravity target with `effectiveAnchor`:
   ```
   relevancePenalty = (roles[role].relevanceDecay && weeksOut > relevanceGraceWeeks)
       ? min(relevanceDecayCap, (weeksOut − relevanceGraceWeeks)·relevanceDecayRatePerWeek) : 0
   effectiveAnchor  = max(relevanceHardFloor, starPower − relevancePenalty)
   ```
   Gravity pulls `generalPopularity` toward `effectiveAnchor` (still bounded by `idleGravityFactor`, ±1/tick). It **asymptotes at a floored anchor rather than subtracting each tick** — the property whose absence caused the pre-3.7.1 crash-to-zero. `starPower` is never touched by absence. Non-`regular` roles have `relevanceDecay:false` ⇒ anchor stays `starPower` ⇒ absence is pure heat decay, as their scarcity requires.
6. **The rub.** When `won` and any opponent's `role` is `legend`/`part_timer`, `adjustStarPower(winner, rubStarPowerGain, …)` and emit `status_rise` — the legend's mechanical output is making the other act. (Beating a ceiling-pinned opponent already boosts `edge` at [popularity.ts:176](../packages/sim/src/popularity.ts#L176); this adds the durable step.)

### Sim — booking ([gm.ts](../packages/sim/src/gm.ts))
7. **Story-gate rare roles.** Filter `roles[role].storyGated` wrestlers out of the open `remaining` pool ([gm.ts:209](../packages/sim/src/gm.ts#L209)) entirely; they reach the card only through the story-slot and PLE/title passes that run earlier ([gm.ts:141-201](../packages/sim/src/gm.ts#L141-L201)). "Every appearance has meaning" becomes an eligibility rule.
8. **Role-relative cadence.** Generalize the 3.7.2 rest penalty ([gm.ts:230](../packages/sim/src/gm.ts#L230)) from a single popularity threshold to a `gapRatio < 1` penalty scaled by role, so a `part_timer` slipping into an open slot is still paced (mostly relevant to `regular`/`prospect`, since gated roles never enter this pool).
9. **Title eligibility.** `highestScoringContender` and the title passes respect `roles[role].titleEligibility`: exclude `legend` (`none`), cap `prospect` to `midcard`.
10. **Prospect investment.** Ensure prospects win a fair share of undercard slots (rides the existing `capitalise_on_rising_star`/`new_main_eventer` objectives) so their `starPower` actually climbs — this is what an SL-1 rise looks like for a built-from-below act.

### Data
11. Author `role` on every wrestler in `data/<scenario>/roster.json` (wwe-2026: a couple `legend`/`part_timer`, the youngest as `prospect`, the rest `regular`). `scenario.ts` validation carries the field once the schema has it; scenario-data-spec updated.

### Testing
12. `popularity.test.ts`: a fresh `legend` appearance beats its baseline via scarcity → big momentum, ceiling-pinned pop; the same legend booked again next week eats an overexposure penalty; a `regular` gone past grace drifts toward `starPower − cap` and no further (never 0) while a `legend` gone the same span holds flat; beating a legend fires `rubStarPowerGain` + `status_rise`.
13. Booking test: a `legend` never appears in an open rotation slot or a `titleId` slot; a `part_timer` only books when story-attached.
14. Re-run `slice`. **Known weak joint: SL-9 (everyone ≥3 matches, nobody every show) vs rare roles — `legend.idealGapWeeks` must keep them at ≥3 matches / 26 weeks. Tune it explicitly and record the margin.** Log SL-1/2/3/7/9 effects in `playtest-notes.md`.

**Done when:** contracts/sim/data typecheck with `role`; popularity + booking unit tests green; a 26-week run shows legends/part-timers appearing rarely-but-meaningfully, no wrestler crashing from absence, SL-9 intact; every constant introduced lives in `config.ts` tuning, none inline.

---

## Phase 3.7.4 — Heat-ranked card builder: decouple the main event from the belt ⚙ within the gate

**Goal:** The card is organized *around belts* — three hard rules in [gm.ts](../packages/sim/src/gm.ts) make every PLE feel stamped from a template: mandatory title defences ([gm.ts:170-187](../packages/sim/src/gm.ts#L170-L187)), the world title pinned to `main_event` at every PLE (`assignPositions`, [gm.ts:127](../packages/sim/src/gm.ts#L127)), and an anti-rematch guard that forbids a title feud from continuing ([gm.ts:158-163](../packages/sim/src/gm.ts#L158-L163)). Reorganize booking **around programs (feuds) ranked by heat**, with a title as one kind of *stakes* a program carries, not the skeleton of the show. This is a contained, additive change to three spots — not a rewrite of `bookShow`'s slot-assembly passes. Every new number is a `bookingTuning` config knob. Stays scenario-agnostic.

### The reframe
A **program** ≈ an active story (or a champion-vs-contender pairing). Its **heat** decides where it lands on the card; the hottest closes the show, belt or not. This *helps* SL-7 (main-event variety) and, with a staleness clock, preserves SL-4/SL-5 (defence counts).

### Tuning (contracts — extend `bookingTuningSchema`, [config.ts](../packages/contracts/src/config.ts), all defaulted)
1. Heat weights: `heatStoryMomentumWeight` (0.5), `heatParticipantMomentumWeight` (0.3), `heatParticipantPopularityWeight` (0.1), `grudgeHeatBonus` (15 — story `tensionType` is a personal/rivalry kind).
2. Stakes: `worldTitleStakesHeatBonus` (30), `midcardTitleStakesHeatBonus` (12). These usually keep a world-title match on top (it's normally the hottest) without *forcing* it there.
3. Title-defence policy: `titleDefenseStalenessWeeks` (8 — a belt not defended in this long *must* be defended, the SL-4/5 floor), `contenderReadyMomentumThreshold` (20 — a challenger this hot earns a shot).

### Sim — [gm.ts](../packages/sim/src/gm.ts)
4. **`programHeat(slot)` helper.** `story ? story.audienceInterest + story.momentum·heatStoryMomentumWeight : 0` + `Σ participant.momentum·heatParticipantMomentumWeight` + `Σ participant.generalPopularity·heatParticipantPopularityWeight` + title-stakes bonus (by tier) + grudge bonus. Rotation matches (no story, no title) score low and settle to the undercard naturally.
5. **Rewrite `assignPositions`** ([gm.ts:114-132](../packages/sim/src/gm.ts#L114-L132)): rank by `programHeat` **descending**, for both `tv` and `ple`; assign `index 0 → main_event`, `1 → upper`, `last → opener`, else `mid`. Delete the `titleWeight`-first sort and the `title?.tier === "world" && kind === "ple" → main_event` hard override ([gm.ts:127](../packages/sim/src/gm.ts#L127)) — world-title placement now comes from its stakes bonus, so it usually still main-events but a hotter grudge can win the spot.
6. **Conditional title defences** — replace the mandatory pass ([gm.ts:170-187](../packages/sim/src/gm.ts#L170-L187)). For each title at a PLE not already staked by the peaking-blowoff pass: defend iff a contender is *ready* (a bookable non-holder with `momentum ≥ contenderReadyMomentumThreshold`, or a holder story participant) **or** the belt is *stale* (weeks since its last defence, derived from `title_change`/match history, `≥ titleDefenseStalenessWeeks`). Otherwise leave it undefended this PLE — the champion falls through to the story/rotation passes (works a non-title match, or, once Phase 3.8 lands, a promo). Keep world-title matches PLE-only (don't let the contender-ready branch put one on TV) so SL-4's "≥80 % at PLEs" holds.
7. **Soften the rematch guard** ([gm.ts:158-163](../packages/sim/src/gm.ts#L158-L163)): allow a peaking title feud to repeat when its `programHeat` is top-of-card (a genuine trilogy main event); otherwise keep rotating a fresh challenger as today. Full stipulation-escalation of rematches is the separate "match finishes" thread — this only stops *forbidding* the continuation.

### Testing
8. `gm`/booking tests: a high-heat non-title story outranks a low-heat title defence for `main_event`; a belt with no ready contender and within the staleness window goes undefended at a PLE; a stale belt is force-defended; a hot peaking title feud can rematch.
9. Re-run `slice`. Watch the criteria this most affects: **SL-7** (expect main-event variety to improve), **SL-4/SL-5** (tune `titleDefenseStalenessWeeks` so world defences ≥4 and IC ≥5 still clear — this is the joint to verify), **SL-6** unaffected. Record the SL deltas and the staleness value chosen in `playtest-notes.md`.

**Done when:** booking tests green; a 26-week run shows at least one PLE main-evented by a non-title program and at least one PLE where a title goes undefended, while SL-4/5/7/9 all still pass; every constant lives in `config.ts` tuning, none inline.

---

## Phase 3.7.5 — Tether popularity to earned status; make getting over scarce ⚙ within the gate

**Goal:** Fix a runaway that lets an initially-midcard act ride a win streak to the top of the company (observed: a 67-`starPower` wrestler reaching `generalPopularity` 100 in a 26-week slice, above his own earned status of 77). Two causes: (a) a **correctness bug** — `generalPopularity`'s gain ceiling is measured against 100 instead of against `starPower`, so momentum can push the meter arbitrarily far above earned status; (b) **swing-amplifying tuning** in `wwe-2026/config.json`. Also make "getting over" (`starPower`) hard and achievement-gated so the top tier stays **scarce — not everyone can be over** (GDD §10.2). This is a stability/correctness fix; **sequence it early**, before further slice tuning, since it changes the shape of every popularity trajectory. Scenario-agnostic; the one new number is a config knob.

### Tuning knob (contracts — [config.ts](../packages/contracts/src/config.ts))
1. Add `popularityBand` to `popularityTuningSchema` (default 12): how far a hot streak may lift `generalPopularity` above `starPower` before gains flatten.

### Sim — the tether ([popularity.ts](../packages/sim/src/popularity.ts))
2. **Redefine the gain ceiling.** Replace the headroom term at [popularity.ts:229](../packages/sim/src/popularity.ts#L229) for the gain case (`momentum ≥ 0`):
   ```
   ceiling  = min(100, starPower + popularityBand)
   headroom = clamp((ceiling − beforePopularity) / popularityBand, 0, 1)
   ```
   Push then vanishes as the meter approaches `starPower + band`, and the existing gravity term (`(starPower − pop)·gravityFactor`, already negative when the meter is above earned status) actively pulls it back. Net: `generalPopularity` can sit at most ~`band` above `starPower`. Leave the loss case (`momentum < 0`) as-is (`beforePopularity/100`) so active falls — burials, slumps — still have room below the anchor.

### Sim — achievement-gate `starPower` ([popularity.ts](../packages/sim/src/popularity.ts))
3. **Close the "grind status from wins" loophole.** The sustained-momentum → `starPower` *gain* at [popularity.ts:250-254](../packages/sim/src/popularity.ts#L250-L254) lets any hot act accrue permanent status from ordinary matches. Either drop the gain side, or gate it behind the wrestler being in a title/main-event program. Keep the **slump** side (sustained negative momentum can still cost status — that's an active fall). After this, the real `starPower` routes are **title wins, PLE main events, and the rub** (beating a `legend`/`part_timer`, per 3.7.3) — all scarce, which is what makes the top tier scarce: with two titles and a handful of main-event spots, only a few wrestlers can ever reach ~80+ `starPower`, and therefore ~90+ popularity.

### Data — reset the swing tuning ([data/wwe-2026/config.json](../data/wwe-2026/config.json))
4. Walk the `popularity` block back from swing-maximizing to stable (starting points, re-tune in the slice loop):

   | knob | current | target |
   | --- | --- | --- |
   | `crowdIgnitionChance` | 0.42 | 0.06 |
   | `momentumPushFactor` | 10 | 5 |
   | `momentumDecayFactor` | 0.95 | 0.85 |
   | `momentumMemoryFactor` | 0.7 | 0.4 |
   | `momentumSurpriseFactor` | 1.0 | 0.6 |
   | `popularityMaxStep` | 6 | 3 |
   | `idleGravityFactor` | 0.003 | 0.01 |
   | `popularityBand` (new) | — | 12 |

### Testing
5. `popularity.test.ts`: a wrestler with `starPower` 70 on a long win streak converges near ~82 (`starPower + band`) and **cannot** reach 95 without `starPower` rising first; winning a title raises `starPower`, which raises the ceiling, which lets the meter climb further; a top star (`starPower` 92) recovers toward ~92 after an off-month rather than bleeding out.
6. Re-run `slice`. This is the joint to verify: **SL-1 (≥3 rise ≥15) must still pass — but now a 15-point rise should require a title win or main-event run, not a TV streak.** Confirm the top tier is not crowded (few wrestlers above ~88) and that the #1 act is a title-holder / main-eventer, not a hot midcarder. Record which risers earned it, and the retuned constants, in `playtest-notes.md`.

**Done when:** `popularityBand` exists in config; the tether and `starPower` gating are in `popularity.ts`; `wwe-2026/config.json` is reset; a 26-week run shows no meter running far above earned status, a scarce top tier, and SL-1/2/3/7/10 intact; every constant lives in config, none inline.

---

## Phase 3.8 — Promo, angle, and skit segments ✅ (done)

**Goal:** Give the show card a non-match segment type — the promo/interview/angle beat that advances a story or shifts heat without a competitive outcome. This closes a gap the contracts layer already anticipated: `segmentIntentSchema`'s 8 tokens (`build_sympathy`, `generate_hostility`, `promote_opponent`, `escalate_rivalry`, `show_vulnerability`, `protect_mystery`, `seek_controversy`, `stay_controlled` — [intent.ts:20-29](../packages/contracts/src/intent.ts#L20-L29)) and `PlayerTurn.segmentIntents` ([turn.ts:22](../packages/contracts/src/turn.ts#L22)) have existed since Phase 1.5 with nothing to attach them to — Phase 3's post-implementation notes call this out explicitly (above, "the CLI's `intent` command only wires match intents… left for a future pass since there's no segment-slot entity yet to attach them to"). This phase builds that entity.

Bigger than 3.7.2 — touches contracts, sim (booking, resolution, popularity, story engine), and lightly the CLI. Phase 3.8 is the prerequisite for the creative-booking slice in Phases 3.9–3.13: programs need non-match beats before the planner can build anticipation instead of repeatedly booking the same match. Narrative and UI work begin after that slice is coherent.

**As built (2026-08-04):** `CardSlot` is a match/segment union; segments support solo or multiple participants, player and AI intents, dominance, quality/crowd response, per-participant heat and story advancement, popularity/appearance integration, CLI intent submission, and unified TV/PLE card reporting. The default scenario uses `segmentChance: 0.75`, and the 26-week regression asserts at least one segment per week plus story-linked segment coverage. This is an execution primitive, not yet a creative beat system: segment type/purpose is not structured, planned segments are selected by probability, and the tick resolves all matches before all segments rather than in card order. Phases 3.9–3.13 build on these exact boundaries.

**Contracts:**
1. `show.ts`: introduce a `segmentSlotSchema` (id, `participantWrestlerIds: array(idSchema).min(1)` — a solo interview is valid, unlike matches, which require 2 — `position`, optional `storyId`, `gmIntent`) and change `Show.card` from `array(matchSlotSchema)` to `array(matchSlotSchema | segmentSlotSchema)`, distinguished by a `kind: "match" | "segment"` discriminant added to both. Bump `schemaVersion`, regenerate fixtures.
2. `match.ts` (or a new `segment.ts`): a `segmentResultSchema` parallel to `matchResultSchema` but with no `winnerWrestlerId` — instead a `dominantWrestlerId` (whose intent carried the segment, spec §6.4) plus per-participant `positiveHeatDelta`/`negativeHeatDelta`/`storyAdvancement` outputs. `intents: Record<wrestlerId, SegmentIntent>` reuses the existing schema as-is.

**Sim:**
3. `resolveSegment` in a new `segment.ts`, structurally parallel to `resolveMatch`: skills `promoAbility`/`characterWork`/`psychology` (not `ringPerformance`/`athleticism`) drive the raw score. Conflicting segment intents resolve the same way as match intents — spec §6.4 already covers "match or segment," so no new conflict rule is needed, just reuse the dominance contest. Starting-point intent → heat mapping: `build_sympathy`/`show_vulnerability` → `positiveHeatDelta`; `generate_hostility`/`seek_controversy` → `negativeHeatDelta`; `promote_opponent`/`escalate_rivalry` → story-advancement-weighted, small heat either way; `protect_mystery`/`stay_controlled` → minimal heat, minimal risk (the "safe" segment options).
4. `updatePopularity` ([popularity.ts](../packages/sim/src/popularity.ts)): generalize the `appearances` map (currently built from `matchResults` only, [popularity.ts:111-115](../packages/sim/src/popularity.ts#L111-L115)) to also register segment participants, reusing `segmentFor` for the segment's own performance/crowd/story numbers so a promo'd wrestler hits the existing appearance branch — not the idle-decay branch this session's bugfix touched. Segments must plug into the *same* appearance concept rather than becoming a third parallel code path, or they'll reopen exactly the kind of silent-decay bug just fixed.
5. `advanceStories`: accept segment results alongside match results so an angle can move a story's `momentum`/`audienceInterest` the way a match does.
6. `gm.ts` booking: extend the TV story-slot loop ([gm.ts:180-191](../packages/sim/src/gm.ts#L180-L191)) so a `building`-phase story slot is sometimes filled with a segment instead of a match (starting point: `segmentChance` config, e.g. 0.25) — the "go a week with a promo instead of a match to build a feud without spending everyone's condition" beat. A promo costs no `physicalCost`/condition, which is itself a reason for the GM to reach for one when pacing a wrestler (ties naturally into 3.7.2's rest mechanic).
7. CLI: wire `PlayerTurn.segmentIntents` into whichever segment slot the wrestler is booked into for the tick, mirroring the existing `intent` command's match-slot wiring — closes the Phase-3 gap directly.

**Testing:** segment schemas round-trip through contracts; `resolveSegment` produces heat deltas matching the intent-mapping table above; a segment-only appearance moves `generalPopularity`/`momentum` the same way a match appearance does (no idle-decay leakage); a story advances from a segment result, not just a match result; re-run `slice.test.ts` — a segment competing for TV slot budget changes how many matches a show can carry, so verify SL-6/SL-9's shape still holds.

**Done when:** a 26-week run books at least one segment per week on average; at least one story advances via a segment; `slice.test.ts` still passes; `playtest-notes.md` gets a short section on segment behavior citing the SL ids affected.

---

## Phase 3.9 — ProgramPlan foundation

**Goal:** Add durable, private GM creative intent. A story describes what has happened and how the audience feels; a program plan describes what the GM wants to accomplish over the next four weeks. This phase implements [booking_ai.md §5](booking_ai.md#5-program-plan-model) without changing weekly card composition yet.

**Contracts:**
1. Add a `ProgramPlan` schema and world-state collection. It minimally contains: id, linked story id, optional stakes title id, participants with creative roles, premise, creative objective, priority, start tick, mandatory target payoff tick, optional target show id once committed, intended payoff, protected participants, escalation, status, planned beat ids, completed beat ids, direct-match cooldown/repetition budget, and structured revision history.
2. Keep public `Story` and private `ProgramPlan` distinct. World validation enforces known wrestler/story/show references, unique plan ids, valid target ticks, and one active plan per story. Do not expose private plan details through player-facing projections.
3. Add structured program lifecycle/revision event types. Persist previous intent, new intent, and revision reason; do not overwrite plan history silently.

**Sim:**
4. Introduce a deterministic planning-cycle entry point that can create a plan from an existing active story or a director-produced catalyst. It chooses a four-week target payoff and creative objective using world facts, GM objectives, title state, relationships, roles, availability, and player pitches.
5. Replace the GM objective's short random rotation as the primary source of creative direction. Objectives must persist for at least a PLE cycle unless a structured trigger causes revision; unsupported objectives (for example a tag objective while the scenario has no tag division) are ineligible.
6. Store selected and rejected plan candidates with score components sufficient to explain the choice. Hard-invalid candidates are recorded separately from valid candidates that lost on score.

**Testing:**
7. Contract round trips and invalid-reference tests; deterministic same-seed candidate selection; objective persistence across a PLE cycle; no duplicate active plan for one story; unavailable or conflicting participants rejected as hard-invalid.

**Done when:** the default scenario can deterministically produce a bounded portfolio of three to five active four-week plans, each linked to a story and target payoff; identical inputs reproduce identical plans and traces; no card behavior has to depend on reading prose fields.

---

## Phase 3.10 — Planned beats and program evolution ✅ (done)

**Goal:** Turn each `ProgramPlan` into a small, inspectable progression of structured beats built on Phase 3.8's match and segment slots. Programs must be able to develop without primary rivals wrestling every week.

**Contracts:**
1. Add a `PlannedBeat` schema with: id, program id, beat type, required/optional participants, scheduling window, preconditions, intended story effect, escalation level, whether it spends a direct matchup, compatible slot kind, status, and result references.
2. Start with the deliberately small catalog in [booking_ai.md §6](booking_ai.md#6-beats): promo/interview, confrontation, attack/save/interference, showcase/contender match, direct rivalry match, go-home angle, and PLE payoff. Do not add stipulation breadth until this catalog creates readable programs.
3. Add optional `programId` and `plannedBeatId` references to both match and segment slots, results, and relevant events. Keep `SegmentSlot` generic; `PlannedBeat` owns semantic type/purpose. Existing unplanned rotation slots remain valid without these references.

**Sim:**
4. Generate a provisional four-week beat skeleton for each accepted plan: establish, complicate, escalate, and pay off. Archetypes may omit or substitute steps, but every payoff must have prior setup and every scheduled beat must serve the plan's objective.
5. Add a beat selector that identifies required and eligible beats for the next show. Enforce scheduling windows, participant availability, escalation order, direct-match cooldown, PLE-only payoff rules, and initially at most one beat per program per show as hard constraints.
6. For planned programs, derive match-versus-segment from the selected beat; do not roll `booking.segmentChance`. Retain that knob only for explicitly unplanned/fallback segments until Phase 3.12 decides whether those are still useful.
7. Replace separate `resolveShow`/`resolveSegments` tick passes with one ordered `resolveCard` pass over `Show.card`. Preserve compatibility wrappers if tests/callers still need them. This makes card order authoritative and permits a resolved early beat to affect later slots.
8. Feed resolved match and segment results back into both public story state and private beat state. Mark beats resolved, skipped, or invalidated; never infer completion merely because a story meter crossed a threshold. Aggregate multiple same-story results defensively instead of overwriting earlier advancement.
9. Add initial replanning responses for an invalidated beat: substitute beat, accelerate, extend, cool down, pivot, or abandon. Every response appends a structured revision.

**Testing:**
10. Golden program tests: establish-to-payoff title challenge; non-title grudge; prospect elevation without an immediate title win; unavailable participant invalidates and replaces a beat. Add mixed-card ordering, plan/beat reference integrity, one-beat-per-program enforcement, and multiple-result story aggregation. Assert intermediate beats and traces, not only final story state.

**Done when:** an isolated four-week plan advances through at least three distinct beats, includes at least one non-match beat, respects direct-match cooldown, reaches a PLE payoff, and records deterministic revisions when a fixture disrupts it.

---

## Phase 3.11 — Planned outcomes, finishes, and execution deviation

**Goal:** Make the GM the normal authority over important match and segment outcomes while preserving emergent execution risk. Match/segment simulation judges how well a booking is performed; it does not normally invent the creative direction.

**Contracts:**
1. Add a planned finish to story/title match slots: intended winner, finish family (`clean`, `dirty`, `interference`, `disqualification`, `no_contest`), protected participants, intended title/story consequence, and adherence strength. Final token names become normative only when added to contracts and the applicable spec.
2. Add a planned segment outcome to planned segment beats/slots: intended focal or dominant participant, intended heat direction, intended story effect, protected participants, and adherence strength.
3. Extend match and segment results/events to record the planned outcome, actual outcome, adherence/deviation, and structured deviation cause.

**Sim:**
4. Move title change/retention policy from hard-coded match-resolution timing into the program planner and planned finish. Remove the forced mid-slice midcard transition and unexplained random world-title change once equivalent plan coverage exists.
5. Resolve the planned match winner and planned segment focus by default. Existing match/segment skills, dominance, condition, card position, and participant intents still determine quality, crowd response, credibility/heat, physical cost, GM/backstage reaction, and story advancement.
6. Permit deviations only through explicit rules such as injury, refusal, dominant conflicting intent, or failed interference. A deviation emits a material event and triggers replanning; it never silently substitutes a different winner, dominant participant, or heat direction.

**Testing:**
7. Planned clean/dirty/interference/title outcomes; protected loser credibility; planned segment dominance/heat direction; identical planned outcomes with different execution quality; every deviation cause individually forced by a fixture; no deviation without an eligible cause; planner reaction to a changed title holder or failed segment beat.

**Done when:** every program payoff/title match has an intended finish and every planned segment has an intended focus/effect; normal execution follows those plans; forced disruption fixtures produce explainable deviations and deterministic replans; title lineage no longer depends on slice-position hacks in `resolveMatch`.

**As built (2026-08-04):** Planned story/title matches now carry an auditable finish, and planned segments carry a focus, heat direction, and story effect. Normal execution adheres to those outcomes; `injury`, `refusal`, `dominant_conflicting_intent`, and `failed_interference` are the only recorded deviations, each emitting an `execution_deviation` event and a program revision. `resolveMatch` no longer contains slice-position or random title-change policy.

---

## Phase 3.12 — Weekly card composer and booking trace

**Goal:** Compose a wrestling show from due beats, obligations, and roster rotation. Replace independent match selection plus descending heat sort with a constraint-aware card that has continuity and rhythm.

**Composer order:**
1. Reserve hard obligations: due PLE payoffs, title obligations, and already-promised player bookings.
2. Place program beats whose scheduling windows are closing.
3. Place other high-value eligible program beats.
4. Fill remaining capacity with contender-building, showcases, and roster rotation.
5. Order the show with a strong opener, match/segment variety, participant separation, supporting progression, and the hottest justified main event.
6. Emit selected and rejected candidate traces.

**Hard constraints:** availability/condition, no accidental double booking, slot-kind compatibility, title/role eligibility, direct-match cooldown, card capacity, payoff reservations, and rare-role cadence. Hard-invalid candidates never become valid by receiving a larger score.

**Soft score:** program priority + beat urgency + heat + promotion-objective fit + freshness + card-shape contribution - overexposure - repeat-pairing penalty - condition risk. Put every coefficient in scenario-owned tuning only after its need is demonstrated by a test or slice.

**Trace and reports:**
7. Integrate composition at the correct information boundary: resolve relevant interactions/responses before committing a newly due future card; keep intents attached to an already committed show; resolve a show and its consequences before replanning later provisional beats. Update GDD §4 in the same change if the canonical tick sequence changes.
8. Persist a structured audit trace for every show: hard constraints, score components, selected candidates, rejected alternatives, placement reason, and linked plan/beat ids.
9. Extend the existing unified CLI/HTML show-card report with program timelines, beat semantics, planned-versus-actual match and segment outcomes, and a "why booked / why rejected" view. Private plan details are a developer/admin report, not a player projection.

**Testing:**
10. Golden cards: high-heat non-title main event; stale title obligation; PLE payoff reservation; direct rematch rejected; injured wrestler rejected; rare-role cadence; segment/match variety; strong opener and main-event placement; same-tick accepted pitch visible to composition; deterministic trace snapshot.

**Done when:** the composer creates complete deterministic TV and PLE cards from planned beats plus rotation, never violates a hard constraint, avoids weekly rivalry rematches, and explains every placement and rejection without reconstructing the decision from source code.

**As built (2026-08-04):** Committed shows now persist a private `bookingTrace` with every selected slot's decomposed score and placement rationale plus unselected planned-beat alternatives. The composer remains one-show-ahead, now runs after same-tick interaction/response resolution, and gives the strongest justified attraction the main event while retaining a strong opener. The unified slice HTML report exposes the trace as a developer/admin-only “Why booked / why rejected” disclosure.

---

## Phase 3.13 — Eight-week / two-PLE creative-booking slice ⚠ THE CREATIVE GATE

**Goal:** Prove `ProgramPlan → beats → planned finishes → weekly card composition` in an eight-week headless run covering two four-week PLE cycles. This is the fast readability gate before reconnecting the architecture to the full 26-week balance gate.

**Harness and Balance Lab:**
1. Reuse the existing `slice --weeks 8` path and unified `SliceShowCard` model to add a fixed-seed creative-gate test/report using the default scenario, three to five active programs, two singles titles, Phase 3.8 segments, planned outcomes, and one-show-ahead card commitment. Do not create a parallel simulation command.
2. Report complete program and card timelines: selected/rejected traces, beat status, plan revisions, planned versus actual finishes, direct-pairing history, title lineage, roster usage, and crowd/story consequences.
3. Add same-seed config comparison. Begin multi-seed batch support and parameter sweeps without coupling the planner to the tuner UI.

**Required deterministic fixtures:**
4. A title challenger built through multiple TV beats into a PLE payoff.
5. A non-title program advanced primarily through segments and allowed to outrank a colder title program.
6. A prospect elevated without being immediately made champion.
7. A disruption (initially injury or planned-finish deviation) that produces a visible, reasoned replan.

**Creative acceptance:**
8. At least two PLE programs have multiple prior TV beats; at least one program advances primarily through purposeful non-match beats; primary rivals do not fall into a weekly direct-match loop; at least one later beat depends on an earlier planned finish; planned segment focus/effect is observable in results; all active programs end resolved, validly extended, or explicitly abandoned; identical state/turns/seed reproduce identical output and trace. Raw segment count alone does not satisfy this gate.
9. Conduct and record a qualitative read-through in `playtest-notes.md`. The report must be describable as premises, escalation, consequences, and payoffs rather than as meter changes or repeated pairings.

**Reconnect the 26-week gate:**
10. Run the same planner through the existing 26-week harness. Extend analysis with program completion/abandonment, beats-before-payoff, PLE build coverage, direct-rematch frequency, segment share, escalation violations, revisions by cause, finish adherence, main-event/challenger diversity, role utilization, action-to-consequence delay, and unresolved-program backlog.
11. Change the automated slice gate so every MUST criterion actually fails the test when below threshold. Treat prior prose in `playtest-notes.md` as historical; record fresh results for the implemented planner and current tuning.
12. Tune program, card, title, roster, and popularity behavior together across multiple fixed seeds. Do not tune popularity in isolation to compensate for incoherent booking.

**Done when:** the eight-week creative gate passes every deterministic and qualitative requirement; the 26-week harness uses the new planner, enforces MUST failures, and has fresh recorded results; root tests/typecheck pass; Phase 4 narrative work can consume stable match, segment, plan-revision, and show facts without inventing booking logic.

---

## Phase 4 — Narrative layer

**Goal:** `packages/narrative` turns queued jobs into stored prose, provider-agnostic.

- `NarrativeProvider` interface: `generate(job) → Promise<NarrativeResult>`.
- **Template provider** (default): deterministic fact-to-prose templates per jobType with mild variation. Must cover every jobType so the game is fully playable with zero LLM.
- **Mock provider** for tests.
- **Ollama provider**: prompt = job JSON + strict output-schema instruction; validate response with zod; on validation failure retry once, then fall back to the template provider. Never block a tick on generation — jobs process async from a queue with status (pending/done/failed).
- Job queue is part of world persistence (in-memory + JSON for now).

**Done when:** `sheet` in the CLI renders provider-generated prose; switching provider is a config flag; killing Ollama mid-run degrades gracefully to templates.

---

## Phase 5 — Web app: persistence, auth, UI

**Goal:** `apps/web` — SvelteKit, mobile-first, backed by Supabase.

**5a. Persistence + server:**
- Supabase local dev (`supabase start`). Tables: `worlds` (id, tick, state JSONB, schema_version), `world_events` (append-only, indexed by tick/wrestler), `narrative_items`, `pending_turns` (one `PlayerTurn` per player per tick, upserted until the deadline), `players` (auth user ↔ wrestler id).
- Server routes: get my status / feed / dirt sheet / promotion roster; submit turn (validated against `playerTurnSchema` — slot limits enforced server-side); admin-only `POST /tick` for manual ticks.
- Player-facing routes return qualitative projections only (spec §8) — raw sim numbers never reach the client.
- The sim package runs inside the server route — load state, `runTick`, persist. No sim logic in routes.
- Supabase email/magic-link auth; a player claims one wrestler slot on first login (first-session flow per spec §9: premade identity, light customization, "who you are" brief).

**5b. UI — five screens per GDD §18:**
- **Home:** "what happened while I was away" — personal narrative summary, pending reactive decisions and proposals with deadlines, next tick deadline, slot status (interaction/action used or free).
- **Career:** skills as coarse bands, popularity/momentum as bands + direction (bars/meters, not tables, never raw numbers), gimmick editor (small adjustments only), stance selector (with "applies next tick" messaging), action-slot choices.
- **Stories:** active stories with qualitative momentum/interest indicators, pitch actions.
- **Promotion:** roster with portraits/visual identities (generated initials/color identities are fine), relationship tiers to you, champion, upcoming card with intent-setting for your bookings.
- **Dirt Sheet:** the shared feed of narrative items — headline + body cards.
- Bottom tab navigation, strong typography, game-like panels. Before building, load the `frontend-design` skill and honor GDD §18's avoid-list (no SaaS-dashboard look, minimal tables).

**Done when:** two browser sessions as two different players can each submit a full turn (including a proposal from one to the other, answered by the second), an admin triggers a tick, and both see personalized consequences plus a shared dirt sheet. Playable end-to-end on a 390px viewport.

---

## Phase 6 — Prototype hardening & validation

**Goal:** Ready for a small real playtest.

- Canonical prototype world seeded from `data/wwe-2026` (4–8 human slots claimed on top of the AI roster).
- Multi-tick soak test: a full 26-week slice through the web stack without state corruption, including proposals expiring and absent players surviving on stance fallback.
- Rate/validity guards on turn submission; graceful handling of ticks with zero human turns.
- A `README.md` covering setup, seeding, running ticks, and switching narrative providers.
- Final check against GDD §21, spec §13, and the slice spec: rerun `slice.test.ts` through the full stack's world, and write up one AI-played career as a paragraph. If it reads like "I trained stats until champion," return to tuning — that is a launch blocker, not a nice-to-have.

---

## Cross-cutting rules for the executing agent

- **Order is strict** through Phase 3.13. Phase 3.8 supplies segment primitives; Phases 3.9–3.13 build and validate the creative-booking core. Phases 4 and 5a may be parallelized only after the two-PLE creative gate passes and the planner is reconnected to the enforced 26-week gate.
- **Every phase lands with passing tests** (`pnpm test` + `pnpm typecheck` green at root). Deviations from this plan are recorded in the plan itself: amend the relevant phase section in place.
- **Tokens are normative.** All enum values in code MUST match the spec's backticked tokens verbatim. If a token must change, update the spec in the same change.
- **The sim is scenario-agnostic.** No wrestler, title, show, or faction name from any dataset appears in `packages/` source; all world content flows from `data/<scenario>/` through the contracts scenario schemas.
- **When the GDD or spec offers options** ("possible skills", "useful measures may include"), pick the listed set as-is — do not invent additional systems.
- **When the docs are silent**, choose the simplest thing that preserves the pillars (GDD §2), the design rules (spec §11, DL-1…DL-7), and the slice criteria (SL-1…SL-10), note the decision in a code comment or the relevant doc section, and move on. Do not block on questions unless a pillar or a MUST-level rule is at risk.
- **Scope discipline:** anything in GDD §3 "Not initially included" or tagged *post-prototype* in the spec is out — reject the temptation to add women's/tag divisions, a second brand, mentors, sponsors, finances, or multiple promotions even if "easy." (The scenario data format may anticipate divisions; the sim and booking logic must not implement them yet.)
- **The validation bars are layered:** Phase 3.13's two-PLE slice validates creative continuity and inspectability; the slice spec (SL-1…SL-10) validates 26-week simulation outcomes; GDD §21 and spec §13 validate the playable prototype. All three bars must pass. Emergent, social, non-linear careers beat feature completeness. When trading off, cut features, not consequence depth.
