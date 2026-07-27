import type { MatchResult, Title, WorldState } from "@wrestling/contracts";
import { addEvent, type TickContext } from "./context.js";
import { requireWrestler } from "./lookups.js";

/** Resolve every booked title match independently; title_change events are the derived lineage. */
export function updateChampionships(world: WorldState, ctx: TickContext, matchResults: MatchResult[]): void {
  for (const result of matchResults) {
    const show = world.shows.find((candidate) => candidate.id === result.showId);
    const slot = show?.card.find((candidate) => candidate.id === result.matchSlotId);
    if (!slot?.titleId) continue;
    const title = world.titles.find((candidate) => candidate.id === slot.titleId);
    if (!title) continue;
    resolveTitleMatch(world, ctx, title, result);
  }
}

function resolveTitleMatch(world: WorldState, ctx: TickContext, title: Title, result: MatchResult): void {
  const previousHolderId = title.holderId;
  // An uncrowned title can only be established by an explicitly booked title match.
  if (!previousHolderId) {
    crown(world, ctx, title, result.winnerWrestlerId, result.id);
    return;
  }
  if (!result.participantWrestlerIds.includes(previousHolderId)) return;
  if (result.winnerWrestlerId === previousHolderId) {
    addEvent(world, ctx, {
      type: "title_change",
      summary: `${requireWrestler(world, previousHolderId).name} successfully defended the ${title.name}.`,
      wrestlerIds: [previousHolderId], matchId: result.id,
      data: { titleId: title.id, defended: true },
    });
    return;
  }
  crown(world, ctx, title, result.winnerWrestlerId, result.id);
}

function crown(world: WorldState, ctx: TickContext, title: Title, holderId: string, matchId: string): void {
  const previousHolderId = title.holderId;
  title.holderId = holderId;
  title.since = ctx.tick;
  addEvent(world, ctx, {
    type: "title_change",
    summary: previousHolderId
      ? `${requireWrestler(world, holderId).name} won the ${title.name} from ${requireWrestler(world, previousHolderId).name}.`
      : `${requireWrestler(world, holderId).name} became the inaugural ${title.name} champion.`,
    wrestlerIds: previousHolderId ? [holderId, previousHolderId] : [holderId], matchId,
    data: { titleId: title.id, defended: false },
  });
}
