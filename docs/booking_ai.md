# Booking AI Vision and Architecture

## 1. Purpose and authority

This document defines the intended architecture and product vision for the autonomous booking system. It is written for AI agents designing, implementing, testing, or reviewing the simulation.

The booking AI is the creative core of the game. Its job is not merely to choose wrestlers for matches. It must create understandable promises, develop them across weekly television, pay them off at major events, and adapt when the simulated world or the players disrupt the plan.

This document owns booking-AI architecture and design intent. [PLAN.md](PLAN.md) owns implementation order, [GDD.md](GDD.md) owns the broader game vision, [player-decision-loop-spec.md](player-decision-loop-spec.md) owns player-choice vocabulary, and `packages/contracts` remains machine canon for implemented tokens and persisted data. Examples in this document are illustrative until their schemas land in contracts.

If the current implementation conflicts with this direction, agents may redesign it. Preserve useful deterministic simulation behavior, but do not preserve an implementation detail merely because it already exists.

## 2. North-star experience

After several simulated weeks, a player should be able to explain the promotion in wrestling terms:

> The champion dismissed a rising challenger, the challenger earned a title match, the champion escaped through interference, and the rematch became the next PLE main event. Meanwhile, a veteran's attempt to elevate a prospect turned into resentment after the prospect upstaged them.

The explanation should not be:

> The two highest-scoring available wrestlers were repeatedly matched until their story meter crossed a threshold.

The system succeeds when:

- cards resemble authored wrestling shows rather than sorted lists of matches;
- important programs have premises, progression, escalation, and payoffs;
- wrestlers do not need to wrestle their primary rival every week to advance a feud;
- booking has direction but can change in response to injuries, crowd reactions, player behavior, politics, and unexpected performances;
- player choices alter opportunities and creative direction without granting direct control of the card;
- the same seed and inputs reproduce the same plan, card, and result;
- every important booking decision can be inspected and explained.

## 3. Preserve the simulation; add creative intent

The existing engine already provides valuable world facts: popularity, momentum, heat, skills, condition, roles, relationships, title state, match execution, player intents, and event history. These should remain inputs to booking and consequences of execution.

The missing layer is durable creative intent. A hot story meter says how the audience currently feels. It does not say why the program exists, what it promises, what should happen next, or where it is intended to end.

The target system separates four concepts:

1. **World state** records authoritative facts and consequences.
2. **Program plans** record the GM's private medium-term creative intent.
3. **Cards and beats** commit part of that intent to a particular show.
4. **Narrative output** presents resolved facts without changing them.

The LLM is not the authoritative booker. The MVP planner is deterministic, schema-driven, and inspectable. A later LLM may suggest plan candidates or render prose, but all accepted plans and consequences must pass through deterministic simulation rules.

## 4. Target architecture

```text
World facts + player turns + promotion calendar
                     |
                     v
              Creative planner
       program portfolio and 4-week plans
                     |
                     v
                Beat selector
        required/eligible beats this week
                     |
                     v
               Card composer
 hard constraints, show rhythm, scoring, audit trace
                     |
                     v
          Match and segment resolution
        planned outcome vs actual execution
                     |
                     v
       Events, crowd response, injury, politics
                     |
                     v
                 Replanner
     continue, accelerate, extend, pivot, abandon
                     |
                     v
              Narrative renderer
```

Planning and card commitment use different horizons. The GM may hold a provisional four-week plan while only finalizing the next show early enough for players to submit intents and responses. Future beats are promises and reservations, not immutable cards.

### Tick integration and information boundaries

Player influence must reach creative before the affected future card is committed. On a decision tick, resolve relevant interactions, proposals, and reactive responses before updating plans and composing a newly due card. Match/segment intents still apply to an already committed show. On a show tick, resolve the committed card, apply authoritative consequences, and then let the planner revise later provisional beats. If implementation changes the canonical tick sequence, update GDD §4 in the same change.

Program plans are private GM knowledge. Players may see a committed booking, an explicit GM promise, or an in-world hint; they must not receive unrevealed future finishes or the planner's raw scores through ordinary projections.

