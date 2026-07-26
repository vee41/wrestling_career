import {
  CURRENT_SCHEMA_VERSION,
  gmObjectiveSchema,
  skillNameSchema,
  type Alignment,
  type CareerStance,
  type GmObjective,
  type SkillName,
  type WorldState,
} from "@wrestling/contracts";
import { createRng } from "@wrestling/sim";
import { clampScale100 } from "./clamp.js";

const SKILL_NAMES = skillNameSchema.options;
const GM_OBJECTIVES = gmObjectiveSchema.options;

interface Archetype {
  key: string;
  concept: string;
  skillBias: Partial<Record<SkillName, number>>;
  alignments: readonly Alignment[];
  stances: readonly CareerStance[];
  promoTone: string;
  traits: readonly string[];
  presentation: string;
  direction: string;
}

// Hand-written per PLAN.md Phase 3: ~10 archetypes, varied with RNG on top.
const ARCHETYPES: readonly Archetype[] = [
  {
    key: "technical-ace",
    concept: "Technical ace",
    skillBias: { ringPerformance: 20, psychology: 15, athleticism: 10 },
    alignments: ["face", "tweener"],
    stances: ["seek_match_quality", "pursue_championships"],
    promoTone: "earnest",
    traits: ["disciplined", "precise"],
    presentation: "classic singlet, no frills",
    direction: "building a reputation on in-ring quality",
  },
  {
    key: "powerhouse-brawler",
    concept: "Powerhouse brawler",
    skillBias: { toughness: 20, athleticism: 15 },
    alignments: ["heel", "tweener"],
    stances: ["pursue_championships", "avoid_conflict"],
    promoTone: "menacing",
    traits: ["intimidating", "relentless"],
    presentation: "vest and boots, no shirt",
    direction: "running through anyone in the way",
  },
  {
    key: "cocky-champion",
    concept: "Cocky former champion",
    skillBias: { promoAbility: 20, politicalInstinct: 15, characterWork: 10 },
    alignments: ["heel"],
    stances: ["protect_character", "maximize_income"],
    promoTone: "condescending",
    traits: ["arrogant", "manipulative"],
    presentation: "expensive robe, sunglasses",
    direction: "protecting a legacy nobody else respects enough",
  },
  {
    key: "underdog-babyface",
    concept: "Underdog babyface",
    skillBias: { psychology: 15, toughness: 10 },
    alignments: ["face"],
    stances: ["chase_popularity", "support_allies"],
    promoTone: "humble",
    traits: ["determined", "likeable"],
    presentation: "worn gear, patched up between shows",
    direction: "chasing a real opportunity",
  },
  {
    key: "veteran-journeyman",
    concept: "Veteran journeyman",
    skillBias: { professionalism: 20, toughness: 10 },
    alignments: ["tweener"],
    stances: ["cooperate_with_creative", "avoid_conflict"],
    promoTone: "blunt",
    traits: ["reliable", "unglamorous"],
    presentation: "plain trunks, no entrance gimmicks",
    direction: "doing whatever the card needs",
  },
  {
    key: "high-flyer",
    concept: "High-flying daredevil",
    skillBias: { athleticism: 20, ringPerformance: 15 },
    alignments: ["face", "tweener"],
    stances: ["chase_popularity", "seek_match_quality"],
    promoTone: "excitable",
    traits: ["fearless", "flashy"],
    presentation: "bright colors, mask or face paint",
    direction: "trying to steal the show every time out",
  },
  {
    key: "monster-heel",
    concept: "Monster heel",
    skillBias: { toughness: 20, characterWork: 15 },
    alignments: ["heel"],
    stances: ["protect_character", "pursue_championships"],
    promoTone: "menacing",
    traits: ["merciless", "silent"],
    presentation: "oversized, unnatural presence",
    direction: "destroying the next person in line",
  },
  {
    key: "charismatic-talker",
    concept: "Charismatic talker",
    skillBias: { promoAbility: 20, characterWork: 15 },
    alignments: ["face", "heel"],
    stances: ["chase_popularity", "cooperate_with_creative"],
    promoTone: "electric",
    traits: ["charismatic", "unpredictable"],
    presentation: "custom entrance gear, big reactions",
    direction: "living for the microphone",
  },
  {
    key: "silent-enforcer",
    concept: "Silent enforcer",
    skillBias: { toughness: 15, politicalInstinct: 15 },
    alignments: ["heel"],
    stances: ["avoid_conflict", "protect_character"],
    promoTone: "controlled",
    traits: ["stoic", "calculating"],
    presentation: "dark, understated gear",
    direction: "working quietly for whoever pays best",
  },
  {
    key: "comedy-act",
    concept: "Comedy act",
    skillBias: { characterWork: 20, promoAbility: 10 },
    alignments: ["tweener", "face"],
    stances: ["avoid_conflict", "support_allies"],
    promoTone: "goofy",
    traits: ["quirky", "good-natured"],
    presentation: "novelty gear, sight gags",
    direction: "trying to be taken seriously for once",
  },
];

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
  "Jet",
  "Preacher",
  "Doc",
  "Rusty",
  "Slick",
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
  "Malone",
  "Sinclair",
  "Cross",
  "Hawke",
  "Marsh",
];

function kebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export interface SeedOptions {
  wrestlerCount: number;
  humanCount: number;
  seed: string;
}

export function buildWorld(options: SeedOptions): WorldState {
  const { wrestlerCount, humanCount, seed } = options;
  const rng = createRng(seed);

  const wrestlers: WorldState["wrestlers"] = [];
  const popularity: WorldState["popularity"] = [];
  const stances: WorldState["stances"] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < wrestlerCount; i++) {
    const archetype = ARCHETYPES[i % ARCHETYPES.length] as Archetype;
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    let id = kebab(name);
    if (usedIds.has(id)) id = `${id}-${i}`;
    usedIds.add(id);

    const skillFloor = rng.int(25, 50);
    const skills = {} as Record<SkillName, number>;
    for (const skill of SKILL_NAMES) {
      const bias = archetype.skillBias[skill] ?? 0;
      skills[skill] = clampScale100(skillFloor + bias + rng.int(-5, 10));
    }

    wrestlers.push({
      id,
      name,
      controlledBy: i < humanCount ? "human" : "ai",
      skills,
      condition: rng.int(70, 100),
      money: rng.int(300, 1500),
      alignment: rng.pick(archetype.alignments),
      gimmick: {
        concept: archetype.concept,
        promoTone: archetype.promoTone,
        traits: [...archetype.traits],
        presentation: archetype.presentation,
        currentDirection: archetype.direction,
      },
    });

    popularity.push({
      wrestlerId: id,
      currentReaction: rng.int(20, 55),
      generalPopularity: rng.int(15, 50),
      momentum: rng.int(-8, 8),
      positiveHeat: rng.int(0, 25),
      negativeHeat: rng.int(0, 25),
      fatigue: rng.int(0, 15),
    });
    stances.push({ wrestlerId: id, stance: rng.pick(archetype.stances) });
  }

  const gmObjective: GmObjective = rng.pick(GM_OBJECTIVES);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tick: 0,
    seed,
    wrestlers,
    popularity,
    relationships: [],
    stories: [],
    shows: [],
    matchResults: [],
    events: [],
    narrativeJobs: [],
    narrativeResults: [],
    gmObjective,
    gmObjectiveSince: 0,
    stances,
    pendingProposals: [],
    pendingReactiveDecisions: [],
  };
}
