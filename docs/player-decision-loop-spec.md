# Player Decision Loop Specification — v0.2

**Status:** Accepted
**Purpose:** Define the player-facing decision structure for the tick-based multiplayer wrestling career simulation.

## Document map and precedence

| Document | Role |
| --- | --- |
| [GDD.md](GDD.md) | Vision and simulation systems. Owns the canonical tick pipeline (GDD §4). |
| **This spec** | **Authoritative for player-facing choice structure.** On conflict with GDD §5–§6, this spec wins. |
| [PLAN.md](PLAN.md) | Execution order for the AI agent building the prototype. |
| `packages/contracts` | Machine canon. Once PLAN Phase 1.5 lands, the zod schemas are the source of truth for all tokens defined here; this spec must be updated if they diverge. |

Requirement keywords **MUST**, **SHOULD**, and **MAY** are used per RFC 2119. Every enum-like list in this spec carries a stable machine token in backticks — contracts, tests, and playtest notes MUST use these tokens, not the prose labels.

---

## 1. Core principle

Players make only a few deliberate choices between simulation ticks. The player does not manually control matches, select individual wrestling moves, or continuously manage minor tasks.

The decision model has five components:

1. **One proactive interaction** (§3) — influence a person or organization.
2. **One proactive action** (§4) — spend time and energy.
3. **Contextual reactive decisions** (§5) — respond to what the world generates.
4. **Match or segment intent** (§6) — when booked.
5. **One persistent career stance** (§7) — standing priority.

The proactive choices create scarcity. The simulation creates additional situations requiring judgment.

---

## 2. Decision period and tick structure

A **decision period** is the window between two consecutive ticks — of either type. Every tick (decision ticks *and* show ticks, see GDD §4) grants the player one fresh interaction slot and one fresh action slot. With the default week of 2 decision ticks + 1 show tick, a player has ~3 slot pairs per in-game week. Slots do not bank: an unused slot expires when the tick runs.

Before a tick, the player MAY:

- Submit one interaction (§3)
- Submit one action (§4)
- Respond to active reactive decisions and proposals (§5)
- Set match or segment intent when booked (§6)
- Queue a career stance change (§7)

The complete set of a player's inputs for one period is a **player turn** (`PlayerTurn` in contracts).

What happens when the tick runs is defined once, in **GDD §4** (canonical tick pipeline). This spec does not restate it.

A player who submits nothing still participates through their persistent stance and AI fallback behavior (§7, DL-7).

---

## 3. Proactive interaction

Each player receives **one interaction slot per decision period**. The interaction is an attempt to influence another person or organization.

The player chooses a **target**, an **intent**, and an optional contextual **emphasis**. The player does not write exact dialogue.

### 3.1 Targets

| Target | Token | Prototype? |
| --- | --- | --- |
| General manager | `gm` | yes |
| Another wrestler | `wrestler` | yes |
| Mentor | `mentor` | post-prototype |
| Manager or agent | `agent` | post-prototype |
| Sponsor | `sponsor` | post-prototype |
| Media contact | `media` | post-prototype |
| Faction or tag-team partner | `partner` | post-prototype |

### 3.2 General manager intents

- Request an opportunity (`request_opportunity`)
- Pitch a feud (`pitch_feud`)
- Pitch a tag team or faction (`pitch_alliance`)
- Challenge a booking decision (`challenge_booking`)
- Ask for more promo time (`request_promo_time`)
- Propose a character adjustment (`propose_character_change`)
- Ask for feedback (`request_feedback`)
- Offer to help another wrestler or division (`offer_help`)

Outcomes: `accepted`, `rejected`, `deferred`, `conditional`, `countered` — plus side effects such as trust changes or a new opportunity being created.

### 3.3 Wrestler intents

- Pitch a feud (`pitch_feud`)
- Propose an alliance or tag team (`propose_alliance`)
- Build trust (`build_trust`)
- Ask for support (`request_support`)
- Offer to elevate them (`offer_elevation`)
- Provoke them (`provoke`)
- Repair a damaged relationship (`repair_relationship`)
- Undermine them (`undermine`)
- Coordinate a creative pitch (`coordinate_pitch`)

**Proposals.** When the target is human-controlled, many intents create a **proposal** (`Proposal` in contracts). The receiving player MAY respond `accept`, `reject`, `counter`, or `ignore`.

Proposal rules:

- Default response deadline: **2 ticks** after delivery.
- An expired proposal resolves as `ignore`.
- Ignoring (explicitly or by expiry) applies a small negative affinity/trust effect on the proposer's side — ghosting is not free, but it is far cheaper than betrayal.
- A proposal resolves on the tick where the response (or expiry) lands.

