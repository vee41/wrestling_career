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
