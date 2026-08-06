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
  type Scenario,
  type WorldConfig,
} from "@wrestling/contracts";
import { analyzeSlice, crossSeedCriterion, runHeadlessSlice, worldFromScenario, type SliceAnalysis } from "@wrestling/sim";

export interface TuningRun {
  seed: string;
  analysis: SliceAnalysis;
}

export interface TuningResult {
  config: WorldConfig;
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

export function runTuning(baseScenario: Scenario, config: WorldConfig, seedCount: number): TuningResult {
  const scenario = structuredClone(baseScenario);
  scenario.config = worldConfigSchema.parse(config);
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
    config: scenario.config,
    runs,
    mustPass: analyses.every((analysis) => analysis.criteria.filter((criterion) => criterion.strength === "MUST").every((criterion) => criterion.pass)),
    crossSeed: crossSeedCriterion(analyses),
  };
}

/** Card-shape read: how many slots are matches vs segments, and the TV card averages. Surfaces the match/segment ratio `booking.segmentChance` controls. */
export interface CardComposition {
  matchSlots: number;
  segmentSlots: number;
  segmentShare: number;
  tvShows: number;
  pleShows: number;
  avgTvCardSize: number;
  avgMatchesPerTvShow: number;
  avgSegmentsPerTvShow: number;
  multiWayMatches: number;
}

export function cardComposition(analysis: SliceAnalysis): CardComposition {
  let matchSlots = 0;
  let segmentSlots = 0;
  let multiWayMatches = 0;
  let tvShows = 0;
  let pleShows = 0;
  let tvSlotTotal = 0;
  let tvMatchTotal = 0;
  let tvSegmentTotal = 0;
  for (const card of analysis.showCards) {
    const isTv = card.kind === "tv";
    if (isTv) tvShows += 1;
    else pleShows += 1;
    for (const slot of card.slots) {
      if (slot.kind === "match") {
        matchSlots += 1;
        if (slot.participants.length > 2) multiWayMatches += 1;
        if (isTv) tvMatchTotal += 1;
      } else {
        segmentSlots += 1;
        if (isTv) tvSegmentTotal += 1;
      }
      if (isTv) tvSlotTotal += 1;
    }
  }
  const totalSlots = matchSlots + segmentSlots;
  return {
    matchSlots,
    segmentSlots,
    segmentShare: totalSlots === 0 ? 0 : segmentSlots / totalSlots,
    tvShows,
    pleShows,
    avgTvCardSize: tvShows === 0 ? 0 : tvSlotTotal / tvShows,
    avgMatchesPerTvShow: tvShows === 0 ? 0 : tvMatchTotal / tvShows,
    avgSegmentsPerTvShow: tvShows === 0 ? 0 : tvSegmentTotal / tvShows,
    multiWayMatches,
  };
}

/** Distribution of booked match quality across the slice. */
export interface MatchQualityStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  histogram: Array<{ label: string; count: number }>;
}

export function matchQualityStats(analysis: SliceAnalysis): MatchQualityStats {
  const values = analysis.showCards
    .flatMap((card) => card.slots)
    .filter((slot) => slot.kind === "match" && slot.quality !== undefined)
    .map((slot) => slot.quality as number)
    .sort((left, right) => left - right);
  if (values.length === 0) return { count: 0, min: 0, max: 0, mean: 0, median: 0, histogram: [] };
  const sum = values.reduce((total, value) => total + value, 0);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  const max = values[values.length - 1]!;
  const bucketCount = Math.max(1, Math.ceil((max + 0.0001) / 10));
  const buckets = Array.from({ length: bucketCount }, () => 0);
  for (const value of values) buckets[Math.min(bucketCount - 1, Math.floor(value / 10))]! += 1;
  return {
    count: values.length,
    min: values[0]!,
    max,
    mean: sum / values.length,
    median,
    histogram: buckets.map((count, index) => ({ label: `${index * 10}-${index * 10 + 9}`, count })),
  };
}

/** Appearance cadence per authored role (GDD §10.5), so scarcity dials can be read against actual booking frequency. */
export interface RoleCadence {
  role: string;
  wrestlers: number;
  appearances: number;
  avgAppearances: number;
  avgGapWeeks: number;
}

export function roleCadence(analysis: SliceAnalysis, roster: Scenario["roster"]): RoleCadence[] {
  const appearancesById = new Map<string, number>();
  for (const card of analysis.showCards) {
    for (const slot of card.slots) {
      for (const id of slot.participants) appearancesById.set(id, (appearancesById.get(id) ?? 0) + 1);
    }
  }
  const roles = new Map<string, { wrestlers: number; appearances: number }>();
  for (const entry of roster) {
    const role = entry.wrestler.role ?? "unknown";
    const bucket = roles.get(role) ?? { wrestlers: 0, appearances: 0 };
    bucket.wrestlers += 1;
    bucket.appearances += appearancesById.get(entry.wrestler.id) ?? 0;
    roles.set(role, bucket);
  }
  return [...roles.entries()]
    .map(([role, bucket]) => {
      const avgAppearances = bucket.wrestlers === 0 ? 0 : bucket.appearances / bucket.wrestlers;
      return {
        role,
        wrestlers: bucket.wrestlers,
        appearances: bucket.appearances,
        avgAppearances,
        avgGapWeeks: avgAppearances === 0 ? 0 : analysis.weeks / avgAppearances,
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role));
}

/** Roster-wide injury toll for the Health tab. */
export interface InjuryDigest {
  injuryEvents: number;
  seriousInjuries: number;
  minorInjuries: number;
  totalWeeksLost: number;
  wrestlersInjured: number;
  missedShows: number;
}

export function injuryDigest(analysis: SliceAnalysis): InjuryDigest {
  let injuryEvents = 0;
  let seriousInjuries = 0;
  let totalWeeksLost = 0;
  let wrestlersInjured = 0;
  let missedShows = 0;
  for (const arc of analysis.injuryArcs) {
    injuryEvents += arc.injuryTicks.length;
    seriousInjuries += arc.seriousInjuryTicks.length;
    totalWeeksLost += arc.weeksLost;
    missedShows += arc.missedShowTicks.length;
    if (arc.injuryTicks.length > 0) wrestlersInjured += 1;
  }
  return {
    injuryEvents,
    seriousInjuries,
    minorInjuries: injuryEvents - seriousInjuries,
    totalWeeksLost,
    wrestlersInjured,
    missedShows,
  };
}
