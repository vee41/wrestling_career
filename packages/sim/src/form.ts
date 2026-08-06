import type { WorldState } from "@wrestling/contracts";

export interface RotationForm {
  wins: number;
  losses: number;
  /** Wins minus losses over the window — the streak a planner reads as "in form". */
  net: number;
}

/**
 * How a wrestler has been doing in the matches nobody planned.
 *
 * Open-rotation results are the promotion's own evidence about who the audience
 * would believe in a bigger spot: a run of wins there is the contender pipeline
 * that title programs (Phase 3.12.8) and elevation catalysts (Phase 3.12.9) are
 * meant to consume, and before this it was thrown away every week. Derived on
 * demand from match results — deliberately no stored streak state, so a form
 * read can never disagree with the results it is read from.
 */
export function rotationForm(world: WorldState, wrestlerId: string, currentTick: number): RotationForm {
  const tickOf = (showId: string): number | undefined => world.shows.find((show) => show.id === showId)?.tick;
  const recent = world.matchResults
    .filter((result) => result.storyId === undefined && result.programId === undefined)
    .filter((result) => result.participantWrestlerIds.includes(wrestlerId))
    .map((result) => ({ result, tick: tickOf(result.showId) }))
    .filter((entry): entry is { result: (typeof entry)["result"]; tick: number } => entry.tick !== undefined && entry.tick < currentTick)
    .sort((a, b) => b.tick - a.tick || b.result.id.localeCompare(a.result.id))
    .slice(0, world.config.booking.rotationFormMatches);
  const wins = recent.filter((entry) => entry.result.winnerWrestlerId === wrestlerId).length;
  return { wins, losses: recent.length - wins, net: wins - (recent.length - wins) };
}
