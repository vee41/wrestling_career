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
export { analyzeSlice, crossSeedCriterion, runHeadlessSlice, type SliceAnalysis, type SliceCriterion, type SliceMatchImpact, type SliceRun } from "./slice.js";
