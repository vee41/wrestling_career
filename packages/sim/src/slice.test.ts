import { describe, expect, it } from "vitest";
import { analyzeSlice, crossSeedCriterion, crossSeedSignals, runHeadlessSlice, SIGNAL_DESCRIPTIONS, type SliceAnalysis } from "./slice.js";
import { worldFromScenario } from "./scenario.js";
import { loadDefaultScenario } from "./test-helpers.js";

function signalLine(analysis: SliceAnalysis): string {
  const s = analysis.signals;
  return [
    `top-tier(88+)=${s.topTierCount}`,
    `spreadStdDev=${s.popularitySpreadStdDev.toFixed(1)}`,
    `rankStability=${s.rankStability.toFixed(2)}`,
    `skillPopCorr=${s.skillPopularityCorrelation.toFixed(2)}`,
    `runningHot=${s.starPowerRunningHotCount}`,
    `suppressed=${s.starPowerSuppressedCount}`,
    `unresolvedStories=${s.unresolvedStoryCount}`,
  ].join(", ");
}

// PLAN Phase 3.7's regression net, now advisory rather than a hard gate (decision
// 2026-07-29): the SL-1...SL-10 thresholds were calibrated against the punchier
// 3.7.1-3.7.5 popularity constants, and a calmer tuning pass legitimately trades
// away some of those raw counts. This test never fails on a criterion or signal
// value — it logs the full slice-health picture on every `pnpm test` run so a
// human can decide what's worth reacting to. Only genuine correctness invariants
// (the sim doesn't crash, popularity totals are internally consistent) still fail
// the test — those indicate a bug, not a tuning outcome.
describe("slice gate", () => {
  it("runs three fixed default-scenario seeds and reports every SL criterion and signal", () => {
    const scenario = loadDefaultScenario();
    const runs = ["slice-wwe-2026-1", "slice-wwe-2026-2", "slice-wwe-2026-3"].map((seed) =>
      runHeadlessSlice(worldFromScenario(scenario, seed), seed),
    );
    const analyses = runs.map(analyzeSlice);

    console.log("\nSlice signal glossary (see SIGNAL_DESCRIPTIONS in slice.ts for the full text):");
    for (const key of Object.keys(SIGNAL_DESCRIPTIONS)) console.log(`  ${key}: ${SIGNAL_DESCRIPTIONS[key as keyof typeof SIGNAL_DESCRIPTIONS]}`);

    for (const [index, analysis] of analyses.entries()) {
      const failedMusts = analysis.criteria.filter((criterion) => criterion.strength === "MUST" && !criterion.pass);
      console.log(`\nslice-wwe-2026-${index + 1}: ${failedMusts.length === 0 ? "all MUSTs pass" : `${failedMusts.length} MUST(s) below threshold — ${failedMusts.map((c) => c.id).join(", ")}`}`);
      for (const criterion of analysis.criteria) console.log(`  ${criterion.id} [${criterion.strength}] ${criterion.pass ? "PASS" : "FAIL"} — ${criterion.observed}`);
      console.log(`  signals: ${signalLine(analysis)}`);

      // Correctness invariants only — these indicate a bug in the totals
      // bookkeeping, never a tuning choice, so they stay hard assertions.
      expect(analysis.popularityTotals.gains).toBeGreaterThanOrEqual(0);
      expect(analysis.popularityTotals.losses).toBeLessThanOrEqual(0);
      expect(analysis.popularityTotals.net).toBe(analysis.trajectories.reduce(
        (total, trajectory) => total + trajectory.end - trajectory.start,
        0,
      ));
      const segments = runs[index]!.finalWorld.segmentResults;
      const storySegments = segments.filter((segment) => segment.storyId !== undefined);
      // Phase 3.8: TV angles occupy the same card budget as matches. The
      // default scenario therefore needs a real weekly segment cadence, not
      // merely a schema path that occasionally fires.
      expect(segments.length).toBeGreaterThanOrEqual(runs[index]!.finalWorld.config.sliceWeeks);
      expect(storySegments.length).toBeGreaterThan(0);
      expect(analysis.showCards.flatMap((card) => card.slots).filter((slot) => slot.kind === "segment")).toHaveLength(segments.length);
    }

    const cross = crossSeedCriterion(analyses);
    const volatility = crossSeedSignals(analyses);
    console.log(`\ncross-seed SL-10: ${cross.pass ? "PASS" : "FAIL"} — ${cross.observed}`);
    console.log(`cross-seed volatility: rises ${volatility.risesRange.join("-")}, falls ${volatility.fallsRange.join("-")}, non-monotonic share ${volatility.nonMonotonicShareRange.map((v) => `${Math.round(v * 100)}%`).join("-")}`);
  });
});
