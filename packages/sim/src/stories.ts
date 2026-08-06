import type { MatchResult, SegmentResult, Story, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { abandonProgramPlan } from "./program-plans.js";
import { weekForTick } from "./booking.js";
import { clampDelta100, clampScale100 } from "./clamp.js";

const RESOLVE_INTEREST_FLOOR = 15;
const PEAKING_INTEREST_THRESHOLD = 55;
const PEAKING_MOMENTUM_THRESHOLD = 10;
const COOLING_MOMENTUM_THRESHOLD = -8;
const IDLE_INTEREST_DECAY = 3;
const IDLE_MOMENTUM_DECAY_FACTOR = 0.8;

/** GDD §4 pipeline step 7: advance every non-resolved story from this tick's match results. */
export function advanceStories(world: WorldState, ctx: TickContext, matchResults: MatchResult[], segmentResults: SegmentResult[] = []): void {
  const advancementByStory = new Map<string, number>();
  for (const result of [...matchResults, ...segmentResults]) {
    if (result.storyId) advancementByStory.set(result.storyId, (advancementByStory.get(result.storyId) ?? 0) + result.storyAdvancement);
  }

  for (const story of world.stories) {
    if (story.phase === "resolved") continue;
    const advancement = advancementByStory.get(story.id);

    if (advancement !== undefined) {
      story.momentum = clampDelta100(story.momentum + advancement * 0.6);
      story.audienceInterest = clampScale100(story.audienceInterest + advancement * 0.4);
      story.coherence = clampScale100(story.coherence + ctx.rng.fork(`story:${story.id}`).int(-3, 5));
      addEvent(world, ctx, {
        type: "story_developed",
        summary: `The story "${story.tensionDescription}" advanced.`,
        wrestlerIds: story.participantWrestlerIds,
        storyId: story.id,
        data: { audienceInterest: story.audienceInterest, momentum: story.momentum },
      });

      const blowoff = matchResults.find((result) => result.storyId === story.id &&
        world.shows.find((show) => show.id === result.showId)?.kind === "ple");
      // The legacy blowoff is the fallback for stories no program is building.
      // A planned program's climax is its `ple_payoff` beat, which resolves the
      // story itself (planned-beats.ts) — one payoff authority, not two.
      if (story.phase === "peaking" && blowoff && !hasOpenPlan(world, story)) {
        resolveBlowoff(world, ctx, story, blowoff);
        continue;
      }
    } else {
      story.momentum = clampDelta100(story.momentum * IDLE_MOMENTUM_DECAY_FACTOR);
      story.audienceInterest = clampScale100(story.audienceInterest - IDLE_INTEREST_DECAY);
    }

    // The peak the `crowd_response` trigger measures against. It only ever
    // rises here; the planner re-bases it when it acts on the gap.
    story.peakAudienceInterest = Math.max(story.peakAudienceInterest ?? story.audienceInterest, story.audienceInterest);
    applyPhaseTransition(world, ctx, story, advancement !== undefined);
  }
}

function hasOpenPlan(world: WorldState, story: Story): boolean {
  return world.programPlans.some((plan) =>
    plan.storyId === story.id && (plan.status === "active" || plan.status === "payoff_ready"),
  );
}

function applyPhaseTransition(world: WorldState, ctx: TickContext, story: Story, advanced: boolean): void {
  // Peaking stories are protected until their booked PLE blowoff. They no
  // longer evaporate from passive interest decay while the climax is pending.
  if (story.phase === "peaking") return;
  if (story.phase === "cooling") {
    resolveOrReheatCooling(world, ctx, story, advanced);
    return;
  }
  if (story.audienceInterest < RESOLVE_INTEREST_FLOOR) {
    // A cold program is not abruptly erased mid-week. It is marked for the
    // next PLE card, where the result can close it with a visible payoff.
    story.phase = "peaking";
    return;
  }
  if (
    story.phase === "building" &&
    story.audienceInterest > PEAKING_INTEREST_THRESHOLD &&
    story.momentum > PEAKING_MOMENTUM_THRESHOLD
  ) {
    story.phase = "peaking";
    return;
  }
  if (story.phase === "building" && story.momentum < COOLING_MOMENTUM_THRESHOLD) {
    story.phase = "cooling";
    story.coolingSinceTick = ctx.tick;
  }
}

/**
 * Cooling is a phase, not a grave. A story that gets booked again and works
 * climbs back into the build; one that nobody touches for
 * `booking.coolingResolveWeeks` closes quietly, which releases its participants
 * for new stories and retires whatever plan was still nominally building it.
 * Before this, `cooling` had no exit at all and cold programs accumulated for
 * the length of the run.
 */
function resolveOrReheatCooling(world: WorldState, ctx: TickContext, story: Story, advanced: boolean): void {
  if (advanced && story.momentum > COOLING_MOMENTUM_THRESHOLD) {
    story.phase = "building";
    delete story.coolingSinceTick;
    addEvent(world, ctx, {
      type: "story_developed",
      summary: `"${story.tensionDescription}" recovered enough interest to build again.`,
      wrestlerIds: story.participantWrestlerIds, storyId: story.id,
      data: { reheated: true, audienceInterest: story.audienceInterest, momentum: story.momentum },
    });
    return;
  }
  const since = story.coolingSinceTick ?? ctx.tick;
  story.coolingSinceTick = since;
  if (weekForTick(ctx.tick, world.config) - weekForTick(since, world.config) < world.config.booking.coolingResolveWeeks) return;
  story.phase = "resolved";
  delete story.coolingSinceTick;
  for (const plan of world.programPlans) {
    if (plan.storyId === story.id && (plan.status === "active" || plan.status === "payoff_ready")) {
      abandonProgramPlan(world, ctx, plan, "crowd_response", "the story went cold before it could be paid off.");
    }
  }
  addEvent(world, ctx, {
    type: "story_resolved",
    summary: `"${story.tensionDescription}" faded out without a blowoff and the participants moved on.`,
    wrestlerIds: story.participantWrestlerIds, storyId: story.id,
    data: { quiet: true, audienceInterest: story.audienceInterest },
  });
}

function resolveBlowoff(world: WorldState, ctx: TickContext, story: Story, result: MatchResult): void {
  const scores = result.performances.map((performance) => performance.performanceScore).sort((a, b) => b - a);
  const close = scores.length >= 2 && Math.abs((scores[0] ?? 0) - (scores[1] ?? 0)) <= 8;
  const rematchAlreadyDemanded = story.unresolvedDevelopments.includes("A blowoff rematch was already demanded.");
  if (result.quality >= 80 && close && !rematchAlreadyDemanded && ctx.rng.fork(`blowoff:${story.id}`).chance(0.4)) {
    story.phase = "building";
    story.momentum = clampDelta100(story.momentum + 8);
    story.audienceInterest = clampScale100(story.audienceInterest + 5);
    story.unresolvedDevelopments.push("A blowoff rematch was already demanded.");
    addEvent(world, ctx, {
      type: "story_developed",
      summary: `The PLE blowoff for "${story.tensionDescription}" was too close to end cleanly; a final rematch was demanded.`,
      wrestlerIds: story.participantWrestlerIds, storyId: story.id, matchId: result.id,
      data: { blowoff: true, extended: true, winnerWrestlerId: result.winnerWrestlerId },
    });
    return;
  }
  resolveStoryPayoff(world, ctx, story, result);
}

/**
 * The one place a decided story ends: winner momentum, the relationship
 * consequences of having settled it, and the public `story_resolved` fact.
 * Shared by the planned `ple_payoff` beat and the legacy blowoff fallback so
 * both paths produce the same resolved facts.
 */
export function resolveStoryPayoff(world: WorldState, ctx: TickContext, story: Story, result: MatchResult): void {
  story.phase = "resolved";
  delete story.coolingSinceTick;
  story.momentum = clampDelta100(story.momentum + 10);
  for (const relationship of world.relationships.filter((candidate) =>
    candidate.fromWrestlerId === result.winnerWrestlerId || candidate.toWrestlerId === result.winnerWrestlerId,
  )) {
    relationship.respect = clampDelta100(relationship.respect + 8);
    relationship.rivalry = clampScale100(relationship.rivalry - 12);
  }
  addEvent(world, ctx, {
    type: "story_resolved",
    summary: `The PLE blowoff settled "${story.tensionDescription}" in ${requireWinnerName(world, result.winnerWrestlerId)}'s favor.`,
    wrestlerIds: story.participantWrestlerIds, storyId: story.id, matchId: result.id,
    data: { blowoff: true, winnerWrestlerId: result.winnerWrestlerId },
  });
}

function requireWinnerName(world: WorldState, wrestlerId: string): string {
  return world.wrestlers.find((wrestler) => wrestler.id === wrestlerId)?.name ?? wrestlerId;
}
