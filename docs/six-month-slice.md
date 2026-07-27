# The Six-Month Slice — MVP Target & Validation Spec

**Status:** Accepted (v1.0)
**Purpose:** Define what the MVP simulation must produce — a believable, interesting six-month slice of a WWE-shaped promotion — and make "interesting" measurable. This document is the **acceptance test for simulation tuning** (PLAN Phase 3.7 gate). GDD §21 remains the career-level fantasy; this spec operationalizes it at world level.

Requirement keywords **MUST** / **SHOULD** per RFC 2119. Criteria carry `SL-n` IDs — tests, the CLI slice report, and playtest notes cite these.

---

## 1. The slice

- **Duration:** 26 in-game weeks (~6 months). Default cadence: 2 decision ticks + 1 show tick per week = 78 ticks.
- **Shows:** one brand, one show per week. Weeks 4, 8, 12, 16, 20, 24 are **premium live events (PLEs)**; all other weeks are **TV**. Show kind (`tv` | `ple`) and the PLE interval come from scenario config, not code.
- **Rhythm:** TV builds; PLEs pay off. Feuds are seeded and escalated on TV and blown off at PLEs. Title matches concentrate on PLEs.
- **Cast:** the default scenario (`data/wwe-2026/`, see [scenario-data-spec.md](scenario-data-spec.md)) — a real-WWE single-brand men's singles roster (~40), World Heavyweight Championship + Intercontinental Championship.
- **Mode:** validation runs are AI-only (0 humans). The same world must stay interesting with humans in it, but the slice bar is judged headless.

## 2. What "interesting and wrestling-logical" means

Qualitative principles the slice must exhibit (the measurable versions are in §3):

- **Q-1 Feuds arc.** A feud starts from a reason (title pursuit, betrayal, crowd momentum), escalates across TV weeks, and pays off at a PLE. After the blowoff, the participants rest or move on — feuds don't smolder forever or end mid-week for no reason.
- **Q-2 Titles anchor the card.** The world title defines the main-event scene; the IC title is the proving ground that turns midcarders into contenders. Belts change hands rarely and at moments that feel earned — no hot-potato reigns.
- **Q-3 Wins and losses matter.** Records feed credibility and booking. A protected wrestler losing clean is an event; a long losing streak visibly costs popularity and position.
- **Q-4 Rise AND fall.** Some acts get over and climb; others cool off, get overexposed, or lose the crowd and slide down the card. Popularity must not be a ratchet — falls are as much a part of the slice as rises.
- **Q-5 History accumulates.** Win-loss records, title lineages, past feuds, injuries and returns are all visible in the record and referenced by what happens next (rematch demand, grudges, comeback pops).
- **Q-6 The card has a hierarchy — and it's permeable.** Main eventers, midcarders, and lower-card wrestlers are distinguishable at any snapshot, but individuals move between tiers over the slice.

## 3. Measurable validation criteria

**Run protocol:** 26-week slice, default scenario, 0 humans, at least **3 distinct seeds**. MUST criteria hold on **every** seed; SHOULD criteria hold on a majority. Inputs: weekly popularity samples (taken by the harness after each show tick) plus the world event log. The CLI `slice` command computes all of these.

| ID | Criterion | Strength |
| --- | --- | --- |
| **SL-1** | **Rises:** ≥3 wrestlers end ≥15 general-popularity points above their start. | MUST |
| **SL-2** | **Falls:** ≥3 wrestlers end ≥10 points below their start. | MUST |
| **SL-3** | **Non-monotonic careers:** ≥40% of the roster shows both a rise ≥8 and a fall ≥8 somewhere in their weekly popularity series. | MUST |
| **SL-4** | **World title:** 0–2 changes over the slice; the champion defends ≥4 times; ≥80% of world-title matches happen at PLEs. | MUST (the 80% clause SHOULD) |
| **SL-5** | **IC title:** 1–3 changes; ≥5 defenses; at least one IC champion or ex-champion enters the world-title scene during the slice. | MUST (last clause SHOULD) |
| **SL-6** | **Feud lifecycle:** ≥8 stories start; ≥5 resolve; median active lifespan 3–9 weeks; ≥60% of resolutions land on a PLE week. | MUST |
| **SL-7** | **Card mobility:** the 6 PLE main events feature ≥6 distinct wrestlers; ≥1 PLE main-eventer started the slice outside the top-5 popularity. | MUST |
| **SL-8** | **Injuries and returns:** ≥2 injury events occur; at least one injured wrestler misses ≥1 show and then returns to the card. | MUST |
| **SL-9** | **Spread:** every roster member wrestles ≥3 matches; nobody appears on every show. | MUST |
| **SL-10** | **No script:** across the seed set, at least 2 different wrestlers finish as the #1 popularity act — outcomes are shaped by stats but not predetermined by them. | SHOULD |

**Qualitative gate (mandatory, human judgment):** read one full slice's dirt sheet output end to end and answer in `playtest-notes.md`: do the feuds read logically (Q-1)? do title changes feel earned (Q-2)? can you name a rise story and a fall story in plain wrestling terms (Q-4)? A slice that passes every SL metric but reads as nonsense fails the gate.

## 4. Mechanics this bar requires

Pointers, not designs — the designs live in PLAN Phases 3.5–3.7:

- Show kinds and a PLE calendar (scenario config).
- Multiple title lines with lineage (world + midcard).
- Card positions (main event / upper / mid / opener) with position-scaled stakes.
- Blowoff-aware booking: peaking stories steered to PLEs and resolved there.
- Injury absence: wrestlers below a condition threshold are unbookable until recovered.
- Fall mechanics with teeth: overexposure, losing-streak drag, and GM depushes must be able to produce sustained popularity decline, not just slower growth.

## 5. Out of scope for the slice

Women's division, tag team division, and a second brand are explicitly out (design decision 2026-07-27). The data format and booking logic should not preclude them, but no slice criterion references them.
