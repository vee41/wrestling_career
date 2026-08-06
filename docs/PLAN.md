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

## Phases 3.12.1–3.12.9 — Creative-booking repair series (added 2026-08-05)

**Why this series exists.** An 8-week, 2-seed headless run (`slice --weeks 8 --seeds 2`) against the as-built 3.9–3.12 stack showed the creative gate is currently unpassable for reasons that are defects and structural gaps, not tuning:

- Story segments are scored as **lost matches** — both promo participants take the match loss edge ([popularity.ts:233-236](../packages/sim/src/popularity.ts#L233-L236)), so weekly programs bury their own stars: zero SL-1 risers, champions bleeding ~15 popularity while winning every defense, `burial` moments firing from routine main-event promos.
- **Beat escalation stalls in the live loop**: the establish promo repeats verbatim for three straight weeks while `confrontation`/`go_home_angle` sit `beat_precondition_unmet` in the trace; `attack_save_interference`, `showcase_contender_match`, and `direct_rivalry_match` are never generated at all. PLE payoffs arrive via the legacy peaking-blowoff pass, not `ple_payoff` beats — two parallel booking systems, and only the legacy one delivers.
- **Programs never end**: 6–8 of 10 stories still open at week 8; `abandoned` and `payoff_ready` are never assigned; a plan whose payoff window passes goes invisible but stays `active`; story `cooling` has no exit ([stories.ts:50](../packages/sim/src/stories.ts#L50)).
- **Titles change cold**: a world-title change landed in a *mid-card* PLE slot with no build, below a promo-built feud; a popularity-100 act took the midcard belt; `change_championship` is never chosen as a creative objective, so no title change is ever creatively intended — belts only move via injury deviations.
- **Replanning is an audit-only no-op**: `accelerate`/`extend`/`cool_down`/`abandon` and the `crowd_response`/`repetition`/`payoff_capacity` triggers are unused; revisions record a reason but change nothing.
- **Injuries never cost a show** (14 injuries, 0 missed shows) yet still flip world titles mid-show.

Phases 3.12.1–3.12.8 block Phase 3.13. Phase 3.12.9 must land before the 26-week reconnection (3.13 tasks 10–12) is tuned and called done.

**Series rules** (in addition to the cross-cutting rules):

- Every new constant is a `bookingTuning`/`popularityTuning`/`rolesTuning` config knob with a default in [config.ts](../packages/contracts/src/config.ts) — none inline.
- **Delete, don't accrete.** When a phase retires a legacy path (blowoff pass, cold title pass, `bookingObjective`), remove the code and its dead config in the same change. The root structural problem found in review is two parallel booking systems; do not leave a third.
- Unit tests that pass in isolation have already failed to catch these defects. Each phase's regression tests MUST include at least one **live-loop test** driving `runTick` across multiple weeks and asserting on the resulting world/trace — not only isolated fixtures.

---

## Phase 3.12.1 — Booking observability first ⚙ blocks 3.13

**Goal:** Make every later fix measurable before making it. The slice harness currently reports popularity/title/story outcomes but none of the booking-quality metrics the gate needs — a run whose booking is broken can only be diagnosed by reading raw cards.

1. **Program metrics in `analyzeSlice`** ([slice.ts](../packages/sim/src/slice.ts)): program completion and abandonment counts, median program duration, beats-before-payoff, PLE build coverage (share of PLE story/title matches with ≥2 prior resolved beats), direct-rematch and consecutive-pairing frequency, share of story advancement from segments, escalation-order violations, revisions by cause, planned-finish adherence rate with deviation causes, main-event and challenger diversity, unresolved-program backlog. These are the booking_ai §12 list; 3.13 task 10 then only has to *enforce* them.
2. **Beat semantics in the reports:** the markdown and HTML show cards must label each slot with its beat type, program id, escalation level, and planned-versus-actual finish/focus. Add a per-program timeline section (planned → scheduled → resolved/skipped/invalidated beats, with revisions). Today the run report never shows a beat type at all.
3. **JSON dump:** `slice --json <path>` serializes the per-seed `SliceAnalysis` (including the new metrics and booking traces) for programmatic diffing. Update the usage string in [cli.ts](../apps/cli/src/cli.ts).
4. **Scope the SL table:** when `--weeks` ≠ 26, label SL-1…SL-10 rows as advisory ("26-week criteria; shown for reference") so an 8-week run isn't read as failing a bar it isn't measuring.
5. **Fix unbounded growth:** `world.programPlanCandidates` gains two entries per tick and is never pruned (unlike `world.events`, pruned at [tick.ts:108](../packages/sim/src/tick.ts#L108)). Window it the same way; keep enough history for the report.

**Testing:** metric unit tests against a scripted world with known program history; a snapshot test that the 8-week report contains beat types and a program timeline; JSON round-trips through a schema.

**Done when:** the 8-week report answers "which beats did program X run, what was planned vs. actual, and why is it unresolved" without reading source; candidates are pruned; metrics land in both report formats.

**As built (2026-08-05):** `analyzeSlice` now returns `bookingMetrics` (the booking_ai §12 set: program completion/abandonment/backlog, median duration, beats before payoff, PLE build coverage, direct-rematch and consecutive-pairing counts, segment share of story advancement, escalation-order violations, revisions by cause *and* by response, no-op revisions, planned-finish adherence with deviation causes, main-event and challenger diversity, beat counts by type and status — computed in [booking-metrics.ts](../packages/sim/src/booking-metrics.ts)) plus `programTimelines` (planned → scheduled → resolved/skipped beats with windows, blocked prerequisites, planned-versus-actual execution, revisions with the intent fields each one actually changed, and an `openReason` for every unresolved plan). Every show-card slot carries its beat type, program id, escalation level, and planned-versus-actual finish/focus in both report formats. `slice --json <path>` writes a strict-schema dump of every per-seed analysis ([slice-json.ts](../apps/cli/src/slice-json.ts)), and SL rows on a run whose length differs from the scenario's `sliceWeeks` are labelled advisory. `world.programPlanCandidates` is windowed by the new `booking.programCandidateRetentionTicks` knob (30), holding the 26-week trace at 1168 entries instead of 1860-and-growing with identical run outcomes. Role utilization and action-to-consequence delay remain with Phase 3.13 task 10 as planned. Baseline metrics for the 8-week, 2-seed run are recorded in [playtest-notes.md](playtest-notes.md).

---

## Phase 3.12.2 — Segments are appearances, not lost matches ⚙ blocks 3.13

**Goal:** Stop the popularity model from treating every promo participant as a match loser. This is the single highest-impact defect: it makes programs *cost* popularity, so the hottest acts are the most damaged, and no one can rise.

1. **Guard the win/loss edge by result kind** ([popularity.ts:233-236](../packages/sim/src/popularity.ts#L233-L236)): `"winnerWrestlerId" in result` is false for segment results, so `won` is false for *everyone* and both participants eat `−lossEdgeBase` plus the "buried by a lesser opponent" term. For segments, derive the edge from the segment's own facts instead: the dominant participant gets a small positive edge scaled by opponent popularity gap (capped well below a match win); non-dominant participants get ~0, not a burial — losing a promo exchange is not losing clean in a main event. New knobs: `segmentDominantEdgeFactor`, `segmentNonDominantEdge` (default 0) in `popularityTuningSchema`.
2. **Audit the intent→heat mapping** ([segment.ts](../packages/sim/src/segment.ts), [popularity.ts:211-221](../packages/sim/src/popularity.ts#L211-L221)): in the observed run, faces accumulate only negative heat from story promos week after week. A planned segment's `intendedHeatDirection` must translate to heat consistent with alignment — a face building sympathy gains `positiveHeat`, a heel generating hostility gains `negativeHeat`; `mixed` splits by alignment. Write the mapping as a table in a code comment and test each row.
3. **Re-check `burial`/`breakout` moment attribution** ([popularity.ts:289-297](../packages/sim/src/popularity.ts#L289-L297)) after 1–2: a routine story promo between comparable stars must produce no moment at all; the `else reason = "burial"` fallback must not fire for segment appearances with near-zero edge.

**Testing:** live-loop test: two top stars run a 3-week promo program; neither loses more than ~2 popularity and no `burial` events fire; a match burial still fires as before. Re-run the 8-week slice: expect champions to hold ~their starting popularity through a defended reign and net roster popularity near zero.

**Done when:** segments never apply the match loss edge; heat direction respects alignment; the 8-week run shows a positive-or-flat popularity total and at least one wrestler visibly rising from a strong program.

**As built (2026-08-05):** [popularity.ts](../packages/sim/src/popularity.ts) discriminates the result kind once (`isMatch`) and scores a segment on its own facts: the dominant participant takes `max(0, opponentGap) * popularity.segmentDominantEdgeFactor` (0.15, versus the 0.5 match-win factor) and everyone else takes `popularity.segmentNonDominantEdge` (0, bounded at −5 so a scenario cannot turn an appearance back into a burial). The same flag retires the terminal `burial` fallback for appearances with no competitive result, so a routine promo emits no moment at all. The intent→heat mapping is now two tables in [segment.ts](../packages/sim/src/segment.ts): `HEAT_INTENT` owns magnitude and direction, and `heatPool` resolves direction × alignment (stated `positive`/`negative` land as played, `mixed` is resolved by the character, `neutral` moves nothing) — a booked beat's `intendedHeatDirection` now actually drives heat, speaking for the wrestler it books as dominant while the segment runs as booked. Every row of that table is tested, plus two live `runTick` loops. Measured on the 8-week, 2-seed run: segment `burial` moments 16/18 → **0**, cumulative popularity from segments −60/−51 → +53/+57 (worst single act −18 → −3), net roster popularity −11/−50 → +57/+55, falls 2/3 → 0/0, and CM Punk's two-defence world-title reign 91→76 → 91→88 and 91→96. **One regression to hand on:** at 26 weeks this flips SL-1 from FAIL to PASS (1/0/1 → 4/3/4 risers) but SL-2 from PASS to FAIL (10/9/4 → 2/2/1 falls) — the old fall count was mostly promo burials, and GDD §10 requires falls to be *active* (burials, losing streaks, depushes, lost titles). Real fall sources are owed by 3.12.5's planned finishes and the 3.13 tuning pass; see [playtest-notes.md](playtest-notes.md).

---

## Phase 3.12.3 — Beat progression and plan lifecycle repair ⚙ blocks 3.13

**Goal:** Make the four-beat skeleton actually advance in the live tick loop, and make every program end. Phase 3.10's isolated tests pass while the composed system repeats the establish promo forever — this phase fixes the wiring, not the model.

1. **Root-cause resolved-beat feedback.** Write the failing live-loop test *first*: seed the default scenario, run 4 weeks of `runTick`, and assert the seeded programs advance through ≥3 distinct beat types with the prerequisite chain unblocking week over week. Known suspects, in order: (a) the participants-already-used revert at [gm.ts:384](../packages/sim/src/gm.ts#L384) bouncing beats back to `provisional` so the establish beat is re-selected instead of its successor; (b) the committed slot losing `plannedBeatId` between one-show-ahead commitment and `resolveCard` ([card.ts:10](../packages/sim/src/card.ts#L10)), so `recordResolvedBeat` ([planned-beats.ts:8](../packages/sim/src/planned-beats.ts#L8)) never fires; (c) the dangling no-op noted at [gm.ts:333-335](../packages/sim/src/gm.ts#L333-L335) ("make it eligible for the next composition attempt") — implement it.
2. **One payoff authority.** The legacy peaking-blowoff pass ([gm.ts:411-436](../packages/sim/src/gm.ts#L411-L436)) currently delivers PLE story matches independently of beats, which is why stories resolve while their plans don't. Restrict it to stories *without* an active program plan (a shrinking legacy case), and make the `ple_payoff` beat the normal path: its resolution resolves the beat, the plan (`planned-beats.ts:18`), *and* the public story (winner momentum + relationship consequences, as `resolveBlowoff` does today at [stories.ts:73](../packages/sim/src/stories.ts#L73)). One resolved fact set, whichever path produced it.
3. **Plans must terminate.** Assign the missing statuses: a plan whose final prerequisite beat resolves becomes `payoff_ready`; a plan whose `targetPayoffTick` passes unresolved gets an explicit revision — extend to the next PLE (once) or `abandoned` — never a silent zombie. Add the revision-reason token this needs (`payoff_missed`) to `programRevisionReasonSchema` and booking_ai §9 in the same change. World validation may then assert: no `active` plan whose payoff tick is in the past.
4. **Story `cooling` gets an exit** ([stories.ts:50](../packages/sim/src/stories.ts#L50)): a cooling story either re-heats (interest recovers past the building threshold) or resolves quietly after N idle weeks (config `coolingResolveWeeks`), releasing its participants and abandoning its plan with a revision.
5. **Skipped-beat hygiene:** when a beat is `skipped` by window expiry ([program-plans.ts:253](../packages/sim/src/program-plans.ts#L253)), the plan must respond (accelerate the next beat's window or extend) rather than silently thinning to nothing — wire this through the 3.12.4 revision primitives if landing together, or a minimal window-shift here.

**Testing:** the live-loop test from task 1 (this is the phase's acceptance test); a fixture where a payoff window passes and the plan visibly extends once then abandons; a cooling story resolves and frees its participants; the blowoff pass never fires for a story with an active plan.

**Done when:** an 8-week run shows programs advancing establish → complicate/escalate → payoff with no beat type repeated more than twice per program, zero `active` plans with past payoff ticks, and the unresolved-story backlog ≤2 at week 8.

**As built (2026-08-06):** The root cause of the stalled loop was **beat windows, not beat feedback**. `createBeatSkeleton`'s fixed `payoff − 6 / − 3 / − 1` arithmetic collapsed every window onto a single already-booked tick whenever a plan started close to its PLE, so late programs were born with all four beats unbookable; each then expired in turn, and because a skipped beat stayed in its successors' preconditions the whole chain died behind a requirement that could never be satisfied. Beat windows are now laid over the television shows that actually exist ([program-plans.ts](../packages/sim/src/program-plans.ts)): each build beat opens on its own TV show and stays open until the last one before the payoff, with the prerequisite chain — not the window — enforcing order. A plan with no runway aims past the imminent PLE at the first one offering `booking.minimumProgramBuildShows` (2) television shows, and takes a shortened three-beat skeleton when only two shows are available. Retiring a beat now splices it out of the chain (`retireFromChain`): successors inherit a skipped beat's own prerequisites, or point at the stand-in when a beat is invalidated for an unavailable participant. That exposed a second live defect — a substitute beat kept the whole program's planned outcome while booking only the available participants, so it resolved as a `refusal` deviation against a wrestler who was never in the segment; `scopeToParticipants` fixes it. Beat selection marks a beat `scheduled` before the composer's final double-booking check, so `releaseUncommittedBeats` now returns anything that missed the card to the pool — the dangling no-op at the old gm.ts:333 is implemented and its comment deleted. **One payoff authority:** the `ple_payoff` beat resolves the beat, the plan, *and* the public story through the shared `resolveStoryPayoff`; the legacy peaking-blowoff pass (both its card reservation in `bookShow` and `resolveBlowoff` in the story engine) is restricted to stories no program is building. **Plans terminate:** a plan whose last build beat resolves becomes `payoff_ready`; `advanceProgramPlanLifecycle` (tick step 7, after the show that could have paid it off) extends a missed payoff to the next reachable PLE — beat windows and all — `booking.maxPayoffExtensions` (1) times, then abandons it, invalidating its remaining beats and leaving the story cooling. The new `payoff_missed` revision reason is in `programRevisionReasonSchema` and booking_ai §9, and `worldStateSchema` now rejects an open plan whose payoff tick is in the past — which makes `openReason`'s "payoff window closed" branch unreachable, so it is deleted. **Cooling has an exit:** a cooling story re-heats when it is booked again and works, or resolves quietly after `booking.coolingResolveWeeks` (3) idle weeks, releasing its participants and abandoning whatever plan was still nominally building it (new optional `Story.coolingSinceTick`). **The scenario's TV card was sized for a show without segments.** Once beats actually aired, five live programs turned a 4–6-slot card into 1.2 matches + 3.5 segments a week (it was 3.2 + 1.6 before), squeezing out rotation matches and title defences and costing SL-4/SL-5/SL-7/SL-9 at 26 weeks. That is a scenario-data fault, not a reason to cap beats: real television runs both, so `tvCardSize` is now **8–10** (measured: 5.3 matches + 3.5 segments, against a PLE's 7.3 matches and no segments — TV has more slots, a PLE still has more *matches*). Measured on the 8-week, 2-seed run: programs resolved 3/2 → **7/7**, open backlog 5/5 → 2/1 (and every open plan's `openReason` is now a beat that is due, not a window that closed), beats resolved 16/12 → 26/26 with **skipped 11/15 → 1/1**, PLE build coverage 36% → 60%/64%, stories resolved 3/4 → 7/7 with all of them landing on a PLE, net roster popularity +57/+55 → +71/+76; SL-6 flips FAIL → PASS on both seeds. At 26 weeks: programs created 8 → 28 (plans that end release their participants, so the planner no longer holds five permanent zombies), resolved 3 → 23, beats resolved 14 → 93, skipped 18 → 1, PLE build coverage 13% → 66%, story backlog 10 → 5, median story lifespan 8.0 → 5.0 weeks, and MUST failures per seed 2/3/2 → 5/3/3.

**Three things to hand on.** (1) `payoff_missed` never fires on the shipped scenario now that programs reach their payoffs — the extend/abandon path is a tested backstop, not observed behaviour, and 3.12.4 should keep it that way. (2) **SL-5 fails on all three seeds and SL-4 on two** (0–2 midcard changes with 4–5 defences; 3 world-title changes where the spec wants 0–2). Title booking is [3.12.8](#phase-3128--title-programs-challengers-built-changes-planned--blocks-313)'s remit — a belt defended as a program's payoff — and is the largest remaining gap against the pre-phase gate. (3) **SL-9 still fails on two seeds, but by one wrestler each** (Damian Priest, minimum 1–2 matches), and it is a *rest* effect rather than slot starvation now: the rotation pass's `restPenalty` keeps a high-popularity act off cards it has room for. That, the TV main event still being a promo, and `selectPlannedBeatsForShow` still receiving the whole card as its capacity, all belong to [3.12.7](#phase-3127--card-shape-score-driven-selection-one-objective-system--blocks-313); land the card-shape rules against the 8–10 card, and do not buy any row back by letting programs stall again. See [playtest-notes.md](playtest-notes.md).

---

## Phase 3.12.4 — Replanning with teeth ⚙ blocks 3.13

**Goal:** Implement booking_ai §9 for real. Today `replanForExecutionDeviation`/`replanForTitleChange` ([program-plans.ts:398-409](../packages/sim/src/program-plans.ts#L398-L409)) pass the unchanged plan snapshot back, so every "revision" is a no-op audit entry, and only `substitute_beat`/`pivot` of the six response types exist.

1. **Response primitives that mutate:** `accelerate` (pull `targetPayoffTick` to an earlier show, compress remaining beat windows), `extend` (push payoff to the next PLE, insert one keep-warm beat), `cool_down` (freeze beat scheduling for N ticks, story decays naturally), `abandon` (plan → `abandoned`, story → cooling/resolved, participants released). Each appends a revision whose previous/new intent snapshots actually differ; each emits `program_plan_revised`.
2. **Wire the unused triggers:** `crowd_response` (story `audienceInterest` drops ≥N below its peak while the plan is active, or executed heat repeatedly contradicts the intended direction) → cool down, accelerate, or pivot; `repetition` (direct-match budget exhausted or the same beat type resolved 3× in one program) → accelerate or abandon; `payoff_capacity` (more payoff-ready programs than PLE card slots) → extend the coldest program. Thresholds are config knobs.
3. **Deviation responses become real:** an execution deviation (e.g. the planned winner got injured mid-show) must produce a *changed* plan — pivot the intended payoff or accelerate — chosen deterministically from the deviation cause, not just recorded.
4. **Player influence revises plans:** an accepted `pitch_feud` about a wrestler in an active program, or a proposal/reactive response that materially affects one (refused booking, accepted elevation), appends a `player_pitch`/`player_response` revision with a real effect — priority boost, participant catalyst, or accelerate — making the two unused revision-reason tokens reachable. The tick order already resolves interactions before card commitment (booking_ai §4), so no pipeline change is needed; pitches about wrestlers *not* in a program stay on the existing story-seeding path and become planner catalysts via 3.12.9.

**Testing:** fixtures forcing each trigger produce the expected response with a materially-different intent snapshot; an accepted pitch fixture produces a `player_pitch` revision visible in the trace; deterministic same-seed replay reproduces identical revisions; the 8-week run's "revisions by cause" metric (3.12.1) is non-empty and explicable.

**Done when:** every revision in a slice run changes the plan it revises; all six response tokens and every trigger reason listed here (including `player_pitch`/`player_response`) are reachable in tests; no revision-recording path passes `snapshot(plan)` unchanged.

**As built (2026-08-06):** The six responses are now primitives in [program-plans.ts](../packages/sim/src/program-plans.ts) that each mutate the plan and then record what they did. `accelerate` aims at the earliest event still reachable, skips the complications it no longer has shows for (lowest escalation first, spliced out of the chain by 3.12.3's `retireFromChain`), and re-lays the remaining windows; it **declines** on a program with no resolved beats, because there is no build to bring forward, and its caller falls through to the next response. `extend` moves the payoff and the remaining windows to the next reachable PLE and adds one keep-warm promo when the build is spent — deliberately *not* a prerequisite of the payoff, so extending a `payoff_ready` plan does not un-ready it; `advanceProgramPlanLifecycle` now calls it instead of carrying its own copy. `cool_down` sets the new optional `ProgramPlan.beatsFrozenUntilTick`, which `selectPlannedBeatsForShow` honours, and pushes the surviving windows out behind it. `pivot` was the one that needed teeth: `finishForPlannedBeat` ([gm.ts:135](../packages/sim/src/gm.ts#L135)) reads participant **roles**, not `protectedWrestlerIds`, so a pivot makes the favoured wrestler the protagonist — which is what decides the payoff winner — as well as protecting them and re-pointing every open segment beat at them. **No path records an unchanged snapshot:** `revise()` composes the new intent, compares it to the previous one, and declines silently if they match, so the legacy `replanForExecutionDeviation`/`replanForTitleChange`/`invalidateAndSubstitute` audit no-ops are gone (the metric reads **0** on every seed, from 1). Each response also restates `intendedPayoff` after a separator, so the original statement of intent survives repeated revisions.

The three state-driven triggers run in one pre-booking sweep (`replanBeforeBooking`, tick step 4, immediately before `bookUpcomingShowIfDue` — the last tick at which a decision can still change what airs). `crowd_response` fires on heat that repeatedly contradicts the booked direction (→ pivot behind whoever the segments actually made dominant) or on interest falling `booking.crowdResponseInterestDrop` below the story's own peak (→ accelerate, or cool down when there is nothing to cash in); it re-bases the new optional `Story.peakAudienceInterest` when it acts, so it re-arms rather than firing every tick. `repetition` fires on a beat type resolved `booking.repeatedBeatTypeLimit` times or the direct-match budget overspent, accelerating the first time and abandoning the second — its threshold rises with each response, so the same evidence cannot re-trigger. `payoff_capacity` holds the coldest programs over when more than `booking.maxPayoffsPerEvent` (4) are due on the upcoming event. Deviations now answer to their cause: injury → extend, failed interference → accelerate, refusal and conflicting intent → pivot behind whoever execution actually favoured, each with a fallback so a deviation never records nothing. A title that moves inside a program pivots it to the new champion; one that leaves takes the stakes with it (`stakesTitleId` cleared, objective → `settle_grudge`). Player influence lands through the existing slots: an accepted GM `pitch_feud` touching a live program pivots it toward a participant who pitched it (or accelerates one aimed at them) and raises its priority, once per program; a refused `booking_request`/`finish_changed` pivots the program behind the refuser, and an accepted `risky_opportunity` accelerates it. New knobs, all in `bookingTuningSchema`: `crowdResponseInterestDrop` (20), `heatContradictionLimit` (2), `coolDownTicks` (3), `repeatedBeatTypeLimit` (3), `maxPayoffsPerEvent` (4).

**Measured.** 8-week/2-seed: revisions by cause are non-empty and explicable (participant unavailable 1/1, execution deviation 3/1, crowd response 1/0), **no-op revisions 1 → 0**, and every other booking metric is unchanged from 3.12.3 — programs resolved 7/7, backlog 2/1, beats resolved 26/26, PLE build coverage 60%/64%, escalation-order violations 0, finish adherence 90%/97%. 26-week/3-seed: 28 programs created, 23 resolved, backlog 5, PLE build coverage 65–66%, revisions execution deviation 11/9/9 + crowd response 1/1/0 + title change 1/0/0 + participant unavailable 2/1/2, no-ops 0, MUST failures **5/3/3 — identical rows to 3.12.3**. That last number was checked against a build with 3.12.4's behaviour switched off rather than assumed: the replanning *does* move the world (final popularity differs for six wrestlers by 6–10 points on seed 1), it just does not move an SL row yet. `maxPayoffsPerEvent` was landed at 4 rather than 3 for this reason — at 3 the capacity trigger held real programs over and cost a point of backlog and PLE coverage for a constraint the shipped card does not actually have.

**Three things to hand on.** (1) **`MAX_ACTIVE_PROGRAMS` is double-counted** ([program-plans.ts:427](../packages/sim/src/program-plans.ts#L427) adds `selectedIds.size` to a `world.programPlans` array the same loop has already pushed into), so the portfolio saturates at three or four concurrent programs, not the five the constant names or the "three to five" booking_ai §11 asks for. That is [3.12.9](#phase-3129--story-variety-post-payoff-life-and-the-long-horizon--before-26-week-tuning) task 2's territory (portfolio-driven cadence) and it should fix the count rather than the constant. (2) `repetition`, `payoff_capacity` and `payoff_missed` are tested backstops, not observed behaviour — on the shipped tuning programs reach their payoffs, run varied-enough beats, and never crowd an event. 3.12.6's richer skeletons and 3.12.8's title programs will make the first two live; do not tune them down to make them fire. (3) `player_pitch`/`player_response` cannot fire in a headless slice: AI wrestlers are deliberately barred from pitching feuds *to the GM* ([decide.ts:156](../packages/sim/src/ai/decide.ts#L156)) and nothing answers reactive decisions, so both are covered by fixtures and by driving the real interaction and response slots — they will come alive with a human player.

---

## Phase 3.12.5 — Injuries that cost shows ⚙ blocks 3.13

**Goal:** An injury must be a calendar fact, not a same-week condition dip. The observed run had 14 injuries, zero missed shows (SL-8 fail) — while an unlucky mid-show injury silently flipped a world title through a deviation.

1. **Enforced absence:** when an injury event fires, set recovery so the wrestler stays below `BOOKABLE_CONDITION_THRESHOLD` for at least one full show week (tune recovery rate and injury severity so this holds; alternatively an explicit `unavailableUntilTick` on the wrestler, contracts change + schemaVersion bump). The existing missed-show/return arc emission then produces SL-8's shape.
2. **Severity tiers as config**, not code: minor (misses ~1 show) / serious (misses a PLE cycle), rolled from `physicalCost` and condition at injury time.
3. **Deviations get rarer and louder:** an injury-caused planned-finish deviation should be an uncommon, material story event. Ensure it also triggers a 3.12.4 replan (pivot or extend), and that the title consequence of a deviated finish is a planner decision on the replan, not an automatic mid-card title change.

**Testing:** live-loop: an injured wrestler misses ≥1 show, their scheduled beats are invalidated and substituted (existing path at [program-plans.ts:219](../packages/sim/src/program-plans.ts#L219)), and they return; a deviation-injury on a title match produces a replan revision rather than a silent lineage change.

**Done when:** an 8-week run shows at least one absence-and-return arc when injuries occur; no title changes hands as a side effect of an injury deviation without a corresponding plan revision.

**As built (2026-08-06):** Tuning recovery was never going to hold — the AI reaches for the `recover` action the moment condition drops and buys back +18 in a tick, more than the hardest match costs, so an injury expressed only as lost condition was healed before the next card was composed. Injuries therefore write a **calendar fact**: the new optional `Wrestler.unavailableUntilTick` (contracts change, `schemaVersion` **7 → 8**), a clearance tick that neither resting nor a lucky roll can shorten. Absences are counted in whole show weeks *after* the week the injury happened in — its own show has already aired — so a one-week absence means one show missed outright, and a second injury during a layoff extends it rather than resetting the clock to the lighter of the two. Every availability question in the sim now goes through one `isAvailable` in the new [injury.ts](../packages/sim/src/injury.ts), which retires the two duplicate `= 40` constants that had drifted apart in `gm.ts` and `program-plans.ts` (`BOOKABLE_CONDITION_THRESHOLD`, `MINIMUM_AVAILABLE_CONDITION`) into the `health.bookableCondition` knob. **Severity tiers are config, and derived rather than rolled** so the same show always produces the same absence: an injury that leaves a wrestler at or below `health.seriousInjuryCondition` (30), or that cost `health.seriousInjuryPhysicalCost` (38) whatever condition it left, is serious and costs `seriousAbsenceWeeks` (4 — a full PLE cycle); everything else is minor and costs `minorAbsenceWeeks` (1). New config group `health` in [config.ts](../packages/contracts/src/config.ts); the injury trigger itself collapsed to a single clause, because with availability enforced nobody works a match from below the line and the old "already critical" branch was unreachable.

**Deviations got rarer and louder in the same move.** An `injury` deviation now means the booked winner was hurt *on tonight's card* — booking already excluded anyone ruled out, so it cannot fire for a wrestler who is merely worn down. Across 26 weeks and three seeds there is exactly **one**. And **a deviated finish never moves a belt**: `titleConsequence` returns `retain` for any deviation on a planned match, so the champion walks out champion and whether the challenger earned another shot is a planner decision on the revision (booking_ai §15). The revision itself was already real from 3.12.4 — injury → extend, with a pivot fallback. The missed-show/return arc emission also had a latch bug worth fixing while here: it asked whether a wrestler had *ever* missed a show and *ever* returned, so nobody could come back twice; it now compares the two most recent ticks. Reports carry `seriousInjuryTicks` and `weeksLost` per wrestler in both formats and in the `--json` dump.

**Measured.** 8-week/2-seed: injury arcs went from decorative to real — seed 1 had 13 injuries, two of them serious, producing clean *hurt → miss → return* arcs (Seth Rollins hurt week 5, misses week 6, back week 7) and two four-week layoffs that eat the rest of the window (CM Punk, Xavier Woods). Programs resolved 7/7 → 7/6, backlog 2/1 → 2/4, PLE build coverage 60%/64% → 67%/55%, beats invalidated 1/1 → 1/4, no-op revisions still 0. At 26 weeks/3 seeds the injury rate is essentially unchanged (47/34/55 → 55/55/71 events) but now costs 92/83/112 wrestler-weeks; **MUST failures 11 → 8 (5/3/3 → 3/3/2)**. SL-9 flips to PASS on all three seeds (minimum matches 2/1/3 → 3/3/3) because absences force genuine rotation, SL-2 recovers on seed 1, and SL-4's phantom title changes are gone (3 world-title changes on seeds 2 and 3 → 2 and 1). SL-7 is a wash — PASS on seed 1 (5 → 10 distinct PLE main-eventers), FAIL on seed 2 (7 → 5). The cost is **SL-3**, which now fails on all three seeds (12/18/17 → 13/14/14 of 44 careers with a 16+ point swing, having already failed on seeds 1 and 3): the same even spread that fixes SL-9 flattens individual careers, and the two criteria pull against each other. Two of 3.12.4's "tested backstops" also came alive, which is the honest read of what absences do to a plan: `payoff_missed` fires 2/6/3 times and `repetition` 1/1/2, because a program whose protagonist is on the shelf stalls and repeats.

**Three things to hand on.** (1) **SL-3 versus SL-9 is now a real tension, not a defect.** Do not buy SL-3 back by shortening absences — the knobs are seed-noise-sensitive at this scale (moving `seriousInjuryCondition` by two points swung seed 3 from 2 failures to 5), and the answer is 3.12.7's card shape giving hot acts bigger weeks rather than injuries doing the rotation. (2) **A beat is only invalidated when it comes due**, in `selectPlannedBeatsForShow`; a program whose protagonist is ruled out for four weeks keeps its later beats until each is reached. That is why seed 1's first invalidation lands in week 9. If 3.12.9's portfolio cadence wants to react to a long layoff at the moment it happens, that is a new trigger, not a fix here. (3) The `health` group is a **fourth** tuning group alongside `booking`/`popularity`/`roles`, which the series rule did not anticipate — these are health facts rather than booking policy, and `bookableCondition` was an inline constant duplicated in two files before this. Keep injury knobs there rather than growing `bookingTuning`.

---

## Phase 3.12.6 — Complete the beat catalog; vary the beat outcomes ⚙ blocks 3.13

**Goal:** Programs must be built from more than promos. Three of the seven beat types are never generated ([program-plans.ts:196-205](../packages/sim/src/program-plans.ts#L196-L205) always emits promo → confrontation → go-home → payoff), every beat's intended dominant is the same wrestler, and no TV story *match* ever happens.

1. **Skeleton archetypes per creative objective:** `establish_challenger` includes `showcase_contender_match` beats (the challenger beats a third-party opponent — pull from the bookable non-story roster; this is what makes a challenger *credible*); `settle_grudge` includes `attack_save_interference` and may spend a `direct_rivalry_match` on TV mid-program (respecting `directMatchCooldownTicks` and consuming `directMatchRepetitionBudget` — currently written, never read); `retain_championship`/`elevate_act` keep segment-heavy builds. Keep the catalog at the seven existing types.
2. **Momentum trading:** vary `intendedDominantWrestlerId` and heat direction across the skeleton — the antagonist stands tall in the escalation/go-home beat, the protagonist takes the payoff (or inverted for a heel-win plan). A program where one side wins every beat reads as a squash, not a feud. Encode per-archetype in the skeleton generator; no new schema.
3. **Third-party participants:** showcase and interference beats introduce wrestlers beyond the core pair via `optionalParticipantWrestlerIds` (schema already supports it). Hard constraints (availability, double-booking) already apply; verify the composer merges them (partially present at [gm.ts:376-393](../packages/sim/src/gm.ts#L376-L393)).

**Testing:** golden programs per archetype asserting the beat-type sequence and alternating dominance; live-loop: an `establish_challenger` program produces ≥1 TV showcase win for the challenger before the PLE; direct-rivalry budget is consumed and enforced.

**Done when:** an 8-week run generates all seven beat types across its programs (visible in the 3.12.1 report), at least one program advances through a TV match beat, and no program's beats share a single intended dominant throughout.

**As built (2026-08-06):** The four-template `BUILD_BEATS` constant is gone; [program-plans.ts](../packages/sim/src/program-plans.ts) now holds an `ARCHETYPES` table keyed by creative objective (booking_ai §6). `establish_challenger` runs claim → **showcase win** → go-home; `settle_grudge` runs reason → **ambush** → **rivalry match with the score left open**; `elevate_act` — the objective the shipped planner picks most — runs claim → the established name talks down to them → **showcase win**; `retain_championship`/`change_championship` keep the promo-argued build, which is what `confrontation` and `go_home_angle` still exist for. The two dormant §16 objectives map to the same argued build so a scenario that reaches one is still buildable. **Dominance is planned relative to the payoff, not by name:** the new exported `plannedPayoffWinnerId` answers "whose program is this" once, and each template says `payoff_winner` or `payoff_loser`, so the side that is going to lose takes the go-home angle or the television fall. `finishForPlannedBeat` ([gm.ts](../packages/sim/src/gm.ts)) reads the same function and adds the two match-beat rules the skeleton cannot express: a showcase is won by whichever participant belongs to the program, and a `direct_rivalry_match` is won by whoever is booked to lose the blowoff. `beat()` took an options object in the process (it had eight positional parameters and was about to take ten), and that made `scopeToParticipants` redundant — a beat now scopes its own planned outcome to whoever it books, so the 3.12.3 helper is deleted rather than left beside it.

**Third parties are named by the planner and chosen by the composer.** `outsideCandidates` shortlists `booking.beatOutsideCandidateCount` (3) wrestlers who are outside every active program, not champions, not story-gated, and closest in popularity *below* the wrestler being showcased — credible but beatable. The composer picks up to `booking.maxOptionalBeatParticipants` (1) of them at booking time, filtered by availability and double-booking and by the pairing rules that are its own: an outsider on direct-match cooldown with the beat's wrestlers is barred, and one they have already met this run sorts to the back. That last rule matters — without it showcase opponents repeated and direct rematches went 12 → 23 on one seed. A showcase whose shortlist is empty at plan time falls back to the `confrontation` it stands in for; one whose shortlist is entirely unavailable at booking time takes the existing `invalidateAndSubstitute` path, so the program keeps its week instead of holding it open for an opponent who never turns up. `directMatchRepetitionBudget` is finally *read* at selection as well as by 3.12.4's repetition trigger: the payoff is exempt, everything before it is rationed. Three new metrics make the Done-when checkable in the report — `programsWithSoleDominant`, `televisionMatchBeats`, `outsideBeatParticipants`.

**Measured.** 8-week/2-seed: beats generated by type went from `attack save interference 0, showcase contender match 0, direct rivalry match 0` to **all seven present on both seeds**; television match beats 0 → 3/4; outside bodies 0 → 2/4; sole-dominant programs **0**. At 26 weeks/3 seeds all seven are generated on every seed (promo 33/31/34, confrontation 24/18/20, ambush 1/1/1, showcase 17/17/20, rivalry match 1/1/1, go-home 4/4/2, payoff 26/24/24), 13/17/15 story matches air on television, 11/15/12 wrestlers are pulled in from outside a program, and sole-dominant programs are 0 on every seed. **MUST failures are unchanged at 8 (3/3/2)** — SL-7 recovers on seed 2 and SL-9 breaks on seed 2, and SL-3/SL-5 fail everywhere as before. Card mobility improves materially: distinct main-eventers 13/12/11 → **16/18/21**, and story advancement from segments 62%/54%/53% → 43%/36%/41% — matches now carry a real share of the storytelling, which is the point of the phase. **The costs are real and are not tuning noise.** Planned-finish adherence fell 84%/87%/79% → 79%/74%/79% (refusals 16/13/20 → 21/23/19), programs resolved 21/19/19 → 16/18/15, and PLE build coverage 61%/49%/54% → 47%/53%/42%. See the handoffs below and [playtest-notes.md](playtest-notes.md).

**Three things to hand on.** (1) **The adherence drop has one mechanism, and it is not the beat catalog.** `segmentExecution` treats a non-intended participant playing `protect_mystery` as a refusal, and `decide.ts` hands every AI wrestler their *stance default* intent without ever reading what they were booked to do — so a `protect_character`-stanced wrestler refuses every beat they are not booked to lead. Momentum trading makes that half a program's beats instead of a third, which is the whole of the +9 confrontation deviations and +7 showcase deviations. The fix is for the AI to read `slot.plannedOutcome`/`plannedFinish` when choosing an intent, so a refusal is a *choice* rather than a default; that belongs wherever AI intent is next opened, and it should not be bought back by un-trading the dominance. (2) **`attack_save_interference` and `direct_rivalry_match` are generated exactly once per 26-week seed**, because they belong to `settle_grudge` and the director almost never produces a `grudge`/`betrayal` catalyst — `elevate_act` is the objective for nearly every story. The archetypes are not the constraint; catalyst monoculture is, and that is [3.12.9](#phase-3129--story-variety-post-payoff-life-and-the-long-horizon--before-26-week-tuning) task 1. Relatedly, `fallbackObjective` still builds a second candidate per story that the planner can never select — a dead scoring path for 3.12.7 task 3. (3) **PLE build coverage and completion fell** and should be watched, not tuned here: a match beat is simply harder to book than a promo (it needs a match slot, a free opponent, and a clear cooldown), so a program that misses one loses the week and can miss its payoff — abandonments went 6 → 11 across the seed set. `booking.beatOutsideCandidateCount` was probed at 5: it bought SL-4 on one seed while costing that seed coverage, adherence and main-eventer diversity, so it stayed at 3 on the same seed-noise grounds 3.12.5 established. 3.12.7's card shape owns the real answer.

---

## Phase 3.12.7 — Card shape, score-driven selection, one objective system ⚙ blocks 3.13

**Goal:** Make a week of TV read like TV, make the documented soft score actually select, and end the two-objective-systems split.

1. **TV main event is usually a match.** Every observed TV main event was a promo. Add a card-shape rule: prefer a match in `main_event` on TV (config `tvMainEventMatchBias`, e.g. a strong score bonus for match candidates in the top slot); a segment main event stays possible for a white-hot angle. Ensure `assignPositions` ([gm.ts:249](../packages/sim/src/gm.ts#L249)) considers slot kind, not only heat.
2. **Same-slot fatigue:** penalize placing the same program in the same position on consecutive shows (the run had identical main-event/opener assignments three weeks straight). Config `repeatPlacementPenalty`.
3. **Score selects, order reserves.** Passes 1–2 of `bookShow` (due payoffs, closing windows, obligations) stay reservation-based per 3.12's design. Passes 3+ (other eligible beats, story slots, rotation) must rank candidates by `scoreComponents` ([gm.ts:262](../packages/sim/src/gm.ts#L262)) *before* commitment instead of computing it afterward for the trace. Add the missing `repeat-pairing penalty` term (PLAN 3.12's soft score lists it; it was never implemented) and make `promotion objective fit` discriminate (it is currently a flat 20.0 for every candidate — see any run trace).
4. **One objective system.** Retire the legacy `bookingObjective` + `rotateBookingObjectiveIfDue` ([gm.ts:21](../packages/sim/src/gm.ts#L21), [world.ts:43-48](../packages/contracts/src/world.ts#L43-L48)) — Phase 3.9 task 5 required this and it never happened. `gmObjective` (PLE-cycle persistence) becomes the only creative direction; `objectiveFit` and slot `gmIntent` read from it; `prepare_major_event` gains its PLE-proximity meaning (favor program beats over rotation in go-home week) or is deleted. Contracts change + schemaVersion bump; migrate fixtures.
5. **Rotation serves the midcard, not noise:** rotation filler results should feed the contender pipeline — track recent rotation win streaks and surface them to the planner as `establish_challenger`/`elevate_act` catalysts (consumed in 3.12.8/3.12.9). Minimal here: expose a derived "form" read (last-N rotation results) the planner can query; no new stored state.

**Testing:** golden cards: TV with a match main event and a segment elsewhere; a program not repeating a position three shows running; a trace where two valid candidates' selection order matches their score order; grep-level test that `bookingObjective` no longer exists in contracts or sim.

**Done when:** the 8-week run's TV cards each have a match main event unless a program is peaking hot; traces show score-ordered selection with a live repeat-pairing penalty; one objective system remains.

---

## Phase 3.12.8 — Title programs: challengers built, changes planned ⚙ blocks 3.13

**Goal:** No cold title matches. A belt is defended as the payoff of a program; title changes are creative decisions made weeks ahead; title stature governs placement and eligibility. This finishes what Phase 3.11 started when it moved title policy out of `resolveMatch`.

1. **The staleness clock triggers the planner, not a match.** Replace the day-of PLE passes (stale-title contender reservation [gm.ts:397-408](../packages/sim/src/gm.ts#L397-L408) and cold title defense [gm.ts:440-463](../packages/sim/src/gm.ts#L440-L463)): when a belt approaches staleness (`titleDefenseStalenessWeeks − leadWeeks`) or a contender is ready, the *planner* creates a title program (`retain_championship` or `change_championship`) targeting the next PLE, with the champion as participant and the challenger chosen by `highestScoringContender` ([gm.ts:167](../packages/sim/src/gm.ts#L167)) — which becomes a planning input, not a booking pass. A same-week cold defense remains only as a last-resort fallback when no program could be formed in time; it must be logged in the trace as `fallback_cold_defense`.
2. **`change_championship` becomes reachable.** `objectiveFor` ([program-plans.ts:31](../packages/sim/src/program-plans.ts#L31)) selects it when structured conditions hold: champion momentum sustained negative, reign length past a config threshold, or a challenger whose popularity+momentum exceeds the champion's by a margin — thresholds in `bookingTuningSchema`. `finishForPlannedBeat` ([gm.ts:134](../packages/sim/src/gm.ts#L134)) already honors it. A planned title change at a PLE payoff is the *only* normal route for a belt to move. Finish-family selection follows booking_ai §7's alignment-texture tendencies as config-weighted biases (heel winner leans `dirty`/`interference` when the program should continue, `clean` for a decisive statement; face winner leans `clean`) — alignment biases the *texture*, never the winner.
3. **Title stature rules:** (a) a world-title match may never be placed below `upper` (hard constraint in `assignPositions` — the stakes bonus usually main-events it; this floor catches the pathological case observed, a world-title change in a mid slot); (b) midcard-title challengers respect a stature ceiling — a wrestler above `midcardTitleStarPowerCeiling` (config, ~80) does not chase the IC belt, keeping it a proving ground (extends the role-based `titleEligibility` from 3.7.3 with a status axis).
4. **The champion always has direction:** when a title program resolves, the planner immediately starts the next one or explicitly rests the belt with a revision (bounded by the staleness clock). The world champion should effectively never be programless — that is what keeps them on TV.
5. **Kill the 8% TV title roll** ([gm.ts:476](../packages/sim/src/gm.ts#L476)): TV title matches happen only as planned program beats (story-justified), per Phase 3.5 task 4's original intent.

**Testing:** golden fixtures: a challenger built through ≥2 TV beats into a PLE title match (this is 3.13 fixture 4 — build it here); a planned `change_championship` program moves the belt at the PLE with a `dirty`/`clean` finish as planned; a world-title match never appears below `upper` across a multi-seed run; a top-starPower act is never booked for the IC belt; a belt with no formable program falls back with the trace marker.

**Done when:** in an 8-week run every title match is a program payoff (or a trace-marked fallback), at least one title program includes a planned finish whose consequence (`retain`/`change`) was decided at plan time, and title lineage changes only through planned finishes or explicit replans.

---

## Phase 3.12.9 — Story variety, post-payoff life, and the long horizon ⚙ before 26-week tuning

**Goal:** Break the one-new-clone-story-per-week rhythm, give feuds aftermath, and give the calendar identity. Required before 3.13's 26-week reconnection is tuned; the 8-week gate can pass without the calendar work but not without catalyst variety.

1. **Catalyst diversity** ([director.ts:25-56](../packages/sim/src/director.ts#L25-L56)): stop pairing "the top two idle wrestlers" every week. Generate candidate catalysts from world facts per booking_ai §8: relationship extremes (high `rivalry` → `grudge`; high `affinity` + competing pushes → `alliance_strain` and, on a triggering event, `betrayal`), title scene (contender form from 3.12.7 task 5 → `title_pursuit`), crowd response (a hot mid-carder → elevation catalyst), finish texture of recently resolved programs (an unjust finish → rematch/grudge catalyst, per booking_ai §7), and alignment: prefer face-vs-heel pairings (soft score term, config `alignmentOppositionBonus`) — booking_ai §8 lists "alignment and relationship fit" and nothing implements it. `betrayal`, `redemption`, `authority_defiance` tensions must each be reachable from a structured condition; `turn_character`/`redeem_act` objectives are designed in booking_ai §16 and land in Phase 3.14 — they stay in the enums, dormant, and this phase must not block on them.
2. **Portfolio-driven cadence:** create a new story/program when the active portfolio drops below its target band (3–5), not one per show tick unconditionally ([director.ts:56](../packages/sim/src/director.ts#L56)). The observed run mechanically opened a story every week into a growing backlog.
3. **Post-payoff aftermath:** after a payoff resolves, both participants get a rotation-rest bias for N weeks (config `postPayoffRestWeeks`) and a direct-match cooldown extension; a close, high-quality blowoff *or an unjust finish* (`dirty`/`interference` — finish texture per booking_ai §7) may spawn a follow-up program (`extend`-style revision or a new plan with escalated stakes and the remaining `directMatchRepetitionBudget`) — replacing the current 40% same-story reopen at [stories.ts:73](../packages/sim/src/stories.ts#L73) with a planner decision. Losers pivot: the planner may seed the loser into a `redeem_act`/`elevate_act` catalyst rather than dropping them to pure rotation.
4. **PLE identity:** read `promotion.pleCalendar` (loaded since Phase 3.6, never consumed) — name shows in events/reports, and add an optional `tier: "marquee" | "standard"` to the calendar schema (update [scenario-data-spec.md](scenario-data-spec.md) and `data/wwe-2026/promotion.json` in the same change). The planner may target a marquee PLE with a longer, two-cycle program (payoff at the marquee event, a keep-warm beat cadence in between) for its highest-priority program. This is the minimal long-horizon mechanism — full season arcs stay out of scope.

**Testing:** multi-seed 8-week runs produce ≥3 distinct tension types and at least one face-vs-heel program; portfolio size stays in band with no unbounded backlog; a resolved feud's participants rest ≥1 show from rotation; a marquee-targeted program spans two cycles in a scripted fixture.

**Done when:** story premises in a slice read as varied wrestling reasons rather than one cloned sentence; the backlog metric stays bounded over 26 weeks; PLEs have names in the report; at least one program pays off on a marquee event across the seed set.

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
10. Run the same planner through the existing 26-week harness. The booking metrics (program completion/abandonment, beats-before-payoff, PLE build coverage, direct-rematch frequency, segment share, escalation violations, revisions by cause, finish adherence, main-event/challenger diversity, unresolved-program backlog) land in Phase 3.12.1 — this step verifies them at 26 weeks and adds the remainder: role utilization and action-to-consequence delay.
11. Change the automated slice gate so every MUST criterion actually fails the test when below threshold. Treat prior prose in `playtest-notes.md` as historical; record fresh results for the implemented planner and current tuning.
12. Tune program, card, title, roster, and popularity behavior together across multiple fixed seeds. Do not tune popularity in isolation to compensate for incoherent booking.

**Done when:** the eight-week creative gate passes every deterministic and qualitative requirement; the 26-week harness uses the new planner, enforces MUST failures, and has fresh recorded results; root tests/typecheck pass; Phase 4 narrative work can consume stable match, segment, plan-revision, and show facts without inventing booking logic.

---

## Phase 3.14 — Character turns (after the creative gate)

**Goal:** Booking-driven face/heel turns per [booking_ai §16](booking_ai.md#16-character-turns): the sim recognizes when the crowd or a relationship has made a turn right, plans it as a `turn_character` program, and executes it on a beat. Not required by the 3.13 gate; may run in parallel with Phase 4. The player-side path (spec's turn proposal, `propose_character_change`) already exists — this phase adds the GM-initiated path and the shared execution mechanics.

**Contracts:**
1. A structured `character_turned` event (wrestler, previous/new alignment, trigger cause, program/beat refs) and any plan field the turn beat needs (e.g. `turnsWrestlerId` on the plan or beat). Bump `schemaVersion`; regenerate fixtures. New tuning knobs in `bookingTuningSchema`/`popularityTuningSchema`: contradiction margin + duration, staleness window, heat conversion factor, protection-window weeks.

**Sim:**
2. **Triggers** (all config-gated, rare — booking_ai §16): crowd contradiction (a heel whose `positiveHeat` exceeds `negativeHeat` by the margin for the duration, or the inverse for a face); staleness (cold at current alignment past the window); betrayal catalyst (resentment/rivalry thresholds crossed inside an `alliance_strain` program); accepted player request. Each produces a `turn_character` program candidate through the normal 3.12.9 catalyst path. **Hard constraint: at most one active `turn_character` program.**
3. **Execution through beats:** the flip happens at resolution of a designated beat (typically `attack_save_interference`, or the payoff) — no new beat type. On resolution: flip `alignment`, emit `character_turned`, and *convert* heat by the conversion factor rather than resetting it (the crowd energy that motivated the turn carries over).
4. **Aftermath:** seed the follow-up per booking_ai §7/§16 — heel turn → grudge/`betrayal` program against the former ally; face turn → `redeem_act` arc — and apply a protection window (planner avoids burying the turned act for N weeks).
5. **Consent and refusal:** human-controlled wrestlers turn only via an accepted proposal/response; an AI wrestler may refuse based on stance/personality, cancelling the plan with a recorded revision (reuse the 3.12.4 machinery).

**Testing:** a cheered-heel fixture crosses the contradiction threshold → turn program → beat resolution flips alignment with converted heat and a `character_turned` event; a refusal fixture cancels with a revision; the one-active-turn constraint holds; a 26-week run produces ≤2 turns, each narratable from events alone (trigger → program → beat → consequence).

**Done when:** `turn_character` and `redeem_act` are reachable in live runs; turns are rare, consented where required, and fully explainable from the event log; `slice.test.ts` and the 3.13 gate tests still pass.

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
