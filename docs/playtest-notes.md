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

## Phase 3.7.4 heat-ranked card builder (SL-4, SL-5, SL-7, SL-9)

PLE cards now rank active programs by heat rather than forcing the world title
into the main event. Championship stakes add heat (30 for world, 12 for
midcard), so title programs normally remain prominent while a hotter grudge can
close the card. The three fixed 26-week seeds remain green for SL-4, SL-5,
SL-7, and SL-9: title defenses stay PLE-led and clear their required counts,
while non-title programs can take the main event.

The default scenario uses a four-week title-defense staleness floor. Stale
belts reserve a viable challenger before other PLE programs consume the card;
champions are also kept out of a different title match when their own defense
is due. That preserves conditional defenses without allowing an unrelated
peaking story to strand a required title match. The card-ordering change made
weekly popularity movement slightly less volatile, so the scenario's existing
bounded `popularityMaxStep` was tuned from 4 to 6; SL-3 remains green across
the same seed set.

## Phase 3.7.5 earned-status popularity tether (SL-1, SL-2, SL-3, SL-7, SL-10)

The fixed three-seed, 26-week gate passes every MUST criterion and SL-10 after
adding `popularityBand: 12`. Positive momentum now flattens at
`min(100, starPower + popularityBand)` and gravity pulls a hot meter back to
its earned-status anchor. Sustained positive momentum no longer raises
`starPower`; titles, PLE main events, and rare-opponent rubs are the only
positive status routes.

The low-swing starting values in the execution plan made SL-1 and SL-3 fail,
so the final `wwe-2026` constants retain the proven movement cadence
(`popularityMaxStep` 6, momentum decay/memory/surprise/push 0.95/0.7/1/10,
and crowd ignition 0.42) behind the new bounded ceiling. Earned milestones
are more meaningful: PLE main events award 8 `starPower`, world-title wins
20, and midcard-title wins 16; a positive status gain immediately brings
general popularity up to that newly earned anchor, never into the extra
12-point hot-streak band.

The three runs recorded 3/4/5 rises for SL-1, 5/11/6 falls for SL-2, and
26/33/29 careers with a 16-point weekly range for SL-3. Their #1 acts were
three different title/main-event performers, satisfying SL-10. The tether
keeps ordinary hot streaks temporary while championship and major-show
outcomes create the limited, legible climbs required by the slice.

## Phase 3.8 promo, angle, and skit segments (SL-6, SL-9)

The default scenario now gives eligible TV building stories a 75% chance to
take a segment slot instead of a match slot. The fixed three-seed 26-week
slice records at least one segment per week and at least one story advance
through a segment in every run. Segments use promo/character/psychology
rather than ring work, consume card capacity, and create no physical cost;
their participants are nevertheless treated as normal appearances by the
popularity model, so they do not silently fall through the idle-decay path.

SL-6 remains structurally intact: stories can build through non-match beats
before their PLE payoff. SL-9 also remains intact in all three runs (every
roster member still wrestles at least three matches, with nobody appearing on
every show), confirming that segment slots complement rather than erase the
rotation match budget.

## Phase 3.12.1 booking observability (measurement only)

The 8-week, 2-seed run (`slice --weeks 8 --seeds 2`) now reports the
booking_ai §12 metric set, per-program timelines, and beat-labelled show
cards. This phase deliberately changed no booking behaviour: the run's
popularity, title, and story outcomes are identical to the pre-3.12.1 run.
What changed is that the defects listed in the PLAN 3.12 series preamble are
now *numbers in the report* rather than conclusions from reading raw cards.

Baseline recorded for the two seeds (seed 1 / seed 2):

| Metric | Observed | Reads as |
| --- | --- | --- |
| Programs created → resolved / open | 8 → 3 / 5 and 7 → 2 / 5 | 38%/29% completion, zero abandonments: plans are left open, never closed (3.12.3) |
| Median program duration / beats before payoff | 4 weeks / 3 beats | the programs that *do* finish run the full four-show skeleton |
| PLE build coverage | 5/12 (42%) and 4/11 (36%) | most PLE story/title matches still arrive with under two resolved beats (3.12.8) |
| Beats generated by type | promo 8, confrontation 8, go-home 8, payoff 8; interference / showcase / direct-rivalry **0** | three of seven beat types are never generated (3.12.6) |
| Beats by status | resolved 16, skipped 11, provisional 5 (seed 1) | a third of planned beats expire unscheduled (3.12.3) |
| Escalation-order violations | 0 | beats never resolve backwards; the stall is windows expiring, not ordering |
| Revisions by cause / no-op revisions | execution_deviation 2 / 2 | every recorded revision changed nothing at all (3.12.4) |
| Planned-finish adherence | 21/25 (84%) and 17/21 (81%), all deviations `refusal` | deviations are common and single-caused, not rare and material (3.12.5) |
| Story advancement from segments | 43% / 44% | segments genuinely carry programs — their popularity treatment is the defect, not their usage (3.12.2) |
| Distinct main-eventers / title challengers | 4 / 3 and 7 / 3 | thin main-event rotation on the shorter horizon |

