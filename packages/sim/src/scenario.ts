import {
  CURRENT_SCHEMA_VERSION,
  gmObjectiveSchema,
  type Scenario,
  type WorldState,
} from "@wrestling/contracts";
import { createRng } from "./rng.js";

/**
 * Builds a new simulation world from already parsed scenario data. File I/O
 * deliberately lives in the CLI/web layers so this remains deterministic and
 * usable by tests and future server code.
 */
export function worldFromScenario(scenario: Scenario, seed: string): WorldState {
  const rng = createRng(seed);
  const bookingObjective = rng.pick(gmObjectiveSchema.options);
  const gmObjective = bookingObjective === "strengthen_tag_division" ? "new_main_eventer" : bookingObjective;

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
    bookingObjective,
    bookingObjectiveSince: 0,
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
