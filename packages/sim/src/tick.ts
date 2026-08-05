import type { NarrativeJob, PlayerTurn, WorldEvent, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { cloneWorld } from "./clone.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import { collectTurns } from "./turns.js";
import { decideFallbackTurn } from "./ai/decide.js";
import { findStance, requireWrestler } from "./lookups.js";
import { resolveInteractions } from "./interactions.js";
import {
  expireProposals,
  expireReactiveDecisions,
  resolveProposalResponses,
  resolveReactiveResponses,
} from "./responses.js";
import { applyActions } from "./resolve-actions.js";
import { bookUpcomingShowIfDue, rotateBookingObjectiveIfDue, rotateGmObjectiveIfDue } from "./gm.js";
import { resolveCard } from "./card.js";
import { updatePopularity } from "./popularity.js";
import { updateChampionships } from "./title.js";
import { advanceStories } from "./stories.js";
import { generateReactiveDecisions, scanForNewStory } from "./director.js";
import { planPrograms } from "./program-plans.js";
import { buildNarrativeJobs } from "./narrative.js";

// Comfortably larger than the patience (6-tick) and training-plateau
// (8-tick) windows those subsystems scan `world.events` for.
const EVENT_RETENTION_TICKS = 30;
const PRUNABLE_EVENT_TYPES: ReadonlySet<WorldEvent["type"]> = new Set(["interaction_resolved", "action_performed"]);

export interface TickResult {
  world: WorldState;
  events: WorldEvent[];
  narrativeJobs: NarrativeJob[];
}

/**
 * The canonical tick pipeline (GDD §4), as a pure function: same `world` +
 * `playerTurns` + `seed` always produces the same result. `world` itself is
 * never mutated — a clone is threaded through every stage instead.
 *
 * The tick counter is mixed into the RNG, so passing a constant seed (e.g.
 * `world.seed`) across consecutive ticks is safe — every tick still rolls
 * fresh randomness rather than repeating the previous tick's decisions.
 */
export function runTick(world: WorldState, playerTurns: readonly PlayerTurn[], seed: string | number): TickResult {
  const draft = cloneWorld(world);
  const tick = draft.tick;
  const ctx: TickContext = { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };

  applyStanceInertia(draft, ctx);

  // Step 1 — collect turns.
  const turns = collectTurns(draft, playerTurns, ctx);

  // Step 2 — AI decisions. Absent humans go through the identical fallback
  // path as AI wrestlers (DL-7) — there is no special case here.
  for (const wrestler of draft.wrestlers) {
    if (!turns.has(wrestler.id)) {
      turns.set(wrestler.id, decideFallbackTurn(draft, wrestler, ctx));
    }
  }

  queueStanceChanges(draft, ctx, turns);
  mergeCardIntents(draft, turns);

  // Step 3 — GM decisions (objective rotation, booking the next show).
  rotateBookingObjectiveIfDue(draft, ctx);
  rotateGmObjectiveIfDue(draft, ctx);

  // Step 4 — resolve interactions and responses (the action slot is
  // resolved alongside them; GDD §4 has no separate numbered step for it).
  resolveInteractions(draft, turns, ctx);
  resolveProposalResponses(draft, turns, ctx);
  resolveReactiveResponses(draft, turns, ctx);
  expireProposals(draft, ctx);
  expireReactiveDecisions(draft, ctx);
  applyActions(draft, turns, ctx);

  // Resolve current social choices before committing a future card. Existing
  // shows stay untouched, so their player intents remain attached.
  planPrograms(draft, ctx);
  bookUpcomingShowIfDue(draft, ctx);

  // Step 5 — resolve the show (show ticks only).
  const show = draft.shows.find((s) => s.tick === tick);
  const resolution = show ? resolveCard(draft, show, ctx) : { matchResults: [], segmentResults: [] };
  const { matchResults, segmentResults } = resolution;

  // Step 6 — crowd & popularity update.
  updatePopularity(draft, ctx, matchResults, segmentResults);
  updateChampionships(draft, ctx, matchResults);

  // Step 7 — story engine + dramatic director.
  advanceStories(draft, ctx, matchResults, segmentResults);
  scanForNewStory(draft, ctx);
  planPrograms(draft, ctx);
  generateReactiveDecisions(draft, ctx);

  // Step 8 — emit narrative jobs.
  const narrativeJobs = buildNarrativeJobs(draft, ctx, ctx.events);

  // Tuning gap: patience.ts/plateau windows rescan the full event log every
  // tick, and only ever look at `interaction_resolved`/`action_performed`
  // entries — those two types are pruned once they age out of every window
  // that reads them (patience: 6 ticks, plateau: 8 ticks). Everything else
  // (title changes, stories, injuries, ...) is a permanent fact and stays.
  draft.events = draft.events.filter(
    (e) => !PRUNABLE_EVENT_TYPES.has(e.type) || e.tick > tick - EVENT_RETENTION_TICKS,
  );
  // The planner appends two candidates per planning pass; without a window
  // this grows for the whole run. Program plans, beats, and their revisions
  // are permanent facts and stay — only the per-tick scoring trace ages out.
  draft.programPlanCandidates = draft.programPlanCandidates.filter(
    (candidate) => candidate.tick > tick - draft.config.booking.programCandidateRetentionTicks,
  );

  draft.tick = tick + 1;

  return { world: draft, events: ctx.events, narrativeJobs };
}

/** Spec §7.3: a stance change queued last tick takes effect at the start of this one. */
function applyStanceInertia(world: WorldState, ctx: TickContext): void {
  for (const stance of world.stances) {
    if (stance.pendingStance === undefined) continue;
    const wrestler = requireWrestler(world, stance.wrestlerId);
    stance.stance = stance.pendingStance;
    delete stance.pendingStance;
    addEvent(world, ctx, {
      type: "stance_changed",
      summary: `${wrestler.name}'s stance shifted to ${stance.stance.replace(/_/g, " ")}.`,
      wrestlerIds: [wrestler.id],
      data: { stance: stance.stance, applied: true },
    });
  }
}

function queueStanceChanges(world: WorldState, ctx: TickContext, turns: Map<string, PlayerTurn>): void {
  for (const turn of turns.values()) {
    if (turn.stanceChange === undefined) continue;
    const stance = findStance(world, turn.wrestlerId);
    if (stance.stance === turn.stanceChange) continue;
    stance.pendingStance = turn.stanceChange;
    addEvent(world, ctx, {
      type: "stance_changed",
      summary: `${requireWrestler(world, turn.wrestlerId).name} queued a stance change to ${turn.stanceChange.replace(/_/g, " ")}, effective next tick.`,
      wrestlerIds: [turn.wrestlerId],
      data: { stance: turn.stanceChange, applied: false },
    });
  }
}

function mergeCardIntents(world: WorldState, turns: Map<string, PlayerTurn>): void {
  const allSlots = world.shows.flatMap((s) => s.card);
  for (const turn of turns.values()) {
    for (const [slotId, intent] of Object.entries(turn.matchIntents)) {
      const slot = allSlots.find((c) => c.id === slotId);
      if (slot && slot.kind !== "segment") slot.intents[turn.wrestlerId] = intent;
    }
    for (const [slotId, intent] of Object.entries(turn.segmentIntents)) {
      const slot = allSlots.find((c) => c.id === slotId);
      if (slot?.kind === "segment") slot.intents[turn.wrestlerId] = intent;
    }
  }
}