The per-program timeline answers the "why is this unresolved" question
directly: of the five open programs on seed 1, four report *"payoff window
closed in week 4 with the plan still active"* and their remaining beats are
`skipped` with `blocked by unresolved go home angle`, while one shows every
beat skipped from the start.

SL-1…SL-10 rows on a non-26-week run are now labelled
*"26-week criteria; shown for reference"* in both report formats, so the
8-week gate runs above are no longer read as ten MUST failures.

`world.programPlanCandidates` is windowed by
`booking.programCandidateRetentionTicks` (30). Over the 26-week harness this
holds the private planner trace at 1168 entries (nothing older than tick 48)
instead of 1860 and growing for the whole run; program plans, beats, and
revisions are permanent facts and are untouched.

## Phase 3.12.2 segments are appearances, not lost matches

The 8-week, 2-seed run (`slice --weeks 8 --seeds 2`) before and after the
change, on identical seeds:

| Metric (seed 1 / seed 2) | Before | After |
| --- | --- | --- |
| Net roster popularity | −11 / −50 | **+57 / +55** |
| Popularity from segment appearances | −60 / −51 | **+53 / +57** |
| Worst-off act's cumulative popularity from segments | −18 / −9 | −3 / +3 |
| `burial` moments on segment appearances | 16 / 18 | **0 / 0** |
| `breakout` moments on segment appearances | 1 / 1 | 13 / 16 |
| Heat generated by segments (+ / −) | +30/−35 and +13/−30 | +28/−23 and +16/−9 |
| Wrestlers rising 15+ / falling 10+ | 0/2 and 0/3 | 1/0 and 0/0 |
| CM Punk through a two-defence world-title reign | 91 → 76 (both seeds) | 91 → 88 and 91 → 96 |

The champion line is the clearest read: the same reign that used to cost 15
points while never losing now holds or gains. Top gainers moved from
"+12 for a midcarder" to Damian Priest 75 → 93 and Jey Uso 87 → 99, and the
worst fall shrank from −15 to −6.

Heat now lands in the pool the character reads. `escalate_rivalry` — the
default segment intent of two stances and the intent a top act's AI reaches
for weekly — is `mixed`, so a face is cheered for escalating and a heel is
booed for it; before, both were booed. A *stated* direction still lands as
played, which is what keeps a face who keeps seeking controversy earning the
boos the director reads as a turn.

**Handoff: this phase trades SL-2 for SL-1 on the 26-week gate.** Across the
three fixed seeds, risers (SL-1, 15+ points) went 1/0/1 FAIL → 4/3/4 PASS,
while fallers (SL-2, 10+ points) went 10/9/4 PASS → 2/2/1 FAIL; cross-seed
ranges moved from rises 0–1 / falls 4–10 to rises 3–4 / falls 1–2. Total MUST
failures per seed went 3/3/4 → 2/3/2 (SL-5 and SL-9 also recovered on some
seeds). The old fall count was largely promo burials, which GDD §10 rules out
— "all meaningful falls are active: overexposure, burials, losing streaks,
depushes, lost titles". Nothing in the current stack produces enough active
falls to replace them, so SL-2 is now owed by 3.12.5 (planned finishes that
actually cost a loss), 3.12.3/3.12.6 (programs that end with a decided
winner), and the 3.13 tuning pass. It should not be tuned back by making
appearances costly again.

Two knobs carry the change, both scenario-owned:
`popularity.segmentDominantEdgeFactor` (0.15, against the 0.5 match-win
factor) and `popularity.segmentNonDominantEdge` (0, bounded at −5).

## Phase 3.12.3 beat progression and plan lifecycle repair

Same harness as every phase in this series: `slice --weeks 8 --seeds 2` on
`wwe-2026`, plus the 26-week, 3-seed gate for the criteria table. Baseline is
commit `90a8950` (3.12.1 and 3.12.2).

The stall was in the **beat windows**, not the beat feedback. `createBeatSkeleton`
placed windows at fixed offsets from the payoff (`payoff − 6 / − 3 / − 1`), so a
plan created within two shows of its PLE was born with every window already
closed — the card for that tick had been composed a tick earlier. Each beat then
expired in turn, and because a skipped beat stayed in its successors'
preconditions, the rest of the chain waited forever on something that could never
resolve. Windows are now laid over the television shows that exist, and retiring
a beat splices it out of the chain.