## 5. Program plan model

A `ProgramPlan` is private GM state that gives an active story direction. It should minimally represent:

- stable program id and linked public story id;
- participants and their creative roles, such as protagonist, antagonist, or supporting participant;
- premise and stakes;
- creative objective, such as elevate an act, establish a challenger, retain a championship, change a title, turn a character, redeem an act, or settle a grudge;
- priority or card tier;
- start tick, mandatory target payoff tick, and an optional target show id once that show has been committed;
- intended payoff and protected participants;
- current escalation level;
- planned beat skeleton and completed beat history;
- direct-match cooldown and repetition budget;
- status: proposed, active, payoff-ready, resolved, or abandoned;
- revision history with structured reasons.

Public `Story` state and private `ProgramPlan` state must not be collapsed into the same concept:

- `Story` answers: what has happened, how coherent it feels, and how interested the audience is.
- `ProgramPlan` answers: what the GM currently wants to accomplish and how creative intends to get there.

A plan is allowed to fail. The plan history must remain visible to debugging tools even if the GM pivots or abandons it.

## 6. Beats

A beat is the smallest planned unit of creative progression. A beat is not prose. It is a structured intent that the show can schedule and the simulation can resolve.

Phase 3.8 already provides the generic execution primitive: discriminated match/segment card slots, solo or multi-participant segments, segment intents, dominance, heat/story/popularity effects, appearance cadence, AI/CLI intent wiring, and unified show-card reporting. Do not rebuild those systems. The missing layer is semantic intent: the existing `SegmentSlot` says that a non-match segment occurs, but not whether it is a promo, confrontation, attack, save, interference, or go-home angle. `PlannedBeat` owns that meaning and links the generic slot/result back to a program.

The first implementation should use a deliberately small catalog built on Phase 3.8's match and segment slots:

- promo or interview;
- confrontation;
- attack, save, or interference angle;
- showcase or contender-building match;
- direct rivalry match;
- go-home angle;
- PLE payoff.

Each beat needs:

- a type and linked program;
- required and optional participants;
- an eligible scheduling window;
- preconditions;
- intended story effect;
- escalation level;
- whether it spends a direct matchup;
- whether it requires a match, a segment, or either;
- status: provisional, scheduled, resolved, skipped, or invalidated;
- result references after execution.

Beat selection follows a wrestling cadence rather than repeating the hottest available match. A simple four-week skeleton might be:

1. establish the conflict;
2. demonstrate or complicate it without a direct match;
3. escalate through interference, a protected result, or a consequential choice;
4. deliver a go-home beat and PLE payoff.

This is a pattern, not a mandatory script. Different program archetypes may provide different eligible beat sequences, and world events may cause replanning.

## 7. Planned outcomes and actual execution

For important matches and segments, the booker must choose an intended outcome. A wrestling booking engine that normally derives the winner or dominant speaker solely from performance is closer to a sports league than an authored wrestling promotion.

A minimal planned finish records:

- intended winner;
- finish family, initially clean, dirty, interference, disqualification, or no contest;
- participants who should be protected;
- intended title consequence;
- intended story consequence;
- creative importance or adherence strength.

A minimal planned segment outcome records:

- intended focal or dominant participant;
- intended positive/negative heat direction;
- intended story effect;
- protected participants;
- execution risk or adherence strength.

Match resolution should normally honor the planned finish. Skills, chemistry, condition, player intent, and conflict determine how well the wrestlers execute it: match quality, crowd response, credibility, physical cost, backstage reaction, and story advancement.

Segment resolution follows the same principle. The planned beat supplies the intended focus and effect; promo/character skill, dominance, participant intent, and conflict determine how well it lands. The Phase 3.8 intent-to-heat mapping remains useful execution logic, but must not silently replace the beat's creative purpose.

Deviation is exceptional and creates a world event. Valid causes include injury, refusal, dominant conflicting intent, failed interference, or another explicit simulated disruption. The result records both the plan and the actual outcome so the replanner and audit tools can explain the difference.

