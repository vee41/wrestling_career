# Wrestling Career Simulation — GDD v0.5

## Document map and precedence

| Document | Role |
| --- | --- |
| **This GDD** | Vision and simulation systems. Owns the canonical tick pipeline (§4). |
| [player-decision-loop-spec.md](player-decision-loop-spec.md) | **Authoritative for player-facing choice structure.** On conflict with §5–§6 here, the spec wins. Owns all choice vocabularies (intents, stances, actions, reactive types). |
| [six-month-slice.md](six-month-slice.md) | **The MVP target.** Defines the believable six-month slice the simulation must produce, with measurable criteria (SL-1…SL-10). Acceptance test for sim tuning. |
| [scenario-data-spec.md](scenario-data-spec.md) | Data file formats for replaceable game worlds (rosters, titles, calendar, config). |
| [PLAN.md](PLAN.md) | Execution order for the AI agent building the prototype. |
| `packages/contracts` | Machine canon for all tokens and data formats. |

## 1. High concept

A mobile-first, browser-based multiplayer wrestling career simulation.

Each player controls one wrestler inside a shared promotion populated by human and AI wrestlers. Players shape their careers through performance, relationships, character choices and backstage decisions.

Matches and stories are resolved by a timed simulation. Players do not choose individual wrestling moves.

The core fantasy:

> Build a wrestling career inside a living promotion that does not revolve around you.

**MVP focus:** before careers can matter, the world must. The MVP bar is that the simulation, running on its own, produces a believable and interesting **six-month slice** of a WWE-shaped promotion — feuds that arc, titles that mean something, acts that rise *and* fall, history that accumulates. That target is specified measurably in [six-month-slice.md](six-month-slice.md). The world itself is data: rosters, titles, and calendars come from replaceable scenario files (§22), with a direct remodel of WWE as the default.

---

## 2. Design pillars

### Shared living world

The promotion advances on scheduled ticks regardless of whether an individual player acts.

Bookings, matches, relationships, stories and crowd reactions continue to evolve.

### High-level agency

Players influence their careers through a small number of meaningful choices rather than micromanagement. The exact choice structure is defined in the [decision-loop spec](player-decision-loop-spec.md).

### Simulation creates facts

The simulation determines outcomes and consequences.

LLMs turn those facts into readable dialogue, recaps, rumours and dirt-sheet coverage.

### Social careers

Other wrestlers are opportunities, rivals, allies and obstacles.

Players should care about what happens to other players, not only their own progression.

### Mobile-first sessions

The game should support short visits with only a few meaningful interactions required between ticks.

---

## 3. Initial scope

The first playable version contains:

