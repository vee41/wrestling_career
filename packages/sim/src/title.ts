import type { MatchResult, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { requireWrestler } from "./lookups.js";

// PLAN Phase 2 simplification: "titles as a single championship belt." The
// belt goes on the line in that show's highest-crowdResponse match (a proxy
// for "main event") whenever the champion is booked in it, or is decided by
// the first eligible main event once there is no champion yet.
const TITLE_ELIGIBLE_QUALITY = 55;

export function updateChampionship(world: WorldState, ctx: TickContext, matchResults: MatchResult[]): void {
  if (matchResults.length === 0) return;
  const mainEvent = matchResults.reduce((best, r) => (r.crowdResponse > best.crowdResponse ? r : best));

  if (world.championId === undefined) {
    if (mainEvent.quality < TITLE_ELIGIBLE_QUALITY) return;
    crown(world, ctx, mainEvent.winnerWrestlerId, mainEvent.id);
    return;
  }

  if (!mainEvent.participantWrestlerIds.includes(world.championId)) return;
  if (mainEvent.winnerWrestlerId === world.championId) {
    addEvent(world, ctx, {
      type: "title_change",
      summary: `${requireWrestler(world, world.championId).name} successfully defended the championship.`,
      wrestlerIds: [world.championId],
      matchId: mainEvent.id,
      data: { defended: true },
    });
    return;
  }
  crown(world, ctx, mainEvent.winnerWrestlerId, mainEvent.id);
}

function crown(world: WorldState, ctx: TickContext, newChampionId: string, matchId: string): void {
  const previous = world.championId;
  world.championId = newChampionId;
  world.championSince = ctx.tick;
  addEvent(world, ctx, {
    type: "title_change",
    summary: previous
      ? `${requireWrestler(world, newChampionId).name} won the championship from ${requireWrestler(world, previous).name}.`
      : `${requireWrestler(world, newChampionId).name} became the inaugural champion.`,
    wrestlerIds: previous ? [newChampionId, previous] : [newChampionId],
    matchId,
    data: { defended: false },
  });
}
