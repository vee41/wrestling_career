# Wrestling Career Simulation — GDD v0.4

## Document map and precedence

| Document | Role |
| --- | --- |
| **This GDD** | Vision and simulation systems. Owns the canonical tick pipeline (§4). |
| [player-decision-loop-spec.md](player-decision-loop-spec.md) | **Authoritative for player-facing choice structure.** On conflict with §5–§6 here, the spec wins. Owns all choice vocabularies (intents, stances, actions, reactive types). |
| [PLAN.md](PLAN.md) | Execution order for the AI agent building the prototype. |
| `packages/contracts` | Machine canon for all tokens once PLAN Phase 1.5 lands. |

## 1. High concept

A mobile-first, browser-based multiplayer wrestling career simulation.

Each player controls one wrestler inside a shared promotion populated by human and AI wrestlers. Players shape their careers through performance, relationships, character choices and backstage decisions.

Matches and stories are resolved by a timed simulation. Players do not choose individual wrestling moves.

The core fantasy:

> Build a wrestling career inside a living promotion that does not revolve around you.

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

* One shared promotion
* A small number of human players
* Approximately 20–40 AI wrestlers
* One AI general manager
* Weekly shows
* Timed simulation ticks
* Matches, feuds and storylines
* Crowd response and popularity
* Relationships and backstage politics
* Wrestler development
* Lightweight gimmick control
* Promotion dirt sheet
* LLM-generated narrative flavour

During development, ticks can be triggered manually.

Not initially included:

* Multiple promotions
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
* **Show ticks** — one each in-game week, resolving the weekly show

Default week: 2 decision ticks + 1 show tick (configurable). Longer-term planning is evaluated over multiple weeks.

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

Crowd response is a central simulation system.

The crowd reacts to:

* Match performance
* Character clarity
* Story momentum
* Opponent chemistry
* Wins and losses
* Promos
* Repetition
* Surprise
* Perceived authenticity
* Promotion context

Crowd response should not be a single permanent score.

Useful measures may include:

* Current reaction
* General popularity
* Momentum
* Audience segment appeal
* Positive versus negative heat
* Fatigue or overexposure

Popularity strongly influences GM decisions, including:

* Booking position
* Storyline attention
* Title opportunities
* Match placement
* Protection from losses
* Investment in presentation

Popularity should influence decisions without fully determining them.

The GM may still favour:

* Reliable workers
* Wrestlers who fit current plans
* Politically influential veterans
* Characters suited to a specific story
* Wrestlers with strong long-term potential

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