* One shared promotion — a single brand, remodeled directly on WWE via the default scenario dataset (§22)
* A roster of ~40 wrestlers loaded from data files (men's singles division for the MVP)
* A small number of human players claiming roster slots; the rest AI
* One AI general manager
* Weekly TV show plus a monthly premium live event (PLE) — TV builds, PLEs pay off
* Two title lines: a world championship and a midcard (Intercontinental) championship
* Timed simulation ticks
* Matches, feuds and storylines with PLE blowoffs
* Crowd response and popularity — including falls: overexposure, cold streaks, and depushes
* Relationships and backstage politics
* Wrestler development
* Lightweight gimmick control
* Promotion dirt sheet
* LLM-generated narrative flavour

During development, ticks can be triggered manually.

Not initially included:

* Multiple promotions or a second brand
* Women's division and tag team division (the data format must not preclude them — see six-month-slice.md §5)
* Contracts and free agency
* Drafts
* Detailed finances
* Global wrestling simulation
* Real-time gameplay
* Move-by-move match control
* Non-wrestler interaction targets (mentors, sponsors, agents, media — see spec §3.1; all tagged post-prototype)

---

## 4. Time and simulation

The world advances in fixed ticks. There are two tick types:

* **Decision ticks** — backstage life between shows
* **Show ticks** — one each in-game week, resolving that week's show

Default week: 2 decision ticks + 1 show tick (configurable via scenario config). Shows come in two kinds: **TV** (the weekly default) and **PLE** (premium live event — every Nth week per scenario config, default every 4th). PLEs carry bigger cards, title matches, and feud blowoffs; TV builds toward them. Longer-term planning is evaluated over multiple weeks.

Every tick — both types — grants each player one interaction slot and one action slot (spec §2). Players submit their turn before the tick deadline. Unused slots expire.

### Canonical tick pipeline

This is the single authoritative definition of what a tick does. Other documents reference it; none may restate it.

1. **Collect turns** — pending player turns are collected and validated.
2. **AI decisions** — AI wrestlers (and absent players, via stance fallback — spec §7.2) choose their turns.
3. **GM decisions** — the GM responds to pitches and requests; on show ticks, books the card.
4. **Resolve interactions and responses** — interactions, proposals, and reactive-decision responses are resolved; expired proposals resolve as ignored.
5. **Resolve the show** (show ticks) — matches, segments, stories, relationships, popularity, and crowd reactions are simulated.
6. **Generate consequences** — new world events, reactive decisions, and opportunities are created.
7. **Queue narrative** — narrative jobs are sent to the LLM layer (§15–16).
8. **Present results** — personal feeds and the dirt sheet update.

A player who submits nothing still remains part of the simulation.

---

## 5. Player loop

Between ticks, the player:

* Reads personal developments
* Checks their current booking and stories
* Reviews promotion news
* Makes their choices for the period — one interaction, one action, reactive responses, match intent when booked, and (rarely) a stance change, as defined in the [decision-loop spec](player-decision-loop-spec.md)

After the tick, the player discovers:

* What happened on the show
* How the crowd reacted
* What the GM decided
* How other wrestlers responded
* Which new opportunities or problems appeared

The desired feeling is:

> “What happened while I was away, and what should I do before the next tick?”

The persistent career stance (spec §7) keeps absent players simulated safely and in line with their declared priorities.

---

## 6. Player choices

The player's agency is structured into five choice types. The [decision-loop spec](player-decision-loop-spec.md) is the authoritative definition of each; this table is a summary.

| Choice | Cadence | Spec |
| --- | --- | --- |
| Proactive **interaction** — influence a person (pitch a feud, speak to the GM, undermine a rival, build trust, …) | 1 per tick | §3 |
| Proactive **action** — spend time and energy (train, recover, promote, develop character, …) | 1 per tick | §4 |
| **Reactive decisions** — respond to what the simulation generates (booking requests, proposals, injuries, rumours) | as generated; typically 0–2 per period | §5 |
| **Match / segment intent** — broad approach when booked | per booking | §6 |
| **Career stance** — persistent standing priority; also the AI fallback | persistent; change applies next tick | §7 |

Choices create opportunities and influence decisions, but do not guarantee outcomes.

---

## 7. Wrestler development

The player develops through a compact set of skills.

Possible skills:

* Ring performance
* Psychology
* Promo ability
* Character work
* Athleticism
* Toughness
* Professionalism
* Political instinct

Skills improve through:

* Match experience
* Training
* Working with stronger wrestlers
* Mentorship
* Successful storylines
* Repeated use in relevant situations

Progression should not be purely linear. Repeated training of the same skill plateaus without match experience or mentorship (spec §4.2).

Examples:

* Athletic improvement may increase injury risk if overused.
* Political influence may reduce locker-room trust.
* Strong promo ability may create expectations the player cannot always meet.
* Professionalism may improve GM trust but make the wrestler appear predictable.

---

## 8. Money

Players earn money through appearances, bonuses and later contracts.

Money does not occupy an action slot: spending money upgrades the quality of actions and unlocks options (spec §4). It can be spent on:

* Training
* Recovery
* Medical treatment
* Promo coaching
* Managers or agents
* Gear and presentation
* Career opportunities
* Financial security during time away

Money should create trade-offs rather than act as a score.

Example:

> Spend now to improve your presentation, or save enough to survive a future injury or reject poor terms.

---

## 9. Character and gimmick

The gimmick is an important but lightweight player-controlled system.

The player controls:

* Character concept
* Alignment
* Promo tone
* Key personality traits
* Presentation
* Current direction

The system should avoid excessive component-building or optimisation.

A gimmick mainly affects:

* Audience expectations
* Story compatibility
* Promo effectiveness
* Booking fit
* Merchandising potential
* Chemistry with opponents

Players can make small adjustments regularly.

Major changes, such as a heel turn or complete repackaging, require time and may need GM approval.

---

## 10. Crowd response and popularity

Crowd response is a central simulation system. The crowd reacts to match performance, character clarity, story momentum, opponent chemistry, wins and losses, promos, repetition, surprise, perceived authenticity, and promotion context.

Crowd response is never a single permanent score. It is modelled as **four layers on four timescales**, each slower and stickier than the last:

| Layer | Field | Timescale | Meaning |
| --- | --- | --- | --- |
| Reaction | `currentReaction` | tonight | how hot this single segment was; volatile |
| Momentum | `momentum` | weeks | the trend — a decaying average of recent surprise |
| Popularity | `generalPopularity` | months | the wrestler's current spot on the card |
| Status | `starPower` | career | earned standing; the anchor popularity is pulled toward |

Alongside these, **`positiveHeat` / `negativeHeat`** track face/heel crowd sentiment and **`fatigue`** tracks overexposure. All are per-wrestler fields on the contracts popularity block.

### 10.1 What moves popularity: surprise, not performance

The driver of change is **surprise** — how far a night lands from what was expected of *that* wrestler — never raw performance. Expectation is the wrestler's own recent baseline (a trailing average of their recent segments), adjusted by the stakes of the spot. Consequences:

* Meeting your usual level moves nothing — a star having a routine good match stays where they are.
* A wrestler cannot rise merely by wrestling at their skill level; they must **exceed their own norm** (a breakout) or **win something** (a status gain).
* Beating a bigger act is an **upset** (large gain); losing to a smaller one is a **burial** (large loss). Expected results are neutral.

### 10.2 The four layers

* **`momentum`** is a decaying average of surprise. One good night nudges it; a sustained run builds real heat. Momentum, not popularity, is what the GM reads first when deciding a push — so a hot act climbs the card before its popularity has caught up.
* **`generalPopularity`** moves slowly, is capped per appearance, and is pulled by two forces: **gravity** toward `starPower`, and a **push** from momentum. Its ceiling is **not 100 — it is `starPower` plus a small band** (~10–12). A hot streak can lift a wrestler a little above their *earned* status, but no further: to sit at 90 you must first *be* a ~80 star. This tether is what stops a midcarder from riding a run of TV wins to the top of the company; the meter can only get so far ahead of what's been earned before gains flatten and gravity pulls it back.
* **`starPower`** is the earned anchor and the only thing that lets a wrestler durably leave their starting tier — and it is deliberately **hard to move, gated on real achievement**, not on accumulating wins. It rises on concrete milestones: **winning a title, main-eventing a major event, or beating a bigger star (the rub)**. A hot run of ordinary matches contributes little on its own; getting over is supposed to be hard. This is what makes a made man stay made and forces a riser to *take* status — usually a belt — rather than grind it out.

**Not everyone can be over.** Because the routes to high `starPower` are scarce — two titles, a handful of main-event spots per period — only a few wrestlers can occupy the top tier at once. Getting over generally happens at someone else's expense: you climb by taking a belt or a spot, not by everyone rising together. Popularity is competitive, not a rising tide.

Overexposure (`fatigue`) and losing streaks are pressures within this model, not flat penalties: a tired act draws a duller crowd (a lower segment, hence negative surprise), and losing to lesser acts erodes standing. `starPower` itself only falls on the mirror of how it rises — losing a title, a real burial, a sustained slump — so an established star does not bleed status from an ordinary off-month. Falls are gradual, earned, and active — never the passive product of one bad night.

### 10.3 Moments — flavour the story engine can see

Most weeks a wrestler's popularity drifts quietly. **Moments** are the discrete, occasional beats that give a career texture and give the narrative layer something concrete to grab. Each has a normative `reason` token:

| `reason` | What happened |
| --- | --- |
| `breakout` | a star-making performance well above the wrestler's own norm |
| `crowd_ignition` | the crowd spontaneously caught fire for someone (the random splash of flavour) |
| `upset` | beat a much higher-status opponent |
| `burial` | lost to a much lower-status opponent |
| `overexposure` | the act has gone stale from too many appearances |
| `slump` | sustained decline from a run of underwhelming nights |
| `status_rise` / `status_fall` | earned status (`starPower`) crossed a threshold — e.g. after a title change or PLE main event |

Whenever a moment fires — or an ordinary movement crosses a notability threshold — the tick emits a **`popularity_changed`** event. Its `summary` states the qualitative reason as fact ("the crowd erupted for a midcard act no one had booked to get over"), and its `data.reason` carries one of the tokens above plus a `direction` (`rise` | `fall`), so the narrative engine, dirt sheet, and personal feeds can explain *why* a wrestler is rising or falling — not merely *that* they are. Routine drift stays out of the log to keep it meaningful. Players never see the underlying numbers (§10 measures are internal; see spec §8) — only the narrated moment and a rising / steady / falling indicator.

### 10.4 Influence on the GM

Popularity strongly influences GM decisions — booking position, storyline attention, title opportunities, match placement, protection from losses, and investment in presentation — but influences without fully determining. The GM may still favour reliable workers, wrestlers who fit current plans, politically influential veterans, characters suited to a specific story, or wrestlers with strong long-term potential.

### 10.5 Roster roles: status vs usage

`starPower` says how big a star a wrestler *is*; it says nothing about how often the promotion *uses* them. Those are independent axes — a full-time champion and a semi-retired legend can share a `starPower` of 92 yet must be booked in opposite rhythms. Usage cannot be derived from status (the GM would then book its biggest stars the *most*, the reverse of the legend treatment), so it is an **authored** input: a `role` on each wrestler.

| | Rare usage | Frequent usage |
| --- | --- | --- |
| **High status** | `legend` / `part_timer` | `regular` main-eventer |
| **Low status** | — | `regular` undercard / `prospect` |

The four normative `role` tokens and their booking treatment:

* **`legend`** — rare appearances, marquee only, no titles. Booked only when attached to a story or a major-event slot.
* **`part_timer`** — semi-regular, story-gated, title-eligible; every appearance carries story meaning.
* **`regular`** — the default; booked as the card needs.
* **`prospect`** — protected, lower-card build; the GM invests wins to grow their `starPower`.

Each role's numeric parameters (ideal appearance cadence, scarcity and overexposure sensitivity, whether absence erodes relevance, story-gating, title eligibility) are **scenario-tunable config**, not hard-coded — see the scenario data spec and `packages/contracts` config.

**Scarcity and overexposure are one axis.** An appearance's crowd value peaks at the role's ideal cadence. Appear *rarer* than that and the appearance becomes an event (a scarcity bonus, scaled by `starPower` — a rare legend is monumental, a rare undercard act is merely absent); appear *more often* and overexposure dulls the reaction (steeply for a legend, barely for a regular). This is the same knob read from both ends.

**Absence.** Time off never lowers `starPower`, and a short absence (within a grace window) never lowers anything — an established act's stock does not fall because they took a few weeks off. Absence only lets `momentum` (heat) decay toward neutral; a `legend`/`part_timer`/`prospect` returns with that heat regenerated by scarcity. The single exception is the `regular`: a *prolonged* absence beyond the grace window mildly cools their current standing (`generalPopularity` drifts down toward a floored `starPower − relevancePenalty`, bounded and never toward zero), reflecting a working act the crowd slowly moves on from. Their `starPower` survives, so they climb back on return. **All meaningful falls are active** — overexposure, burials, losing streaks, depushes, lost titles — never the passive product of neglect.

**The rub.** A `legend`/`part_timer` sits at the popularity ceiling and cannot meaningfully gain; their mechanical purpose is to *elevate others*. Beating (or credibly working) one grants the lesser act a large surprise `edge` and a durable `starPower` step. Booking a legend into a meaningless match wastes that rub and risks overexposure for near-zero return — which is why their appearances must have meaning.

---

## 11. General manager

The GM is an autonomous character and booking authority.

The GM considers:

* Crowd response
* Popularity and momentum
* Match quality
* Reliability
* Relationships
* Current storylines
* Promotion needs
* Personal preferences
* Long-term creative goals

Possible GM objectives:

* Create a new main-event wrestler
* Strengthen the tag division
* Rebuild a damaged championship
* Capitalise on an unexpectedly popular wrestler
* Cool down an overexposed act
* Prepare the next major event

Players can influence the GM but cannot directly control booking. Repeating the same ask or pitch within a short window erodes the GM's patience and trust (spec §4.2).

The GM books to the calendar: TV shows build stories and test acts; PLEs pay off peaking feuds. It books **around programs — the active feuds — ranked by heat**, not around the belts. Each card is assembled from the hottest programs, and the **hottest program closes the show**: usually a title match, because a title raises a program's stakes, but a white-hot grudge feud can main-event over a lukewarm title defence. **Title defences are earned, not automatic** — a belt is staked when its program is hot or a challenger has been built, with a staleness clock so a champion cannot coast undefended forever; a PLE does not mechanically put every title on the line. World-title matches still concentrate on PLEs. A wrestler's card position (main event, upper card, midcard, opener) reflects and shapes their standing, and a feud may run across several shows — a rematch or a rubber match with rising stakes is booking, not repetition.

---

## 12. Relationships and politics

Relationships track several distinct ideas:

* Personal affinity
* Professional respect
* Trust
* Rivalry
* Resentment
* Influence

Relationships unlock or restrict actions.

Examples:

* Proposing a coordinated storyline
* Forming a team
* Asking someone to help elevate you
* Gaining backstage support
* Blocking another wrestler's pitch
* Leaking information
* Betraying an ally

Player-to-player interaction should usually happen through structured actions rather than unrestricted chat being required for gameplay. Human-to-human proposals follow the deadline and expiry rules in spec §3.3.

---

## 13. Stories and feuds

Stories are structured simulation state, not prewritten scripts.

Each story tracks:

* Participants
* Central tension
* Stakes
* Audience interest
* Momentum
* Creative coherence
* Relationship changes
* Unresolved developments

Example tension:

> A popular newcomer is gaining support while an established veteran tries to protect their position.

The simulation may create developments such as:

* An upset victory
* A dismissive promo
* A reluctant alliance
* A failed interference
* Crowd support shifting
* The GM changing direction

Players can influence stories through pitches, cooperation, resistance and political actions.

---

## 14. Match simulation

Matches are resolved at a high level.

Each match produces:

* Winner
* Individual performance
* Match quality
* Crowd response
* Story advancement
* Character credibility
* Opponent chemistry
* Physical cost
* GM reaction
* Backstage reaction

Winning is valuable, but it is not always the best outcome.

A wrestler may lose while:

* Becoming more popular
* Impressing the GM
* Elevating a story
* Strengthening their character
* Creating demand for a rematch

Before a match, players may set a broad intent such as `protect_character` or `advance_story`. The canonical match- and segment-intent vocabulary, the resolution inputs, and the conflicting-intent rule are defined in spec §6 and are not restated here.

---

## 15. Story and narrative engine

The narrative system has three layers.

### Simulation

Produces authoritative game events.

### Dramatic director

Finds unresolved tensions and selects plausible story opportunities.

Examples:

* A popular wrestler is underused.
* A feud is becoming repetitive.
* The champion lacks a challenger.
* Two allies want the same opportunity.
* The crowd is rejecting the GM's plan.

### LLM narrative layer

Turns structured events into:

* Personal summaries
* GM messages
* Rival responses
* Promos
* Match recaps
* Dirt-sheet articles
* Rumours

The LLM cannot alter game state.

---

## 16. LLM integration

The simulation creates structured JSON narrative jobs.

Example:

```json
{
  "jobType": "show_recap",
  "facts": [
    "Wrestler A defeated Wrestler B",
    "Wrestler B received the louder crowd reaction",
    "The rivalry gained audience interest"
  ],
  "characters": [
    {
      "id": "wrestler-a",
      "voice": ["arrogant", "controlled"]
    }
  ],
  "constraints": {
    "maxWords": 120,
    "inventFacts": false
  }
}
```

The narrative provider sends the job to the configured model.

The model returns validated JSON:

```json
{
  "headline": "Victory Does Not Silence the Crowd",
  "body": "Wrestler A won the match, but the audience clearly left talking about Wrestler B.",
  "mentionedCharacterIds": [
    "wrestler-a",
    "wrestler-b"
  ]
}
```

Supported providers may include:

* Ollama
* Hosted commercial LLM
* Template generator
* Mock provider for testing

The provider can be changed without modifying the simulation.

---

## 17. Dirt sheet

The promotion dirt sheet is the main shared view of the world.

It contains:

* Show results
* Crowd reactions
* Match reports
* Story developments
* Rumours
* Injuries
* Rankings
* Creative speculation
* Upcoming show previews

Not all information must be completely reliable.

The dirt sheet should encourage players to discuss and interpret events rather than merely expose numbers.

What the player *reliably* knows — and how internal state is projected into qualitative, player-facing form — is defined in spec §8 (information model). The dirt sheet is deliberately the unreliable layer on top of it.

---

## 18. Interface direction

The interface should be simple, mobile-first and clearly game-like.

Use:

* Strong typography
* Compact game panels
* Clear status bars
* Character portraits or simple visual identities
* Focused screens
* Small animations for important developments
* Bottom navigation or similarly accessible mobile controls

Avoid:

* SaaS dashboards
* Business analytics styling
* Excessive tables
* Overuse of generic floating cards
* Heavy newspaper theming
* Interfaces that appear generated rather than art-directed
* Exposing raw simulation numbers (see spec §8 — qualitative projections only)

Primary screens:

* Home
* Career
* Stories
* Promotion
* Dirt Sheet

Most normal sessions should require only a few taps.

The first-session / onboarding experience is defined in spec §9.

---

## 19. Technical direction

### Client

* SvelteKit
* TypeScript
* Mobile-first browser application
* PWA support later

### Backend

* TypeScript application services
* PostgreSQL through Supabase
* Authentication
* Scheduled or manually triggered simulation ticks
* Persistent narrative job queue

### Simulation

* Framework-independent TypeScript domain package
* Deterministic where practical
* Event-driven
* Independent from the UI and LLM provider

### Narrative

* JSON request and response contracts
* Generic narrative provider interface
* Validation before storage
* Retry support
* Template fallback

---

## 20. Expansion path

### Prototype

* One shared promotion
* Small number of human players
* 20–40 AI wrestlers
* Manually triggered ticks
* Local Ollama narrative provider

### Early online version

* Automated scheduled ticks
* More players
* Persistent shared dirt sheet
* Improved AI wrestler behaviour
* Background narrative processing

### Later expansion

* Multiple promotions
* Contracts
* Free agency
* Drafts
* Promotion competition
* Regional dirt sheets
* Larger shared wrestling ecosystem

---

## 21. Core validation question

The prototype succeeds when players can describe distinct careers and shared events such as:

> “The GM kept pushing another wrestler, but the crowd gradually moved behind me. I convinced my rival to extend our feud, changed the tone of my character and eventually forced the GM to alter the title plans.”

It fails if careers are mainly described as:

> “I trained my stats until my popularity was high enough to become champion.”

At world level, this question is operationalized by [six-month-slice.md](six-month-slice.md): a headless six-month run must produce feuds that arc, titles that mean something, and acts that rise *and* fall — measured by criteria SL-1…SL-10.

---

## 22. Data-driven scenarios

All world content — promotion identity, roster, titles, show calendar, seed relationships and feuds, cadence config — lives in per-scenario data files that can be replaced for every game. The simulation is scenario-agnostic: no wrestler, title, or show name appears in sim code.

Formats are specified in [scenario-data-spec.md](scenario-data-spec.md) and validated by `packages/contracts`. The default scenario is `wwe-2026`: a direct remodel of WWE as of early 2026 (single brand, ~40 real wrestlers, World Heavyweight + Intercontinental Championships, weekly Raw + a real PLE calendar).

---

## 23. MVP target: the six-month slice

The MVP is judged on whether the simulation alone produces an interesting, wrestling-logical six-month slice of the default scenario — before narrative polish and before UI. The full target, including its measurable validation criteria and required mechanics, is [six-month-slice.md](six-month-slice.md). Simulation tuning against that spec (PLAN Phase 3.7) gates all UI work.