### 3.4 Mentor, sponsor, agent, and media intents *(post-prototype)*

Mentors provide targeted development, information (see §9), or access rather than generic stat bonuses. Sponsor/agent/media intents cover appearances, publicity, rumors, and public positioning. These targets MUST NOT be built before the prototype gate (PLAN Phase 3) passes.

### 3.5 Interaction availability

The UI MUST NOT display every possible intent at all times. Show approximately **three to five context-sensitive intents** based on: current relationship, recent events, active stories, target role, player reputation, GM plans, and existing proposals (see DL-5).

The important choice is usually **who** receives the player's single interaction.

---

## 4. Proactive action

Each player receives **one action slot per decision period**. The action represents how the wrestler spends their available time and energy.

Money does not occupy a slot: spending money **upgrades the quality of an action** (better training, better recovery, better presentation — GDD §8) rather than being an action itself.

### 4.1 Action categories and trade-offs

Every action MUST carry both benefits and costs or risks (DL-3).

| Action | Token | Benefits | Costs & risks |
| --- | --- | --- | --- |
| Train a skill | `train_skill` | Skill development; mentor synergy | Fatigue; injury risk; diminishing returns when repeated without match experience or mentorship (§4.2) |
| Recover | `recover` | Reduced fatigue; improved health; lower injury risk | No active development; possible loss of momentum or visibility |
| Promote a match or story | `promote_match` | Awareness; story interest; potential popularity | Overexposure; weak promotion hurts credibility |
| Engage with fans | `engage_fans` | Fan loyalty; positive reputation; audience-segment appeal | Fatigue; little GM influence; overavailability reduces mystique |
| Work social media | `work_social_media` | Visibility; direct fan engagement; ability to react to stories | Controversy; miscommunication; conflict with GM or sponsors |
| Develop character | `develop_character` | Clearer presentation; better gimmick fit; promo/story compatibility | No physical development; changes may confuse the crowd; major changes need GM approval (GDD §9) |
| Study an opponent | `study_opponent` | Sharper information about the opponent (§9); preparation edge | No development; wasted if the booking changes |
| Network backstage | `network` | Backstage influence; new opportunities; access; information (§9) | May appear manipulative; can reduce trust with some wrestlers |
| Take an outside appearance | `outside_appearance` | Money; public visibility; sponsor relationships | Fatigue; reduced preparation; conflict with promotion priorities |

> v0.1's separate `rest_fully` action is merged into `recover`.

The prototype uses the subset in §13.

### 4.2 Repetition has diminishing returns

Mechanisms that enforce DL-3 ("no obvious best action") against repetition:

- **Training plateau:** repeating `train_skill` on the same skill yields diminishing gains unless refreshed by match experience, working with stronger wrestlers, or mentorship (GDD §7).
- **GM patience:** repeating the same ask or pitch to the GM within a short window reduces receptiveness and erodes trust.
- **Crowd fatigue:** promotion and fan-facing actions are subject to the overexposure/fatigue measures in GDD §10.

These mechanisms MUST be observable in playtests (PLAN Phase 3 gate).

---

## 5. Reactive decisions

Reactive decisions are generated by the simulation. They do not consume the interaction or action slot. They are the main source of short-term drama and variation.

### 5.1 Reactive event types

- The GM asks the player to lose clean (`booking_request`)
- Another wrestler proposes a feud or angle (`wrestler_proposal`)
- Creative proposes a direction, e.g. a heel/face turn (`turn_proposal`)
- Creative changes the planned finish (`finish_changed`)
- A rival insults the player publicly (`public_insult`)
- The dirt sheet publishes a damaging rumor (`rumor_published`)
- An injury forces a risk decision before an important match (`injury_decision`)
- Another wrestler asks the player to support their pitch (`support_request`)
- A risky opportunity is offered (`risky_opportunity`)
- A sponsor requests an appearance (`sponsor_request`) *(post-prototype)*
- A mentor offers help (`mentor_offer`) *(post-prototype)*

### 5.2 Responses

`accept` · `refuse` · `negotiate` · `ignore` · `delay` · `escalate` · `cooperate_conditionally`

Not every response is available for every event type. Responses MUST have context-dependent consequences — e.g. refusing to lose may protect character credibility but damage GM trust and professional reputation.

### 5.3 Decision volume

Reactive choices MUST remain selective. A normal decision period SHOULD contain **zero to two** important reactive decisions; more only during major stories or events. Do not generate constant low-value prompts.

### 5.4 Multiplayer coherence

