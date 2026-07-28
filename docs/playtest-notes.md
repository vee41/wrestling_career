# Phase 3 Playtest Notes

Written at the Phase 3 gate (PLAN.md, "⚠ Gate"), after the CLI harness landed
and a tuning pass closed the Phase 2 gaps PLAN.md called out. Evaluates the
sim against [GDD.md §21](GDD.md) (the core validation question) and the
[decision-loop spec](player-decision-loop-spec.md)'s design rules DL-1…DL-7.

## Method

Five headless seasons were run directly against `packages/sim`'s `runTick`
(no CLI parsing involved, since the CLI is a thin shell over the same
function) using a disposable script, since deleted:

| Season | Wrestlers | Humans | Weeks | Notes |
| --- | --- | --- | --- | --- |
| A | 30 | 0 | 12 | Baseline, all-AI |
| B | 30 | 1 | 12 | One human who never submits a turn (absence test) |
| C | 30 | 0 | 12 | One AI-controlled wrestler forced to `train_skill` (same skill) every tick, nothing else — the "train stats only" strategy |
| D | 30 | 6 | 24 | Six absent humans, doubled length, to surface rarer reactive-decision types |
| E | 30 | 0 | 12 | Different seed, replicating A |

A week is 3 ticks (2 decision + 1 show, PLAN.md default); all runs used a
fixed seed per PLAN.md's "same state + same actions + same seed = same
result" guarantee, so every number below is reproducible.

## Does "train stats → champion" fail as a strategy? (GDD §21, DL-3)

Season C's forced trainer (`w0`) trained `ringPerformance` on repeat for all
36 ticks, never recovering, never interacting, never promoting a match,
never setting an intent. Result:

- Skill average rose only 52.5 → 58 despite training *every single tick* —
  all 30 of their training actions were flagged `plateaued: true` (the spec
  §4.2 diminishing-returns mechanism, resolve-actions.ts's
  `trainingRepeatCount`/plateau multiplier).
- They finished **27th of 30** in popularity (23, barely into the "cult"
  band) and were **not** the champion.
- Every other wrestler in the same season, by contrast, mixed training with
  recovery, promotion, interactions, and match intents — and the eventual
  champion (`w27`) was not a particularly high-skill outlier, but a
  reasonably popular wrestler who kept getting story opportunities.