Hard-coded title change timing and unexplained random title changes should be removed as planned finishes become authoritative. Title policy belongs in the creative planner; execution risk belongs in match resolution.

## 8. Creative planner

The creative planner operates on a portfolio of programs rather than generating each match independently.

At the start of a planning cycle, and whenever a material disruption occurs, it should:

1. derive story catalysts from world facts;
2. generate program candidates;
3. score candidates against current promotion objectives;
4. select a limited portfolio subject to roster and title constraints;
5. assign a target payoff and provisional beat skeleton;
6. reserve scarce resources such as champions, rare-role appearances, and PLE slots;
7. retain an audit record of selected and rejected candidates.

Candidate scoring may consider:

- current story heat and participant popularity;
- objective fit;
- alignment and relationship fit;
- title relevance;
- freshness and prior pairing history;
- star-creation potential;
- player pitches and promises;
- wrestler condition and availability;
- role cadence and overexposure;
- competition with existing programs for the same wrestlers or payoff slots.

Hard constraints must not be approximated by score weights. Availability, duplicate use, incompatible title eligibility, and required payoff capacity are validity rules. Scoring ranks only valid alternatives.

The first planner should be a deterministic candidate generator plus greedy portfolio selector. Do not introduce an LLM planner, machine learning, or a general optimization framework before evidence shows that the simpler planner cannot satisfy the slice.

## 9. Replanning

Plans are durable but not rigid. Replanning is what turns simulation surprises into stories rather than bugs.

Material triggers include:

- injury or unavailable participant;
- player acceptance, refusal, negotiation, or political action;
- a planned finish deviation;
- crowd response materially contradicting the intended direction;
- an unexpected performance or popularity surge;
- a program becoming repetitive or losing coherence;
- a championship changing hands;
- a target PLE slot becoming unavailable.

For each trigger, the planner chooses and records one response:

- continue unchanged;
- substitute a participant or beat;
- accelerate the payoff;
- extend the program;
- pivot the intended outcome;
- cool down temporarily;
- abandon and resolve the plan.

Revision reason, previous intent, and new intent are permanent audit facts. Replanning must not silently rewrite history.

## 10. Weekly card composition

The weekly composer turns due program beats into a complete show.

The committed card order is authoritative, not cosmetic. Replace the Phase 3.8 split resolution pass (all matches, then all segments) with one ordered card resolver before beats are allowed to affect later slots on the same show. The initial creative slice should schedule at most one beat per program per show; story advancement must nevertheless aggregate multiple same-story results defensively rather than letting the last result overwrite earlier work.

Composition order:

1. reserve hard obligations: due PLE payoffs, title obligations, and already-promised player bookings;
2. place program beats whose scheduling windows are closing;
3. place other high-value program beats;
4. fill remaining space with contender-building, showcases, and roster rotation;
5. order the show for rhythm and card position;
6. emit an inspectable decision trace.

Initial hard constraints should cover:

- wrestler availability and condition floor;
- no accidental double booking;
- slot compatibility with match/segment beat type;
- title and role eligibility;
- direct-match cooldown;
- card capacity;
- reserved payoff capacity;
- rare-role appearance cadence.

The soft score should be small and explicit:

```text
program priority
+ beat urgency
+ heat
+ promotion-objective fit
+ freshness
+ card-shape contribution
- overexposure
- repeat-pairing penalty
- condition risk
```

Card ordering cannot be only a descending heat sort. It should preserve the hottest-program main-event principle while also producing a strong opener, match/segment variety, separation between repeated participants, and a sensible escalation toward the close.

Every booked and rejected candidate should expose its hard-constraint result and score components. Agents must be able to answer "why was this booked?" without reconstructing the decision from source code.

## 11. Recommended two-PLE slice

The first creative-booking target is an eight-week deterministic slice covering two four-week PLE cycles. It is a focused architecture and readability gate before returning to the full 26-week balance gate.

Scope:

- the existing single-brand scenario and two singles titles;
- three to five concurrently active programs;
- the Phase 3.8 match and segment model;
- the small beat catalog in this document;
- planned finishes for story and title matches;
- provisional four-week plans and one-show-ahead card commitment;
- the existing unified show-card report, extended with program/beat/plan information;
- no dependency on an LLM or web UI.

The slice must demonstrate:

- at least two PLE programs with multiple prior TV beats;
- at least one program advanced primarily through non-match beats;
- no weekly direct-match loop between the same primary rivals;
- at least one planned finish whose later beat depends on its outcome;
- at least one deterministic replan caused by a simulated disruption fixture;
- complete program timelines and booking traces;
- readable cards with a recognizable opener, supporting progression, and main event;
- deterministic replay from identical state, turns, and seed.

The slice is a development gate, not a replacement for the 26-week slice. Once it reads coherently, reconnect the planner to the existing 26-week harness, repair the SL gates so MUST failures fail tests, and tune career movement, roster coverage, titles, and program health together.

## 12. Balancing and observability

Booking cannot be balanced using popularity outcomes alone. The Balance Lab and headless reports should add:

- program timeline with planned, scheduled, resolved, skipped, and revised beats;
- selected and rejected candidate traces;
- planned-versus-actual finish comparison;
- same-seed configuration diff;
- batch simulation across many seeds;
- parameter sweeps and exportable tuning snapshots;
- enforced CI gates rather than advisory output only.

Raw segment count is a capacity/cadence check, not a storytelling-quality measure. Once the planner owns program beats, evaluate whether segments served a premise, advanced escalation, and contributed to a payoff. The Phase 3.8 `segmentChance` is transitional tuning for unplanned cards; it must not choose match-versus-segment for planned program beats.

Track at least:

- program completion and abandonment rate;
- median program duration;
- beats before payoff;
- PLE matches with sufficient prior build;
- direct rematch and consecutive-pairing frequency;
- share of story development from segments;
- escalation-order violations;
- plan revisions by cause;
- planned-finish adherence and deviation causes;
- main-event and challenger diversity;
- roster utilization by role;
- player action-to-visible-consequence delay;
- unresolved program backlog.

Statistical gates are necessary but not sufficient. Maintain curated golden scenarios for a new challenger, prospect elevation, non-title grudge main event, injury replan, and crowd-rejection pivot. Each scenario should assert both final facts and the important intermediate booking decisions.

## 13. MVP non-goals

Do not add these to the first creative-booking slice:

- unrestricted natural-language booking generation;
- an LLM with authority to mutate plans or world state;
- a general-purpose constraint solver;
- detailed match choreography;
- a large stipulation catalog;
- tag-team divisions, factions, second brands, or cross-promotion booking;
- full-season plans that cannot adapt;
- UI polish beyond the report needed to inspect the slice.

Prefer a small beat vocabulary with strong consequences over a broad vocabulary that produces interchangeable output.

## 15. Planned outcomes and execution deviation

The GM records an intended winner, `clean`/`dirty`/`interference`/`disqualification`/`no_contest` finish family, protected participants, `change`/`retain`/`none` title consequence, story effect, and `strict`/`standard`/`flexible` adherence strength for each story or title match. Planned segments likewise record a focal participant, `positive`/`negative`/`mixed`/`neutral` heat direction, story effect, protection, and adherence strength.

Results retain both planned and actual outcomes and are `adhered` unless an `injury`, `refusal`, `dominant_conflicting_intent`, or `failed_interference` causes a `deviated` execution. Every deviation is a material event and a program-revision input, never a silent creative substitution.

## 14. Implementation discipline

- Keep planner functions deterministic and scenario-agnostic.
- Pass seeded RNG explicitly; never use ambient randomness.
- Separate hard constraints from soft scoring.
- Store revision and decision traces as structured data, not log strings alone.
- Preserve one-show-ahead player intent windows even though plans span four weeks.
- Treat plan state as private GM knowledge unless a specific booking or event reveals it.
- Keep narrative generation downstream of authoritative resolution.
- Add configuration knobs only when a test or observed slice demonstrates a need.
- Every phase must include golden examples, invariants, and multi-week replay coverage proportional to its risk.