When two human players are in the same match or segment, the reactive prompts they receive about it MUST be complementary views of the same situation, never contradictory facts (e.g. if the GM changes the finish, both participants learn the same new finish, each from their own perspective).

---

## 6. Match and segment intent

When booked in a match or important segment, the player MAY set a broad intent. Intent does not control individual moves and never guarantees an outcome.

This section is the **canonical intent vocabulary**. GDD §14 and `packages/contracts` reference this list; no other document may restate it.

### 6.1 Match intents

- Protect your character (`protect_character`)
- Make the opponent look strong (`elevate_opponent`)
- Chase match quality (`chase_quality`)
- Work safely (`work_safely`)
- Play to the crowd (`play_to_crowd`)
- Advance the story (`advance_story`)
- Take creative risks (`take_risks`)
- Follow the plan closely (`follow_plan`)
- Attempt to steal the spotlight (`steal_spotlight`)

> Legacy mapping (GDD v0.3 / contracts pre-1.5): "make opponent look strong" → `elevate_opponent`, "emphasise storytelling" / `emphasise_story` → `advance_story`, "chase spectacle" / `chase_spectacle` → `chase_quality`.

### 6.2 Segment intents

- Build sympathy (`build_sympathy`)
- Generate hostility (`generate_hostility`)
- Promote the opponent (`promote_opponent`)
- Escalate the rivalry (`escalate_rivalry`)
- Show vulnerability (`show_vulnerability`)
- Protect mystery (`protect_mystery`)
- Seek controversy (`seek_controversy`)
- Stay controlled (`stay_controlled`)

### 6.3 Resolution inputs

The simulation considers: player intent, opponent intent, skills, relationship, professionalism, story state, crowd expectations, GM instructions, physical condition, chemistry, and seeded random variation.

### 6.4 Conflicting intents

When participants' intents conflict (e.g. `steal_spotlight` vs `follow_plan`), resolution follows one principle:

1. **Whose intent dominates the ring** is a contest weighted primarily by **psychology** and **professionalism** (plus condition and experience). The dominant intent shapes what the match visibly becomes.
2. **Both sides always accrue consequences.** The non-dominant participant's *attempt* still lands: crowd reaction, GM reaction, and relationship changes reflect what they tried, not only what succeeded. Going off-script and failing looks worse than going off-script and getting over.

Conflicting intents SHOULD be a source of especially interesting outcomes, not a punishment for one side.

---

## 7. Persistent career stance

Each player selects one standing priority. The stance remains active until changed.

### 7.1 Stances

- Prioritize health (`prioritize_health`)
- Chase popularity (`chase_popularity`)
- Cooperate with creative (`cooperate_with_creative`)
- Protect character credibility (`protect_character`)
- Support allies (`support_allies`)
- Pursue championships (`pursue_championships`)
- Maximize income (`maximize_income`)
- Seek match quality (`seek_match_quality`)
- Avoid backstage conflict (`avoid_conflict`)

`protect_character` deliberately appears in both the stance and match-intent enums: when a booked player sets no explicit intent, their stance provides the default.

### 7.2 Stance is the AI utility weighting

The stance is not a separate system: it **is the utility-weight preset** used by the AI wrestler brain (PLAN Phase 2). Every wrestler — human or AI — has stance-derived weights. When a human player submits no turn, the AI brain picks safe fallback behavior using their stance, exactly as it does for AI wrestlers. Explicit player choices override the utility pick for that slot.

This makes DL-7 ("absence is supported") structurally free and guarantees fallback behavior matches the player's declared priorities.

### 7.3 Stance inertia

A stance change MAY be queued at any time, but it **takes effect on the following tick**, not the current one. This prevents using stance flips as a free extra action slot (e.g. `chase_popularity` the tick before a big show, `prioritize_health` right after).

The stance influences outcomes and fallback behavior but MUST NOT replace direct choices.

---

## 8. What the player knows (information model)

Meaningful choice under scarcity requires legible but imperfect information. This section defines what the player can see when deciding.

### 8.1 Rules

- The player MUST NOT see raw numeric simulation state (no "trust: 62"). Exact values are internal.
- Every decision the UI offers MUST be accompanied by the qualitative context needed to reason about it — a choice the player cannot reason about is a dice roll, not a decision.
- Qualitative projections are deterministic mappings from sim state, defined once in `packages/contracts`, and shared by CLI and web UI.

### 8.2 What is visible, and how