| 8-week, 2 seeds | before | after |
| --- | --- | --- |
| Programs resolved | 3 / 2 | 7 / 7 |
| Open program backlog at week 8 | 5 / 5 | 2 / 1 |
| Beats resolved | 16 / 12 | 26 / 26 |
| Beats skipped | 11 / 15 | 1 / 1 |
| PLE build coverage | 4/11 · 4/11 | 6/10 · 7/11 |
| Stories resolved / still open | 3 of 10 / 7 · 4 of 10 / 6 | 7 of 10 / 3 (both) |
| Net roster popularity | +57 / +55 | +71 / +76 |

Every open plan's `openReason` changed character with it. Before, all five read
"payoff window closed in week 4 with the plan still active" — the zombie state.
After, the open plans read "confrontation is due between weeks 9 and 11" and
"promo_interview is due between weeks 9 and 11": programs mid-build, not
programs abandoned in place. `worldStateSchema` now rejects the old state
outright, so it cannot come back silently.

At 26 weeks the booking picture changes scale rather than degree: programs
created 8 → 28 (plans that end release their participants, so the planner is no
longer holding five permanent zombies), resolved 3 → 23, beats resolved 14 → 93,
skipped 18 → 1, PLE build coverage 13% → 66%, story backlog 10 → 5, and the
median story lifespan 8.0 → 5.0 weeks with 100% of resolutions still landing on
a PLE.

### The TV card was sized for a show without segments

Making beats actually air exposed a scenario-data fault. `tvCardSize` was
`{min: 4, max: 6}`, authored when story segments barely happened; with five live
programs each claiming a beat, the same card went from **3.2 matches + 1.6
segments** a week to **1.2 matches + 3.5 segments**. Rotation matches and title
defences were what got squeezed out, and four MUST rows went with them. Real
television runs both, so the scenario now books **8–10 slots** — measured at
5.3 matches + 3.5 segments, against a PLE's 7.3 matches and no segments. TV has
more *slots*; a PLE still has more *matches*.

| 26-week MUST | before | 3.12.3, cards 4–6 | 3.12.3, cards 8–10 |
| --- | --- | --- | --- |
| SL-1 rises | PASS ×3 | PASS ×3 | PASS ×3 (5 / 5 / 4) |
| SL-2 falls | FAIL ×3 (2/2/1) | FAIL ×3 (1/0/0) | FAIL · **PASS · PASS** (1/4/4) |
| SL-3 non-monotonic | 7 / 6 / 4 | 11 / 9 / 8 | 12 / 9 / 17 |
| SL-4 world title | PASS ×3 | FAIL · PASS · PASS | PASS · **FAIL · FAIL** (3 changes) |
| SL-5 IC title | PASS · FAIL · PASS | FAIL ×3 | FAIL ×3 |
| SL-7 card mobility | PASS ×3 | PASS · PASS · FAIL | **FAIL** · PASS · PASS |
| SL-9 spread | PASS ×3 | FAIL ×3 (min 1/2/2) | FAIL · FAIL · **PASS** |
| MUST failures per seed | 2 / 3 / 2 | 5 / 4 / 5 | 5 / **3 / 3** |

The bigger card buys back most of the regression and gives the roster real
losses again (SL-2 passes on two seeds for the first time since 3.12.2 removed
promo burials). What is left is not card size:

- **SL-5 on every seed, SL-4 on two.** 0–2 midcard changes against 4–5 defences,
  and 3 world-title changes where the spec wants 0–2. Belts are still moving on
  match results rather than as a program's planned payoff — Phase 3.12.8's remit,
  and the largest remaining gap against the pre-phase gate.
- **SL-9 on two seeds, by one wrestler each.** Both name Damian Priest at 1–2
  matches. That is the rotation pass's `restPenalty` holding a high-popularity
  act off cards that now have room for him, not slot starvation; it belongs with
  3.12.7's card-shape pass.
- The TV main event is still usually a promo, and `selectPlannedBeatsForShow` is
  still handed the whole card as its capacity. Both are 3.12.7, and should now be
  designed against the 8–10 card rather than the old one.

Two smaller findings worth recording. The chain healing exposed a live defect in
the substitute-beat path: a stand-in booked only the wrestlers who could appear
but kept the whole program's planned outcome, so it resolved as a `refusal`
deviation against a wrestler who was never in the segment. Raw refusal counts
still rise at 26 weeks (10/12/8 → 25/22/17) purely because far more planned
segments now run at all; the adherence *rate* moves little (0.84/0.79/0.86 →
0.75/0.79/0.84). And `payoff_missed` fires zero times on the shipped scenario
now that programs reach their payoffs — the extend-once-then-abandon path is a
tested backstop rather than observed behaviour, which is the state 3.12.4 should
keep it in.