This directly contradicts the GDD §21 failure case ("I trained my stats
until my popularity was high enough to become champion") — training alone
neither builds popularity fast enough nor substitutes for the story/GM/crowd
loop that actually drives standing. **DL-3 holds**: every action has an
opportunity cost (time not spent on recovery, interactions, or promotion),
and repetition has clearly diminishing returns.

## Do careers diverge, and do stories avoid revolving around one wrestler? (GDD §21, DL-1, DL-2)

Across seasons A/B/C/D/E, **every wrestler in the roster (30 of 30) ended up
a participant in at least one story** — the dramatic director
(`director.ts`'s `scanForNewStory`) actively seeks out underused wrestlers
each tick rather than compounding attention on whoever's already popular.
Story counts ranged 37–67 per season (more in D's 24-week run, as expected),
with roughly two-thirds resolving naturally and the rest still active at
cutoff.

A meaningful fraction of stories were caused by *player-initiated* GM
pitches, not just the director: 5–11 stories per season (about a
quarter of the total) trace back to an accepted `pitch_feud` interaction
naming a subject wrestler (tuning gap #4 below) — i.e., asking the GM for a
specific feud reliably makes that feud exist, which is the mechanism DL-1's
"proactive choices are scarce but meaningful" depends on.

Career divergence shows up clearly in Season D's six absent humans over 24
weeks, despite all six running the *identical* stance-fallback code path
(DL-7) with only their starting roll differing:

| Wrestler | Start popularity | End popularity | End money | End condition |
| --- | --- | --- | --- | --- |
| w0 | 44 | 60 | 358 | 46 |
| w1 | 50 | **93** | 186 | 44 |
| w2 | 22 | 67 | 214 | 49 |
| w3 | 49 | 47 | 156 | 67 |
| w4 | 26 | 50 | 116 | 89 |
| w5 | 29 | 69 | 168 | 47 |

`w1` rode momentum from stories and matches to near-superstar popularity
(93) while nominally "unplayed"; `w3` barely moved. Titles changed hands
2–11 times per season and popularity rankings never matched their starting
order (`rankingShuffled: true` in every run) — careers are not on rails.

## Does an absent player survive a season intact? (DL-7)

Season B's single absent human (never submits a turn, ever) received the
same fallback path as any AI wrestler (`decideFallbackTurn`, no special
case — PLAN.md Phase 2 step 2 / DL-7): 14 reactive decisions generated for
them over the season, 13 answered through fallback (1 expired gracefully,
penalized per spec §3.3/§5, not catastrophically). They ended the season
with positive money (127, down from 777 — see the note on the economy
below), healthy condition (85), and unchanged-but-stable popularity (27).
Season D's six absent humans similarly all finished the season alive,
booked, and with a range of outcomes rather than a uniform "did nothing,
went nowhere" result. **DL-7 holds**: missing every decision period does not
end or freeze a career.

One real tuning observation, not a DL-7 violation: absent wrestlers'
`money` trended down across all of Season D's six (e.g. 1364 → 116,
1421 → 168) — the fallback AI invests in quality upgrades whenever cash
clears its stance-scaled reserve (`ai/decide.ts`), and nothing currently
pulls it back up besides appearance pay. Nobody went bankrupt or hit a
failure state (there isn't one tied to money), but this is worth watching
in the Phase 6 hardening pass if money-driven decisions get added later.

## An example career (GDD §21 format)

From Season D: *w1 started as an unremarkable mid-carder (popularity 50,
no active stories). Over 24 weeks — without a single turn ever submitted
for them — the director pulled them into two stories as the dramatic
director kept surfacing underused wrestlers, the GM's booking algorithm
noticed their rising momentum and gave them bigger matches (`gm.ts`'s
`bookingScore` now also rewards a good in-ring track record, tuning gap
#3), and by the season's end they were pushing 93 popularity, one story
away from a title shot — entirely through the simulation's own logic, not
scripted content.* This is the GDD §21 target shape (a describable, causal
arc), not the "trained stats until champion" failure shape — achieved here
even for a wrestler nobody was actively playing.

## Other design rules

- **DL-4 (failure remains playable):** rejected GM pitches, countered
  proposals, and lost matches all continued to generate events, stories,
  and further opportunities in every season — nothing observed dead-ended a
  wrestler's participation in the sim.
- **DL-5 (context controls availability):** out of scope to verify from
  event logs alone — this is primarily a UI-layer rule (spec §3.5) that
  Phase 5 will need to honor when it decides which 3–5 intents to surface;
  the sim itself doesn't restrict availability beyond the relationship
  gates in `gates.ts`.
- **DL-6 (simulation remains authoritative):** trivially holds — Phase 4
  (the LLM narrative layer) doesn't exist yet, so nothing but `runTick` has
  ever touched game state.

## Tuning pass applied at this gate

PLAN.md's Phase 3 section called out four required gaps and three minor
items, found in Phase 2 review. All were closed as part of this phase
(see `packages/sim` for the diffs; each carries an inline comment citing
"tuning gap #N"):

1. **Dead reactive types.** `injury_decision` now triggers on low condition
   (< 35); `finish_changed` now triggers on a story-linked booking; a
   strain threshold crossing (condition < 25 post-match) now emits an
   `injury` event. Confirmed organically in Season D (3 injuries, 3
   injury_decisions, 11 finish_changed) as well as via targeted unit tests
   (`director.test.ts`, `match.test.ts`).
2. **Heel/face turns unreachable for aligned wrestlers.** `turn_proposal`
   is now gated on an alignment/heat contradiction (a face whose negative
   heat has overtaken positive, or the heel mirror) instead of
   `alignment === "tweener"` only — the spec §10 flagship example (GM turns
   a face heel) can now actually occur. Confirmed in Season D (2
   turn_proposals) and via `director.test.ts`.
3. **GM reaction never consumed.** `gmReactionDelta`/`backstageReactionDelta`
   from recent matches (windowed the same way `patience.ts` windows
   interaction repeats) now feed both `gmAcceptanceProbability`
   (interactions.ts) and `bookingScore` (gm.ts) — refusing GM asks or going
   off-script now has a lasting GM-side cost, and being a good soldier now
   pays off in booking odds.
4. **Accepted GM pitches had no material effect.** `pitch_feud` toward the
   GM can now optionally name a `subjectWrestlerId` (contracts'
   `interaction.ts`); an accepted pitch seeds or boosts a real story
   between proposer and subject. An accepted `request_opportunity` now
   gets a materially bigger momentum bump than a generic accepted ask,
   feeding directly into next-show `bookingScore`. Confirmed organically
   (5–11 GM-pitched stories per season) and via `interactions.test.ts`.

Minor items, also addressed:

- Fatigue now dampens crowd reaction (`popularity.ts`'s overexposure
  penalty), per GDD §10.
- `world.events` no longer grows unboundedly: the two high-volume,
  short-lived event types the patience/plateau windows actually scan
  (`interaction_resolved`, `action_performed`) are pruned once they age out
  of every window that reads them; everything else (title changes,
  stories, injuries, ...) remains a permanent record.
- Countering a proposal now spins up a real counter-proposal (roles
  reversed, payload carried over) instead of just closing the original
  with no reply path.

## Verdict

The gate passes: careers diverge, stories spread across the whole roster,
"train stats only" is a losing strategy, and an absent player survives a
season intact. Phase 2's weights did not need further adjustment beyond the
four required + three minor tuning items above. Proceeding to Phase 4.

## Phase 3.7 slice tuning (SL-1...SL-10)

The Phase 3.7 gate was run with the default `wwe-2026` scenario, zero humans,
26 weeks, and fixed seeds `slice-wwe-2026-1` through `slice-wwe-2026-3`.
The reproducible harness is `slice --scenario wwe-2026 --seeds 3`; the same
three runs are locked into `packages/sim/src/slice.test.ts`.

All MUST criteria (SL-1 through SL-9) passed on every seed. The cross-seed
SHOULD, SL-10, also passed: the three runs produced three different final #1
popularity acts. Across the seed set, 18--21 wrestlers rose by at least 15
points (SL-1), 11--13 fell by at least 10 (SL-2), and 37--40 of 44 had a
non-monotonic weekly trajectory (SL-3). The world title changed hands 0 times
and was defended six times per run, entirely at PLEs (SL-4); the IC title
changed once with five or six defenses, and its holder/ex-holder subsequently
entered a world-title match (SL-5). Each run started 26 stories, resolved
20--21 at PLE blowoffs, and had a 5--7-week median resolved lifespan (SL-6).

### Tuning changes and observed effects

4. **Anchored surprise popularity (SL-1, SL-2, SL-3, SL-7, SL-10).** Phase
   3.7.1 replaces the old performance-target ratchet with GDD §10's earned
   `starPower` anchor, five-segment expectations, upset/loss edge, and capped
   momentum push. The initial 0.15 push rounded away at the weekly integer
   cadence, so the first slice-tuning values are a 4.00 momentum push, 0.08
   anchor gravity, an 18% crowd-ignition rate per
   appearance rather than the illustrative 4%; the surprise signal uses a
   0.65 contribution to momentum and routine losses carry a -8 edge. The idle
   anchor settle is 0.01 rather than the initial 0.03, so it cannot erase a
   capped show-night movement before the act is booked again. These are
   deliberately open tuning constants; the rerun below records their effect.

   The three fixed `wwe-2026` seeds now pass every MUST and all within-seed
   SHOULD clauses: rises were 13/14/13 (SL-1), falls 6/8/8 (SL-2), and weekly
   trajectories spanning 16+ points 30/44, 37/44, and 37/44 (SL-3). Card
   mobility and cross-seed variety remained healthy: SL-7 passed on all runs,
   and SL-10 produced two distinct final #1 acts. This is a structural
   improvement over the pre-fix flat trajectories rather than a return to the
   former skill-target ratchet.

1. **Story cadence and endings (SL-6).** AI wrestlers no longer auto-pitch a
   feud whenever unpaired; the director starts at most one organic story per
   weekly show. Cooling stories are held for a PLE resolution rather than
   evaporating mid-week. This reduced the previous flood of 100+ starts and
   raised PLE resolutions from 51% to 100% in the fixed-seed validation.
2. **Title rhythm and card hierarchy (SL-4, SL-5, SL-7).** World-title
   defenses protect the incumbent and cap changes at two; the midcard title
   receives one guaranteed late-slice transition. PLE booking now prevents one
   match from claiming two belts or duplicating a belt defense, rotates prior
   world-title challengers out, and gives former midcard champions a measured
   world-scene bonus. The result was six PLE world defenses, 7 distinct PLE
   main-event wrestlers in every run, and no title hot-potatoing.
3. **Roster rotation and returns (SL-8, SL-9).** Non-story card slots now
   strongly prioritize wrestlers below three appearances, while a recovered
   wrestler receives priority for their first return booking. Every wrestler
   reached at least three matches, no one worked every show, and every seed
   produced an injury absence followed by a return.

### Qualitative read-through

Seed `slice-wwe-2026-1` reads as a coherent promotion rather than a flat
stats race. CM Punk anchored the world-title PLE main events against a changing
set of challengers while Finn Balor's long program with Dominik Mysterio paid
off in Balor taking the IC title at week 16, then defending it at the next two
PLEs. That is a clear rise story: Balor moved from the seeded Priest fallout
into a championship program and then the world-title conversation. The fall
story is LA Knight: his early relevance gave way to a long slide through the
Sami Zayn program, with the weekly popularity trajectory finishing materially
below where it began. The feuds build on TV, resolve at PLEs, and their results
change later card placement; titles feel like anchors rather than random
match modifiers. **The Phase 3.7 qualitative gate passes.**

## Phase 3.7.2 booking realism (SL-1, SL-2, SL-3, SL-9, SL-10)

The follow-up 26-week gate used the same three fixed `wwe-2026` seeds after
adding tiered rest and TV undercard multi-way matches. All MUST criteria and
SL-10 passed. The runs produced 9/8/6 rises for SL-1, 6/10/7 falls for
SL-2, and 18/20/20 of 44 careers with a 16-point weekly range for SL-3;
the 18-act first run clears SL-3's 40% threshold exactly. SL-9 still passed
in every run, so combining several undercard wrestlers into one match did not
create an every-show act or strand the lower card.

The rotation tuning keeps the rest rule restricted to unattached wrestlers;
story and title programs remain exempt. The default scenario uses an 85-popularity
rest tier, which still paces the clear top acts while preserving enough ordinary
appearances for the slice's rise/fall requirements. To offset that lower
appearance frequency while retaining a bounded movement model, its
scenario-owned popularity cap is 4 and crowd-ignition chance is 42%; both are
explicit tuning values, not new systems. Triple threats and fatal four-ways
remain TV undercard-only, capped at four participants.

## Phase 3.7.3 roster roles (SL-1, SL-2, SL-3, SL-7, SL-9)

The three fixed 26-week `wwe-2026` seeds pass every MUST criterion and SL-10
after separating roster status from authored usage. SL-1 recorded 9/7/6 rises,
SL-2 recorded 5/7/6 falls, and SL-3 recorded 20/18/19 of 44 acts with a
16-point weekly range. SL-7 produced seven distinct PLE main-eventers in each
run, including an act from outside the initial top five.

SL-9 held at a three-match floor in every run, with no act working every show.
The rare roles are assigned to meaningful programs (a `legend` and a
`part_timer`), while prospects remain available for the undercard and may only
challenge for the midcard title. A PLE story involving a world champion and an
ineligible prospect now defers to the title-defense reservation, so role-based
eligibility cannot strand a world championship defense. Unit coverage confirms
that rare returns gain scarcity, immediate repeats incur overexposure, regular
absence asymptotes at its bounded relevance anchor, and a win over a rare act
awards durable status rather than passive absence decay.
