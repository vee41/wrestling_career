# MVP Prototype — AI Agent Execution Plan

Companion to [GDD.md](GDD.md) (v0.4) and the [player decision loop spec](player-decision-loop-spec.md) (v0.2, "the spec"). This plan turns those documents into an ordered set of build phases an AI agent can execute autonomously. Each phase has a goal, concrete tasks, and acceptance criteria that can be verified without human judgement wherever possible.

**Precedence:** GDD owns vision and the canonical tick pipeline (GDD §4); the spec owns the player choice structure and all choice vocabularies (its tokens are normative); this plan owns execution order. Once Phase 1.5 lands, `packages/contracts` is the machine canon for tokens.

## Guiding decisions (already made — do not re-litigate)

1. **Simulation first, UI last.** The core risk in the GDD is whether the simulation produces careers worth talking about (§21). Build and playtest the sim headlessly before investing in screens.
2. **Monorepo with a framework-independent sim package.** Per GDD §19, the simulation must not import SvelteKit, Supabase, or any LLM SDK.
3. **Deterministic simulation.** All randomness flows through a single seeded RNG passed into the tick function. Same state + same actions + same seed = same result. This makes the sim testable and replayable.
4. **The LLM never mutates game state.** Narrative jobs are produced by the sim as structured facts; narrative output is stored as display text only (GDD §15–16).
5. **Template provider before Ollama.** The narrative provider interface ships with a deterministic template provider and a mock provider first. Ollama is an optional later swap — no phase may block on a local LLM being available.
6. **Manual ticks only** for the prototype. No schedulers, no cron.
7. **Persistence is a snapshot, not event sourcing.** Store the full world state as versioned JSON plus an append-only event log for the dirt sheet. Do not build per-entity relational CRUD for sim internals.
8. **The decision-loop spec is authoritative for player choices.** One interaction slot + one action slot per tick (both tick types), reactive decisions, match/segment intent, persistent stance with next-tick inertia. Stance doubles as the AI utility weighting (spec §7.2). Players see qualitative projections, never raw numbers (spec §8).

## Repository layout

```
wrestling_career/
  CLAUDE.md
  docs/
    GDD.md
    PLAN.md
    player-decision-loop-spec.md
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

---

## Phase 3 — CLI harness: headless playtesting

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

- Seed script for the canonical prototype world (30 AI wrestlers, 1 GM, 4–8 human slots).
- Multi-tick soak test: 24 simulated weeks through the web stack without state corruption, including proposals expiring and absent players surviving on stance fallback.
- Rate/validity guards on turn submission; graceful handling of ticks with zero human turns.
- A `README.md` covering setup, seeding, running ticks, and switching narrative providers.
- Final check against GDD §21 and spec §13: write up one AI-played career as a paragraph. If it reads like "I trained stats until champion," return to Phase 2 tuning — that is a launch blocker, not a nice-to-have.

---

## Cross-cutting rules for the executing agent

- **Order is strict** through Phase 3; Phases 4 and 5a may be parallelized after the Phase 3 gate.
- **Every phase lands with passing tests** (`pnpm test` + `pnpm typecheck` green at root). Deviations from this plan are recorded in the plan itself: amend the relevant phase section in place.
- **Tokens are normative.** All enum values in code MUST match the spec's backticked tokens verbatim. If a token must change, update the spec in the same change.
- **When the GDD or spec offers options** ("possible skills", "useful measures may include"), pick the listed set as-is — do not invent additional systems.
- **When the docs are silent**, choose the simplest thing that preserves the pillars (GDD §2) and the design rules (spec §11, DL-1…DL-7), note the decision in a code comment or the relevant doc section, and move on. Do not block on questions unless a pillar or a MUST-level rule is at risk.
- **Scope discipline:** anything in GDD §3 "Not initially included" or tagged *post-prototype* in the spec is out — reject the temptation to add mentors, sponsors, finances, or multiple promotions even if "easy."
- **The validation questions (GDD §21, spec §13) are the acceptance test for the whole prototype.** Emergent, social, non-linear careers beat feature completeness. When trading off, cut features, not consequence depth.
