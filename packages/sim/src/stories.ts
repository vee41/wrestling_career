import type { MatchResult, Story, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { clampDelta100, clampScale100 } from "./clamp.js";

const RESOLVE_INTEREST_FLOOR = 15;
const PEAKING_INTEREST_THRESHOLD = 55;
const PEAKING_MOMENTUM_THRESHOLD = 10;
const COOLING_MOMENTUM_THRESHOLD = -8;
const IDLE_INTEREST_DECAY = 3;
const IDLE_MOMENTUM_DECAY_FACTOR = 0.8;

/** GDD §4 pipeline step 7: advance every non-resolved story from this tick's match results. */
export function advanceStories(world: WorldState, ctx: TickContext, matchResults: MatchResult[]): void {
  const advancementByStory = new Map<string, number>();
  for (const result of matchResults) {
    if (result.storyId) advancementByStory.set(result.storyId, result.storyAdvancement);
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
      if (story.phase === "peaking" && blowoff) {
        resolveBlowoff(world, ctx, story, blowoff);
        continue;
      }
    } else {
      story.momentum = clampDelta100(story.momentum * IDLE_MOMENTUM_DECAY_FACTOR);
      story.audienceInterest = clampScale100(story.audienceInterest - IDLE_INTEREST_DECAY);
    }

    applyPhaseTransition(world, ctx, story);
  }
}

function applyPhaseTransition(world: WorldState, ctx: TickContext, story: Story): void {
  // Peaking stories are protected until their booked PLE blowoff. They no
  // longer evaporate from passive interest decay while the climax is pending.
  if (story.phase === "peaking") return;
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
  }
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
  story.phase = "resolved";
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