| State | Player-facing form |
| --- | --- |
| Relationships | Qualitative tiers per dimension (e.g. hostile / cold / neutral / warm / trusted), coarse |
| Own skills | Coarse bands, slightly finer than what you see of others |
| Popularity & momentum | Descriptive bands plus a direction indicator (rising / steady / falling) |
| GM disposition | Never shown directly — inferred from message tone, booking decisions, and outcomes |
| Story state | Qualitative interest and momentum ("the crowd is invested", "this feud is cooling") |
| Crowd reaction | Shown per show, in narrative form |

### 8.3 Truthfulness

- The **personal feed** is truthful but limited to what the character would plausibly know.
- The **dirt sheet** (GDD §17) MAY be wrong, exaggerated, or planted. It is the shared, unreliable layer.

### 8.4 Sharpening information

Some actions and interactions exist partly to buy information: `study_opponent` reveals opponent tendencies and condition, `network` surfaces backstage attitudes and upcoming plans, and mentor interactions (post-prototype) provide political reads. Information is a resource with a cost, like everything else.

---

## 9. First session

The joining experience must sell the core fantasy: entering a world already in motion.

- The player claims an open wrestler slot: a premade identity with light customization (name, character concept, alignment, promo tone — GDD §9).
- Their first Home screen is a **"who you are" brief** generated from world state: current popularity band, one existing relationship hook (a rival, a sympathetic veteran, a skeptical GM), and their next booking if any.
- The first decision period is the standard loop at reduced stakes — no separate tutorial mode. Contextual availability (§3.5) does the teaching by offering 3–5 sensible intents.
- The simulation SHOULD generate at least one reactive decision within the player's first in-game week, so the full loop (proactive → tick → reactive) is experienced early.

---

## 10. Example game flow

### Decision period A

The player learns that the GM may replace them in an active feud.

- **Interaction:** target `gm`, intent `challenge_booking` — defend the story.
- **Action:** `promote_match`.
- **Reactive decision:** the rival proposes an unsanctioned post-match attack (`wrestler_proposal`) — respond `accept` / `refuse` / `negotiate`.
- **Match intent:** `advance_story`.
- **Stance:** `chase_popularity` (unchanged).

### Tick resolution

The simulation determines: whether the GM is convinced, whether the rival follows the agreed plan, match performance, crowd reaction, popularity and momentum changes, GM trust, story interest, and relationship consequences.

The LLM layer renders: personal summary, match recap, rival quote, GM message, dirt-sheet report (GDD §15–16).

### Decision period B

The crowd unexpectedly supports the rival. The GM proposes turning the player heel (`turn_proposal`). The player decides: `accept`, `refuse`, `negotiate` a slower turn, or counter by suggesting the roles be reversed.

The simulation has created the next meaningful choice.

---

## 11. Design rules

| ID | Rule | Strength |
| --- | --- | --- |
| **DL-1** | **Proactive choices are scarce.** The player MUST NOT be able to talk to every important person or improve every area in one period. | MUST |
| **DL-2** | **Reactive choices create variety.** Dilemmas MUST derive from simulation state, not random prompts disconnected from current stories. | MUST |
| **DL-3** | **No obvious best action.** Every meaningful option MUST involve opportunity cost, risk, or uncertainty; repetition MUST have diminishing returns via the mechanisms in §4.2. | MUST |
| **DL-4** | **Failure remains playable.** Rejected pitches, weak performances, and damaged relationships MUST create new situations rather than dead ends. | MUST |
| **DL-5** | **Context controls availability.** Actions and interactions SHOULD appear because they make sense in the current world (§3.5). | SHOULD |
| **DL-6** | **The simulation remains authoritative.** The LLM explains and dramatizes outcomes but MUST NOT determine them (GDD §15). | MUST |
| **DL-7** | **Absence is supported.** Missing a decision period MUST NOT destroy a career; stance-driven fallback (§7.2) keeps absent players active and safe. | MUST |

Playtest notes and tests SHOULD cite these IDs.

---

## 12. Prototype scope recommendation

For the first multiplayer prototype:

- **Interaction targets:** `gm`, `wrestler`
- **Actions:** `train_skill`, `recover`, `promote_match`, `develop_character`
- **Reactive types:** `booking_request`, `wrestler_proposal`, `turn_proposal` / `finish_changed`, `injury_decision`
- **Match intents:** `protect_character`, `elevate_opponent`, `chase_quality`, `work_safely`, `advance_story`
- **Stances:** `prioritize_health`, `chase_popularity`, `cooperate_with_creative`, `protect_character`

This is enough to test whether limited choices combined with autonomous simulation produce interesting shared careers.

---

## 13. Core validation question

The system succeeds when players feel:

> "I could not do everything, so I had to choose what mattered before the world advanced."

It fails when players feel:

> "I selected the same optimal action every tick and waited for numbers to increase."
