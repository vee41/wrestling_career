import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_WORLD_CONFIG,
  careerStanceSchema,
  type CareerStance,
  type WorldState,
} from "@wrestling/contracts";
import { createRng } from "./rng.js";

const STANCES = careerStanceSchema.options;

const FIRST_NAMES = [
  "Ace",
  "Vic",
  "Dusty",
  "Rocco",
  "Iron",
  "Mad",
  "Silver",
  "Blaze",
  "King",
  "Wild",
  "Neon",
  "Crimson",
  "Ghost",
  "Diesel",
  "Rowdy",
];
const LAST_NAMES = [
  "Steel",
  "Vendetta",
  "Cole",
  "Rivera",
  "Fury",
  "Stone",
  "Wolfe",
  "Storm",
  "Knox",
  "Savage",
  "Ryder",
  "Blackwood",
  "Diamond",
  "Vance",
  "Reyes",
];

export interface TestWorldOptions {
  wrestlerCount?: number;
  humanCount?: number;
  seed?: string;
}

/** A synthetic but fully valid WorldState for sim-level tests (not the CLI seed command — that's Phase 3). */
export function createTestWorld(options: TestWorldOptions = {}): WorldState {
  const { wrestlerCount = 30, humanCount = 2, seed = "test-world" } = options;
  const rng = createRng(seed);

  const wrestlers: WorldState["wrestlers"] = [];
  const popularity: WorldState["popularity"] = [];
  const stances: WorldState["stances"] = [];

  for (let i = 0; i < wrestlerCount; i++) {
    const id = `wrestler-${i}`;
    const skillFloor = rng.int(25, 55);
    wrestlers.push({
      id,
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${i}`,
      controlledBy: i < humanCount ? "human" : "ai",
      skills: {
        ringPerformance: rng.int(skillFloor, skillFloor + 40),
        psychology: rng.int(skillFloor, skillFloor + 40),
        promoAbility: rng.int(skillFloor, skillFloor + 40),
        characterWork: rng.int(skillFloor, skillFloor + 40),
        athleticism: rng.int(skillFloor, skillFloor + 40),
        toughness: rng.int(skillFloor, skillFloor + 40),
        professionalism: rng.int(skillFloor, skillFloor + 40),
        politicalInstinct: rng.int(skillFloor, skillFloor + 40),
      },
      condition: rng.int(70, 100),
      money: rng.int(200, 2000),
      alignment: rng.pick(["face", "heel", "tweener"] as const),
      role: "regular",
      gimmick: {
        concept: "Generated archetype",
        promoTone: rng.pick(["earnest", "arrogant", "menacing", "goofy", "controlled"]),
        traits: [rng.pick(["determined", "reckless", "calculating", "charismatic", "stoic"])],
        presentation: "standard gear",
        currentDirection: "finding their footing",
      },
    });
    popularity.push({
      wrestlerId: id,
      currentReaction: rng.int(20, 60),
      generalPopularity: rng.int(15, 55),
      // Synthetic worlds start without an unearned status gap.
      starPower: 0,
      momentum: rng.int(-10, 10),
      positiveHeat: rng.int(0, 30),
      negativeHeat: rng.int(0, 30),
      fatigue: rng.int(0, 20),
    });
    stances.push({ wrestlerId: id, stance: rng.pick(STANCES) as CareerStance });
    popularity[popularity.length - 1]!.starPower = popularity[popularity.length - 1]!.generalPopularity;
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tick: 0,
    seed,
    promotion: {
      name: "Test Wrestling",
      identityBlurb: "A synthetic promotion used only by simulation tests.",
      weeklyTvShowName: "Test TV",
      pleCalendar: ["Test PLE"],
    },
    config: structuredClone(DEFAULT_WORLD_CONFIG),
    wrestlers,
    popularity,
    relationships: [],
    stories: [],
    shows: [],
    matchResults: [],
    events: [],
    narrativeJobs: [],
    narrativeResults: [],
    gmObjective: "new_main_eventer",
    gmObjectiveSince: 0,
    titles: [
      ...(wrestlerCount > 0 ? [{ id: "world-title", name: "World Championship", tier: "world" as const, holderId: "wrestler-0", since: 0 }] : [{ id: "world-title", name: "World Championship", tier: "world" as const }]),
      ...(wrestlerCount > 1 ? [{ id: "midcard-title", name: "Midcard Championship", tier: "midcard" as const, holderId: "wrestler-1", since: 0 }] : [{ id: "midcard-title", name: "Midcard Championship", tier: "midcard" as const }]),
    ],
    stances,
    pendingProposals: [],
    pendingReactiveDecisions: [],
  };
}
