import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  configFileSchema,
  promotionSchema,
  relationshipsFileSchema,
  rosterFileSchema,
  scenarioManifestSchema,
  scenarioSchema,
  storiesFileSchema,
  titlesFileSchema,
} from "@wrestling/contracts";
import { describe, expect, it } from "vitest";
import { analyzeSlice, crossSeedCriterion, runHeadlessSlice } from "./slice.js";
import { worldFromScenario } from "./scenario.js";

const DATA_DIRECTORY = fileURLToPath(new URL("../../../data/wwe-2026/", import.meta.url));

function json(filename: string): unknown {
  return JSON.parse(readFileSync(`${DATA_DIRECTORY}${filename}`, "utf8"));
}

function defaultScenario() {
  return scenarioSchema.parse({
    manifest: scenarioManifestSchema.parse(json("scenario.json")),
    promotion: promotionSchema.parse(json("promotion.json")),
    roster: rosterFileSchema.parse(json("roster.json")),
    titles: titlesFileSchema.parse(json("titles.json")),
    relationships: relationshipsFileSchema.parse(json("relationships.json")),
    stories: storiesFileSchema.parse(json("stories.json")),
    config: configFileSchema.parse(json("config.json")),
  });
}

// PLAN Phase 3.7's regression net. Keep this as one describe block so the
// intentional 3 x 26-week simulation can be filtered as `slice gate`.
describe("slice gate", () => {
  it("meets every MUST criterion on three fixed default-scenario seeds", () => {
    const scenario = defaultScenario();
    const analyses = ["slice-wwe-2026-1", "slice-wwe-2026-2", "slice-wwe-2026-3"].map((seed) =>
      analyzeSlice(runHeadlessSlice(worldFromScenario(scenario, seed), seed)),
    );

    for (const analysis of analyses) {
      const failedMusts = analysis.criteria.filter((criterion) => criterion.strength === "MUST" && !criterion.pass);
      expect(failedMusts).toEqual([]);
      expect(analysis.popularityTotals.gains).toBeGreaterThanOrEqual(0);
      expect(analysis.popularityTotals.losses).toBeLessThanOrEqual(0);
      expect(analysis.popularityTotals.net).toBe(analysis.trajectories.reduce(
        (total, trajectory) => total + trajectory.end - trajectory.start,
        0,
      ));
    }
    expect(crossSeedCriterion(analyses).pass).toBe(true);
  });
});
