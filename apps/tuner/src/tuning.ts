import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  configFileSchema,
  promotionSchema,
  relationshipsFileSchema,
  rosterFileSchema,
  scenarioManifestSchema,
  scenarioSchema,
  storiesFileSchema,
  titlesFileSchema,
  worldConfigSchema,
  type PopularityTuning,
  type Scenario,
} from "@wrestling/contracts";
import { analyzeSlice, crossSeedCriterion, runHeadlessSlice, worldFromScenario, type SliceAnalysis } from "@wrestling/sim";

export interface TuningRun {
  seed: string;
  analysis: SliceAnalysis;
}

export interface TuningResult {
  config: PopularityTuning;
  runs: TuningRun[];
  mustPass: boolean;
  crossSeed: ReturnType<typeof crossSeedCriterion>;
}

export interface PopularityTotals {
  gains: number;
  losses: number;
  net: number;
}

/**
 * Measures roster-wide general-popularity movement from the weekly snapshots.
 * This intentionally does not sum individual log entries: a single decision
 * can produce several entries (for example, a match result and a title-status
 * change), while the trajectory records the actual popularity state.
 */
export function popularityTotals(analysis: SliceAnalysis): PopularityTotals {
  let gains = 0;
  let losses = 0;

  for (const trajectory of analysis.trajectories) {
    for (let index = 1; index < trajectory.samples.length; index += 1) {
      const delta = trajectory.samples[index]! - trajectory.samples[index - 1]!;
      if (delta > 0) gains += delta;
      if (delta < 0) losses += delta;
    }
  }

  return { gains, losses, net: gains + losses };
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** File I/O is deliberately local to the developer tool; the sim stays pure. */
export function loadScenario(dataRoot: string, scenarioId = "wwe-2026"): Scenario {
  const directory = resolve(dataRoot, scenarioId);
  return scenarioSchema.parse({
    manifest: scenarioManifestSchema.parse(json(resolve(directory, "scenario.json"))),
    promotion: promotionSchema.parse(json(resolve(directory, "promotion.json"))),
    roster: rosterFileSchema.parse(json(resolve(directory, "roster.json"))),
    titles: titlesFileSchema.parse(json(resolve(directory, "titles.json"))),
    relationships: relationshipsFileSchema.parse(json(resolve(directory, "relationships.json"))),
    stories: storiesFileSchema.parse(json(resolve(directory, "stories.json"))),
    config: configFileSchema.parse(json(resolve(directory, "config.json"))),
  });
}

export function runTuning(baseScenario: Scenario, popularity: PopularityTuning, seedCount: number): TuningResult {
  const scenario = structuredClone(baseScenario);
  scenario.config = worldConfigSchema.parse({ ...scenario.config, popularity });
  const runs = Array.from({ length: seedCount }, (_, index) => {
    // Match the slice gate's fixed seeds so a baseline dashboard run and the
    // regression test judge the exact same deterministic worlds.
    const seed = `slice-${scenario.manifest.id}-${index + 1}`;
    return {
      seed,
      analysis: analyzeSlice(runHeadlessSlice(worldFromScenario(scenario, seed), seed)),
    };
  });
  const analyses = runs.map((run) => run.analysis);
  return {
    config: scenario.config.popularity,
    runs,
    mustPass: analyses.every((analysis) => analysis.criteria.filter((criterion) => criterion.strength === "MUST").every((criterion) => criterion.pass)),
    crossSeed: crossSeedCriterion(analyses),
  };
}
