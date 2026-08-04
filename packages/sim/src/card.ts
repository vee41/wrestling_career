import type { MatchResult, SegmentResult, Show, WorldState } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { resolveMatch } from "./match.js";
import { recordResolvedBeat } from "./planned-beats.js";
import { resolveSegment } from "./segment.js";

export interface CardResolution { matchResults: MatchResult[]; segmentResults: SegmentResult[] }

/** The persisted card array is its execution order, not a cosmetic sort. */
export function resolveCard(world: WorldState, show: Show, ctx: TickContext): CardResolution {
  const matchResults: MatchResult[] = [];
  const segmentResults: SegmentResult[] = [];
  for (const slot of show.card) {
    if (slot.kind === "segment") {
      const result = resolveSegment(world, show, slot, ctx);
      segmentResults.push(result);
      recordResolvedBeat(world, ctx, result);
    } else {
      const result = resolveMatch(world, show, slot, ctx);
      matchResults.push(result);
      recordResolvedBeat(world, ctx, result);
    }
  }
  return { matchResults, segmentResults };
}
