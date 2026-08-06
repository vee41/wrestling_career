import {
  CURRENT_SCHEMA_VERSION,
  type Scenario,
  type WorldState,
} from "@wrestling/contracts";
import { createRng } from "./rng.js";
import { SUPPORTED_GM_OBJECTIVES } from "./gm.js";

/**
 * Builds a new simulation world from already parsed scenario data. File I/O
 * deliberately lives in the CLI/web layers so this remains deterministic and
 * usable by tests and future server code.
 */
export function worldFromScenario(scenario: Scenario, seed: string): WorldState {
  const rng = createRng(seed);
  // Only objectives the scenario can actually execute: the tag token survives
  // in contracts for old snapshots, never as an opening direction.
  const gmObjective = rng.pick(SUPPORTED_GM_OBJECTIVES);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tick: 0,
    seed,
    promotion: structuredClone(scenario.promotion),
    config: structuredClone(scenario.config),
    wrestlers: scenario.roster.map(({ wrestler }) => ({ ...structuredClone(wrestler), controlledBy: "ai" })),
    popularity: scenario.roster.map(({ popularity }) => structuredClone(popularity)),
    relationships: scenario.relationships.map((relationship) => structuredClone(relationship)),
    stories: scenario.stories.map((story) => structuredClone(story)),
    programPlans: [],
    programPlanCandidates: [],
    plannedBeats: [],
    shows: [],
    matchResults: [],
    segmentResults: [],
    events: [],
    narrativeJobs: [],
    narrativeResults: [],
    gmObjective,
    gmObjectiveSince: 0,
    titles: scenario.titles.map((title) => ({
      id: title.id,
      name: title.name,
      tier: title.tier,
      ...(title.initialHolderId === undefined ? {} : { holderId: title.initialHolderId, since: 0 }),
    })),
    stances: scenario.roster.map(({ wrestler, stance }) => ({ wrestlerId: wrestler.id, stance })),
    pendingProposals: [],
    pendingReactiveDecisions: [],
  };
}
