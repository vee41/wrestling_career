import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cardComposition,
  injuryDigest,
  loadScenario,
  matchQualityStats,
  popularityTotals,
  roleCadence,
  runTuning,
} from "./tuning.js";

const DATA_ROOT = fileURLToPath(new URL("../../../data/", import.meta.url));

describe("tuning runner", () => {
  it("runs a deterministic local slice with a supplied world configuration", () => {
    const scenario = loadScenario(DATA_ROOT);
    const result = runTuning(scenario, scenario.config, 1);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.analysis.criteria).toHaveLength(9);
    expect(Object.keys(result.runs[0]?.analysis.popularityLogs ?? {})).not.toHaveLength(0);
    // Config values are a tuning knob, not a contract — assert it round-trips
    // rather than hardcoding a specific constant that drifts every retune.
    expect(result.config.popularity.popularityBand).toBe(scenario.config.popularity.popularityBand);
    expect(result.config.booking.segmentChance).toBe(scenario.config.booking.segmentChance);
  });

  it("reconciles roster popularity gains and losses to the net change", () => {
    const scenario = loadScenario(DATA_ROOT);
    const result = runTuning(scenario, scenario.config, 1);
    const totals = popularityTotals(result.runs[0]!.analysis);

    expect(totals.gains).toBeGreaterThanOrEqual(0);
    expect(totals.losses).toBeLessThanOrEqual(0);
    expect(totals.net).toBe(totals.gains + totals.losses);
  });
});

describe("derived tuning metrics", () => {
  const scenario = loadScenario(DATA_ROOT);
  const analysis = runTuning(scenario, scenario.config, 1).runs[0]!.analysis;

  it("splits card slots into matches and segments", () => {
    const composition = cardComposition(analysis);
    expect(composition.matchSlots + composition.segmentSlots).toBeGreaterThan(0);
    expect(composition.segmentShare).toBeGreaterThanOrEqual(0);
    expect(composition.segmentShare).toBeLessThanOrEqual(1);
    expect(composition.tvShows).toBeGreaterThan(0);
    expect(composition.avgTvCardSize).toBeGreaterThan(0);
  });

  it("summarises match quality with a histogram that accounts for every match", () => {
    const quality = matchQualityStats(analysis);
    expect(quality.count).toBeGreaterThan(0);
    expect(quality.min).toBeLessThanOrEqual(quality.median);
    expect(quality.median).toBeLessThanOrEqual(quality.max);
    expect(quality.histogram.reduce((total, bucket) => total + bucket.count, 0)).toBe(quality.count);
  });

  it("groups appearance cadence by authored role", () => {
    const cadence = roleCadence(analysis, scenario.roster);
    expect(cadence.length).toBeGreaterThan(0);
    expect(cadence.reduce((total, role) => total + role.wrestlers, 0)).toBe(scenario.roster.length);
    for (const role of cadence) expect(role.avgGapWeeks).toBeGreaterThanOrEqual(0);
  });

  it("reconciles injury tiers to the total injury count", () => {
    const digest = injuryDigest(analysis);
    expect(digest.minorInjuries + digest.seriousInjuries).toBe(digest.injuryEvents);
    expect(digest.totalWeeksLost).toBeGreaterThanOrEqual(0);
    expect(digest.wrestlersInjured).toBeGreaterThanOrEqual(0);
  });
});