Three knobs carry the change, all scenario-owned: `booking.minimumProgramBuildShows`
(2), `booking.maxPayoffExtensions` (1), and `booking.coolingResolveWeeks` (3),
plus the `tvCardSize` re-authoring above.

## Phase 3.12.4 replanning with teeth

`slice --weeks 8 --seeds 2` and `--weeks 26 --seeds 3`, default scenario, run
against the 3.12.3 baseline recorded above.

Before this phase every replanning path handed the *unchanged* plan snapshot
back. Four of the six response tokens did not exist, three of the trigger
reasons were unreachable, and the two revisions a slice did produce were audit
entries recording a decision nobody had made. The single number that says this
is fixed is **no-op revisions 1 → 0** on every seed at both lengths: a response
that would change nothing now declines instead of writing a lie, and its caller
falls through to the next one.

| | 3.12.3 | 3.12.4 |
| --- | --- | --- |
| No-op revisions (8wk) | 1 · 0 | **0 · 0** |
| Revisions by cause (8wk, seed 1) | participant unavailable 1, execution deviation 3 | participant unavailable 1, execution deviation 3, **crowd response 1** |
| Revisions by cause (26wk, seed 1) | as above, all no-op pivots | execution deviation 11, participant unavailable 2, crowd response 1, title change 1 |
| Programs resolved (8wk) | 7 · 7 | 7 · 7 |
| Unresolved backlog (8wk) | 2 · 1 | 2 · 1 |
| PLE build coverage (8wk) | 6/10 · 7/11 | 6/10 · 7/11 |
| Beats resolved / skipped (8wk) | 26/1 · 26/1 | 26/1 · 26/1 |
| MUST failures (26wk) | 5 / 3 / 3 | 5 / 3 / 3 |

### The replanning is live but SL-neutral, and that was checked rather than assumed

Every booking metric except the revision counters is unchanged, and the 26-week
MUST rows are identical row for row. That is a real result, not a sign the code
is inert: re-running seed 1 with 3.12.4's behaviour switched off gives a
*different* final roster — six wrestlers land 6–10 popularity points away from
where they land with it on. The replanning moves the world; it does not yet move
a criterion. Two reasons, both of which later phases address:

- All 15 execution deviations on seed 1 are `refusal`, 11 of them in segments.
  The pivot they trigger changes who the program is for, and with it who wins the
  blowoff — but the criteria that would notice (SL-4/SL-5 title movement, SL-7
  main-event diversity) are gated on title booking, which is 3.12.8.
- `repetition`, `payoff_capacity` and `payoff_missed` never fire on the shipped
  tuning. Programs reach their payoffs, run three distinct beat types, and never
  crowd an event past four payoffs. These are backstops with fixtures, and
  3.12.6's richer skeletons and 3.12.8's title programs are what should make the
  first two live. They should not be tuned down to make them fire.

### `pivot` had to reach the roles to mean anything

The first implementation moved `protectedWrestlerIds` and the open beats'
intended dominant. It was measurably almost inert, because
`finishForPlannedBeat` derives the payoff winner from participant **roles** —
protagonist beats antagonist unless a title holder overrides — and never reads
the protected list. A pivot now makes the favoured wrestler the protagonist. It
is the difference between recording that the program changed direction and the
program actually changing direction.

### `maxPayoffsPerEvent` landed at 4, not 3

Three payoffs an event reads defensibly on paper, and at 3 the trigger fired on
the shipped scenario — but what it held over were programs the event had room
for, costing a point of backlog (2 → 3) and of PLE build coverage (60% → 56%) on
seed 1. Against a 6–8 match PLE, four program payoffs is still half the card
with room for the rotation. At 4 the trigger stays a genuine constraint (five
concurrent programs all peaking will hit it) without delaying work the card can
carry.

### Handoffs

- **`MAX_ACTIVE_PROGRAMS` is double-counted.** The seat check adds `selectedIds.size`
  to a `world.programPlans` array the same loop has already pushed into, so the
  portfolio saturates around three or four concurrent programs rather than the
  five the constant names. Found while building the coverage fixture, left alone
  deliberately: it changes program volume across the board and belongs with
  3.12.9's portfolio-driven cadence, which owns the 3–5 band.
- `player_pitch` and `player_response` are unreachable in a headless run by
  design — AI wrestlers are barred from pitching feuds to the GM, and nothing
  answers reactive decisions. Both are covered by driving the real interaction
  and reactive-response slots in tests, and both come alive with a human player.

Five knobs carry the change, all scenario-owned: `booking.crowdResponseInterestDrop`
(20), `booking.heatContradictionLimit` (2), `booking.coolDownTicks` (3),
`booking.repeatedBeatTypeLimit` (3), and `booking.maxPayoffsPerEvent` (4).
