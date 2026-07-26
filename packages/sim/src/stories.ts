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
    } else {
      story.momentum = clampDelta100(story.momentum * IDLE_MOMENTUM_DECAY_FACTOR);
      story.audienceInterest = clampScale100(story.audienceInterest - IDLE_INTEREST_DECAY);
    }

    applyPhaseTransition(world, ctx, story);
  }
}

function applyPhaseTransition(world: WorldState, ctx: TickContext, story: Story): void {
  if (story.audienceInterest < RESOLVE_INTEREST_FLOOR) {
    story.phase = "resolved";
    addEvent(world, ctx, {
      type: "story_resolved",
      summary: `The story "${story.tensionDescription}" has run its course.`,
      wrestlerIds: story.participantWrestlerIds,
      storyId: story.id,
      data: {},
    });
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
  if ((story.phase === "peaking" || story.phase === "building") && story.momentum < COOLING_MOMENTUM_THRESHOLD) {
    story.phase = "cooling";
  }
}
