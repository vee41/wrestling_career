import type { WorldConfig, WorldState, Wrestler } from "@wrestling/contracts";

/**
 * Phase 3.12.5. An injury is a calendar fact, not a condition dip.
 *
 * `condition` recovers — the AI reaches for the `recover` action the moment it
 * drops, and one tick of rest buys back more than a hard match cost — so an
 * injury expressed only as lost condition is healed before the next card is
 * even composed. Every absence therefore writes `unavailableUntilTick`, and
 * every availability question in the sim goes through `isAvailable` below so
 * there is exactly one answer to "can this wrestler be booked".
 */

export type InjurySeverity = "minor" | "serious";

/**
 * Serious when the match left the wrestler badly hurt, *or* when the cost they
 * paid was extreme however well they came out of it. Deliberately derived
 * rather than rolled: the same show always produces the same absence, so an
 * injury is something the run can be held to rather than dice on top of dice.
 */
export function injurySeverity(config: WorldConfig, condition: number, physicalCost: number): InjurySeverity {
  return condition <= config.health.seriousInjuryCondition || physicalCost >= config.health.seriousInjuryPhysicalCost
    ? "serious"
    : "minor";
}

export function absenceWeeks(config: WorldConfig, severity: InjurySeverity): number {
  return severity === "serious" ? config.health.seriousAbsenceWeeks : config.health.minorAbsenceWeeks;
}

/**
 * The tick an injury sustained on `injuryTick` clears. Absences are counted in
 * whole show weeks *after* the week the injury happened in — the week's own
 * show has already aired — so a one-week absence means one show missed
 * outright, and clearance lands on the first tick of the week after that.
 */
export function clearanceTick(injuryTick: number, weeks: number, config: WorldConfig): number {
  const weekLength = config.decisionTicksPerWeek + 1;
  // `weekForTick` is 1-indexed; the first tick of week w is (w - 1) * weekLength.
  const injuredWeek = Math.floor(injuryTick / weekLength) + 1;
  return (injuredWeek + weeks) * weekLength;
}

/**
 * The one availability question. Condition is the gradual axis and the
 * clearance tick is the calendar one; a wrestler who is medically cleared but
 * worn out and one who feels fine but is not cleared are both unbookable.
 */
export function isAvailable(world: WorldState, wrestler: Wrestler | undefined): boolean {
  if (wrestler === undefined) return false;
  if (wrestler.condition < world.config.health.bookableCondition) return false;
  return (wrestler.unavailableUntilTick ?? 0) <= world.tick;
}

export function isAvailableId(world: WorldState, wrestlerId: string): boolean {
  return isAvailable(world, world.wrestlers.find((candidate) => candidate.id === wrestlerId));
}

/** Why a wrestler cannot be booked, for the trace. Undefined when they can. */
export function unavailableReason(world: WorldState, wrestler: Wrestler): "not_cleared" | "condition" | undefined {
  if ((wrestler.unavailableUntilTick ?? 0) > world.tick) return "not_cleared";
  return wrestler.condition < world.config.health.bookableCondition ? "condition" : undefined;
}
