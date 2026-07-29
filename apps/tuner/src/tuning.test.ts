import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadScenario, popularityTotals, runTuning } from "./tuning.js";

const DATA_ROOT = fileURLToPath(new URL("../../../data/", import.meta.url));

describe("tuning runner", () => {
  it("runs a deterministic local slice with a supplied popularity configuration", () => {
    const scenario = loadScenario(DATA_ROOT);
    const result = runTuning(scenario, scenario.config.popularity, 1);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.analysis.criteria).toHaveLength(9);
    expect(Object.keys(result.runs[0]?.analysis.popularityLogs ?? {})).not.toHaveLength(0);
    // Config values are a tuning knob, not a contract — assert it round-trips
    // rather than hardcoding a specific constant that drifts every retune.
    expect(result.config.popularityBand).toBe(scenario.config.popularity.popularityBand);
  });

  it("reconciles roster popularity gains and losses to the net change", () => {
    const scenario = loadScenario(DATA_ROOT);
    const result = runTuning(scenario, scenario.config.popularity, 1);
    const totals = popularityTotals(result.runs[0]!.analysis);

    expect(totals.gains).toBeGreaterThanOrEqual(0);
    expect(totals.losses).toBeLessThanOrEqual(0);
    expect(totals.net).toBe(totals.gains + totals.losses);
  });
});
