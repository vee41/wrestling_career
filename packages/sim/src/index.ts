import { CONTRACTS_PACKAGE_NAME } from "@wrestling/contracts";

export const SIM_PACKAGE_NAME = "@wrestling/sim";

export function describeSim(): string {
  return `${SIM_PACKAGE_NAME} depends on ${CONTRACTS_PACKAGE_NAME}`;
}

export { runTick, type TickResult } from "./tick.js";
export { createRng, type Rng } from "./rng.js";
export { createIdFactory, type IdFactory } from "./ids.js";
export { isShowTick, nextShowTick, upcomingSlotsFor, DECISION_TICKS_PER_WEEK, WEEK_LENGTH_TICKS } from "./booking.js";
export { stanceWeights, defaultMatchIntent, defaultSegmentIntent, type StanceWeights } from "./ai/stance-weights.js";
export { decideFallbackTurn } from "./ai/decide.js";
export { worldFromScenario } from "./scenario.js";
export { planPrograms, reviseProgramPlan, createBeatSkeleton, selectPlannedBeatsForShow } from "./program-plans.js";
export { resolveCard, type CardResolution } from "./card.js";
export { resolveSegment, resolveSegments } from "./segment.js";
export {
  analyzeSlice, CROSS_SEED_INTRO, crossSeedCriterion, crossSeedSignals, runHeadlessSlice, SIGNAL_DESCRIPTIONS, SL_CRITERION_DESCRIPTIONS, sliceCriteriaScope,
  type CrossSeedSignals, type SliceAnalysis, type SliceCriterion, type SliceMatchImpact, type SliceShowCard, type SliceShowSlot,
  type SlicePopularityLogEntry, type SlicePopularityTotals, type SliceRun, type SliceSignals,
} from "./slice.js";
export {
  analyzeBooking, BOOKING_METRIC_DESCRIPTIONS,
  type SliceBookingMetrics, type SliceOutcomeView, type SlicePlannedExecution,
  type SliceProgramBeat, type SliceProgramRevision, type SliceProgramTimeline, type SliceSlotBeat,
} from "./booking-metrics.js";
