import type { MatchResult, PopularityChangeReason, Show, WorldEvent, WorldState } from "@wrestling/contracts";
import { isShowTick, weekForTick } from "./booking.js";
import { runTick } from "./tick.js";

export interface PopularitySample {
  week: number;
  generalPopularityByWrestlerId: Record<string, number>;
}

export interface SliceRun {
  initialWorld: WorldState;
  finalWorld: WorldState;
  weeklyPopularity: PopularitySample[];
}

export interface SliceCriterion {
  id: `SL-${number}`;
  strength: "MUST" | "SHOULD";
  pass: boolean;
  observed: string;
  detail?: string;
  /** A sub-clause marked SHOULD in the slice spec (SL-4 and SL-5). */
  shouldPass?: boolean;
}

export interface SliceAnalysis {
  criteria: SliceCriterion[];
  titleLineages: SliceTitleLineage[];
  stories: SliceStoryTimeline[];
  pleCards: SlicePleCard[];
  injuryArcs: SliceInjuryArc[];
  trajectories: SliceTrajectory[];
  popularityLogs: Record<string, SlicePopularityLogEntry[]>;
  topWrestlerId: string;
  ticksPerWeek: number;
}

export interface SliceTitleLineage {
  titleId: string;
  titleName: string;
  initialHolderId?: string;
  changes: Array<{ tick: number; holderId: string; previousHolderId?: string; defended: boolean }>;
}

/** The per-wrestler GDD §10 popularity breakdown for one match, surfaced for the slice report's expand-to-explain view. */
export interface SliceMatchImpact {
  wrestlerId: string;
  delta: number;
  before: number;
  after: number;
  segment: number;
  expectedSegment: number;
  edge: number;
  momentumBefore: number;
  momentumAfter: number;
  reason?: PopularityChangeReason;
}

export interface SliceStoryMatch {
  tick: number;
  showKind: "tv" | "ple";
  position: string;
  participants: string[];
  winnerWrestlerId: string;
  quality: number;
  titleId?: string;
  impacts: SliceMatchImpact[];
}

export interface SliceStoryTimeline {
  storyId: string;
  description: string;
  participants: string[];
  startTick?: number;
  resolveTick?: number;
  resolvedAtPle: boolean;
  matches: SliceStoryMatch[];
}

export interface SlicePleCard {
  week: number;
  showId: string;
  matches: Array<{ position: string; participants: string[]; titleId?: string; storyId?: string; impacts: SliceMatchImpact[] }>;
}

export interface SliceInjuryArc {
  wrestlerId: string;
  injuryTicks: number[];
  missedShowTicks: number[];
  returnTicks: number[];
  events: Array<{ tick: number; summary: string }>;
}

export interface SliceTrajectory {
  wrestlerId: string;
  wrestlerName: string;
  samples: number[];
  start: number;
  end: number;
}

/** One dated, reasoned entry in a wrestler's full popularity history for the slice report's per-wrestler log. */
export interface SlicePopularityLogEntry {
  tick: number;
  kind: "match" | "status";
  delta: number;
  before: number;
  after: number;
  reason?: PopularityChangeReason;
  /** Only present for "match" entries. */
  opponentIds: string[];
  won?: boolean;
  titleId?: string;
  showKind?: "tv" | "ple";
  /** Only present for "status" entries — the milestone event's own player-visible summary. */
  summary?: string;
}

function popularitySample(world: WorldState, week: number): PopularitySample {
  return {
    week,
    generalPopularityByWrestlerId: Object.fromEntries(
      world.popularity.map((popularity) => [popularity.wrestlerId, popularity.generalPopularity]),
    ),
  };
}

/**
 * Run a fully AI-controlled, deterministic slice. This is deliberately pure:
 * callers load scenarios and decide where reports live; sim owns the actual
 * sequence and weekly sampling used by the Phase 3.7 gate.
 */
export function runHeadlessSlice(initialWorld: WorldState, seed: string, weeks = initialWorld.config.sliceWeeks): SliceRun {
  let world = initialWorld;
  const weeklyPopularity = [popularitySample(world, 0)];
  const ticks = weeks * (world.config.decisionTicksPerWeek + 1);

  for (let index = 0; index < ticks; index++) {
    const startingTick = world.tick;
    world = runTick(world, [], seed).world;
    if (isShowTick(startingTick, world.config)) {
      weeklyPopularity.push(popularitySample(world, weekForTick(startingTick, world.config)));
    }
  }

  return { initialWorld, finalWorld: world, weeklyPopularity };
}

function numberData(event: WorldEvent, key: string): number | undefined {
  const value = event.data[key];
  return typeof value === "number" ? value : undefined;
}

function stringData(event: WorldEvent, key: string): string | undefined {
  const value = event.data[key];
  return typeof value === "string" ? value : undefined;
}

function boolData(event: WorldEvent, key: string): boolean | undefined {
  const value = event.data[key];
  return typeof value === "boolean" ? value : undefined;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function showForMatch(world: WorldState, matchId: string): Show | undefined {
  const result = world.matchResults.find((match) => match.id === matchId);
  return result ? world.shows.find((show) => show.id === result.showId) : undefined;
}

function matchImpacts(result: MatchResult): SliceMatchImpact[] {
  return result.performances
    .filter((performance) => performance.popularityImpact !== undefined)
    .map((performance) => {
      const impact = performance.popularityImpact!;
      return {
        wrestlerId: performance.wrestlerId,
        delta: impact.delta,
        before: impact.before,
        after: impact.after,
        segment: impact.segment,
        expectedSegment: impact.expectedSegment,
        edge: impact.edge,
        momentumBefore: impact.momentumBefore,
        momentumAfter: impact.momentumAfter,
        ...(impact.reason ? { reason: impact.reason } : {}),
      };
    });
}

/**
 * Every wrestler's complete, reasoned popularity history: one entry per match
 * appearance that actually moved the needle, plus every earned-status
 * milestone (title win/loss, PLE main-event bonus, sustained-momentum
 * threshold). Idle-tick drift is deliberately excluded — GDD §10.3 treats it
 * as quiet background movement with no discrete reason to report.
 */
function popularityLogs(world: WorldState): Record<string, SlicePopularityLogEntry[]> {
  const logs = new Map<string, SlicePopularityLogEntry[]>();
  const push = (wrestlerId: string, entry: SlicePopularityLogEntry) => {
    const list = logs.get(wrestlerId);
    if (list) list.push(entry);
    else logs.set(wrestlerId, [entry]);
  };

  for (const result of world.matchResults) {
    const show = world.shows.find((candidate) => candidate.id === result.showId);
    const slot = show?.card.find((candidate) => candidate.id === result.matchSlotId);
    for (const performance of result.performances) {
      const impact = performance.popularityImpact;
      if (!impact || impact.delta === 0) continue;
      push(performance.wrestlerId, {
        tick: show?.tick ?? 0,
        kind: "match",
        delta: impact.delta,
        before: impact.before,
        after: impact.after,
        ...(impact.reason ? { reason: impact.reason } : {}),
        opponentIds: result.participantWrestlerIds.filter((id) => id !== performance.wrestlerId),
        won: result.winnerWrestlerId === performance.wrestlerId,
        showKind: show?.kind ?? "tv",
        ...(slot?.titleId ? { titleId: slot.titleId } : {}),
      });
    }
  }

  for (const event of world.events) {
    if (event.type !== "popularity_changed" || stringData(event, "milestone") !== "status") continue;
    const wrestlerId = event.wrestlerIds[0];
    const delta = numberData(event, "delta");
    const before = numberData(event, "before");
    const after = numberData(event, "after");
    if (!wrestlerId || delta === undefined || before === undefined || after === undefined) continue;
    const reason = stringData(event, "reason");
    push(wrestlerId, {
      tick: event.tick,
      kind: "status",
      delta,
      before,
      after,
      ...(reason ? { reason: reason as PopularityChangeReason } : {}),
      opponentIds: [],
      summary: event.summary,
    });
  }

  for (const list of logs.values()) list.sort((a, b) => a.tick - b.tick);
  return Object.fromEntries(logs);
}

/** Compute the measurable SL-1...SL-9 criteria for one completed slice. */
export function analyzeSlice(run: SliceRun): SliceAnalysis {
  const { initialWorld, finalWorld, weeklyPopularity } = run;
  const rosterSize = initialWorld.wrestlers.length;
  const names = new Map(initialWorld.wrestlers.map((wrestler) => [wrestler.id, wrestler.name]));
  const trajectories = initialWorld.wrestlers.map((wrestler) => {
    const samples = weeklyPopularity.map((sample) => sample.generalPopularityByWrestlerId[wrestler.id] ?? 0);
    return { wrestlerId: wrestler.id, wrestlerName: wrestler.name, samples, start: samples[0] ?? 0, end: samples.at(-1) ?? 0 };
  });
  const finalRanking = trajectories.slice().sort((a, b) => b.end - a.end);
  const initialTopFive = new Set(
    trajectories.slice().sort((a, b) => b.start - a.start).slice(0, 5).map((trajectory) => trajectory.wrestlerId),
  );

  const rises = trajectories.filter((trajectory) => trajectory.end - trajectory.start >= 15).length;
  const falls = trajectories.filter((trajectory) => trajectory.start - trajectory.end >= 10).length;
  const nonMonotonic = trajectories.filter((trajectory) =>
    Math.max(...trajectory.samples) - Math.min(...trajectory.samples) >= 16,
  ).length;

  const titleLineages = initialWorld.titles.map((title) => {
    const events = finalWorld.events.filter((event) => event.type === "title_change" && stringData(event, "titleId") === title.id);
    let holderId = title.holderId;
    const changes = events.map((event) => {
      const defended = boolData(event, "defended") === true;
      const nextHolderId = event.wrestlerIds[0] ?? holderId ?? "unknown";
      const change = { tick: event.tick, holderId: nextHolderId, ...(holderId ? { previousHolderId: holderId } : {}), defended };
      holderId = nextHolderId;
      return change;
    });
    return { titleId: title.id, titleName: title.name, ...(title.holderId ? { initialHolderId: title.holderId } : {}), changes };
  });
  const titleMatches = (titleId: string) => finalWorld.matchResults.filter((result) => {
    const show = finalWorld.shows.find((candidate) => candidate.id === result.showId);
    return show?.card.some((slot) => slot.id === result.matchSlotId && slot.titleId === titleId);
  });
  const titleStats = (tier: "world" | "midcard") => {
    const title = initialWorld.titles.find((candidate) => candidate.tier === tier);
    if (!title) return { changes: 0, defenses: 0, matches: [] as typeof finalWorld.matchResults };
    const lineage = titleLineages.find((candidate) => candidate.titleId === title.id)!;
    const matches = titleMatches(title.id);
    return { changes: lineage.changes.filter((change) => !change.defended).length, defenses: lineage.changes.filter((change) => change.defended).length, matches };
  };
  const worldTitle = titleStats("world");
  const midcardTitle = titleStats("midcard");
  const pleFraction = (matches: readonly MatchResult[]) =>
    matches.length === 0 ? 0 : matches.filter((match) => finalWorld.shows.find((show) => show.id === match.showId)?.kind === "ple").length / matches.length;

  const storyStarts = finalWorld.events.filter((event) => event.type === "story_started");
  const storyResolutions = finalWorld.events.filter((event) => event.type === "story_resolved");
  const startByStory = new Map(storyStarts.filter((event) => event.storyId).map((event) => [event.storyId!, event]));
  const storyMatches = (storyId: string): SliceStoryMatch[] => finalWorld.matchResults
    .filter((result) => result.storyId === storyId)
    .map((result) => {
      const show = finalWorld.shows.find((candidate) => candidate.id === result.showId);
      const slot = show?.card.find((candidate) => candidate.id === result.matchSlotId);
      return {
        tick: show?.tick ?? 0,
        showKind: show?.kind ?? "tv",
        position: slot?.position ?? "mid",
        participants: result.participantWrestlerIds,
        winnerWrestlerId: result.winnerWrestlerId,
        quality: result.quality,
        ...(slot?.titleId ? { titleId: slot.titleId } : {}),
        impacts: matchImpacts(result),
      };
    })
    .sort((a, b) => a.tick - b.tick);
  const stories = [...new Set([...storyStarts, ...storyResolutions].map((event) => event.storyId).filter((id): id is string => id !== undefined))].map((storyId) => {
    const start = startByStory.get(storyId);
    const resolution = storyResolutions.find((event) => event.storyId === storyId);
    const current = finalWorld.stories.find((story) => story.id === storyId) ?? initialWorld.stories.find((story) => story.id === storyId);
    const show = resolution?.matchId ? showForMatch(finalWorld, resolution.matchId) : undefined;
    return {
      storyId,
      description: current?.tensionDescription ?? start?.summary ?? storyId,
      participants: current?.participantWrestlerIds ?? start?.wrestlerIds ?? [],
      ...(start ? { startTick: start.tick } : {}),
      ...(resolution ? { resolveTick: resolution.tick } : {}),
      resolvedAtPle: show?.kind === "ple",
      matches: storyMatches(storyId),
    };
  });
  const resolvedStories = stories.filter((story) => story.resolveTick !== undefined);
  const lifespans = resolvedStories.flatMap((story) => story.startTick === undefined || story.resolveTick === undefined
    ? []
    : [(weekForTick(story.resolveTick, finalWorld.config) - weekForTick(story.startTick, finalWorld.config) + 1)]);
  const pleResolutions = resolvedStories.filter((story) => story.resolvedAtPle).length;

  const pleCards = finalWorld.shows.filter((show) => show.kind === "ple").map((show) => ({
    week: weekForTick(show.tick, finalWorld.config), showId: show.id,
    matches: show.card.map((slot) => {
      const result = finalWorld.matchResults.find((candidate) => candidate.showId === show.id && candidate.matchSlotId === slot.id);
      return {
        position: slot.position,
        participants: slot.participantWrestlerIds,
        ...(slot.titleId ? { titleId: slot.titleId } : {}),
        ...(slot.storyId ? { storyId: slot.storyId } : {}),
        impacts: result ? matchImpacts(result) : [],
      };
    }),
  }));
  const pleMainEventers = new Set(pleCards.flatMap((card) => card.matches.filter((match) => match.position === "main_event").flatMap((match) => match.participants)));
  const mainEventerOutsideInitialTopFive = [...pleMainEventers].some((id) => !initialTopFive.has(id));

  const injuryArcs = initialWorld.wrestlers.map((wrestler) => {
    const events = finalWorld.events.filter((event) => event.type === "injury" && event.wrestlerIds.includes(wrestler.id));
    return {
      wrestlerId: wrestler.id,
      injuryTicks: events.filter((event) => event.matchId !== undefined && numberData(event, "condition") !== undefined).map((event) => event.tick),
      missedShowTicks: events.filter((event) => stringData(event, "absence") === "missed_show").map((event) => event.tick),
      returnTicks: events.filter((event) => stringData(event, "absence") === "return").map((event) => event.tick),
      events: events.map((event) => ({ tick: event.tick, summary: event.summary })),
    };
  }).filter((arc) => arc.injuryTicks.length > 0 || arc.missedShowTicks.length > 0 || arc.returnTicks.length > 0);
  const injuryEvents = injuryArcs.reduce((total, arc) => total + arc.injuryTicks.length, 0);
  const recoveryArc = injuryArcs.some((arc) => arc.missedShowTicks.length > 0 && arc.returnTicks.some((tick) => tick > arc.missedShowTicks[0]!));

  const matchesByWrestler = new Map(initialWorld.wrestlers.map((wrestler) => [wrestler.id, 0]));
  finalWorld.matchResults.forEach((match) => match.participantWrestlerIds.forEach((id) => matchesByWrestler.set(id, (matchesByWrestler.get(id) ?? 0) + 1)));
  const appearancesByWrestler = new Map(initialWorld.wrestlers.map((wrestler) => [wrestler.id, new Set<string>()]));
  finalWorld.shows.forEach((show) => show.card.forEach((slot) => slot.participantWrestlerIds.forEach((id) => appearancesByWrestler.get(id)?.add(show.id))));
  const allShows = finalWorld.shows.length;
  const minimumMatches = Math.min(...matchesByWrestler.values());
  const leastBooked = [...matchesByWrestler.entries()]
    .filter(([, count]) => count === minimumMatches)
    .map(([id]) => names.get(id) ?? id)
    .slice(0, 4)
    .join(", ");
  const appearsEveryShow = [...appearancesByWrestler.values()].some((shows) => allShows > 0 && shows.size === allShows);

  const midcardTitleDefinition = initialWorld.titles.find((title) => title.tier === "midcard");
  const historicMidcardHolders = new Set<string>(midcardTitleDefinition?.holderId ? [midcardTitleDefinition.holderId] : []);
  titleLineages.find((lineage) => lineage.titleId === midcardTitleDefinition?.id)?.changes.forEach((change) => historicMidcardHolders.add(change.holderId));
  const icInWorldScene = worldTitle.matches.some((match) => match.participantWrestlerIds.some((id) => historicMidcardHolders.has(id)));

  const criteria: SliceCriterion[] = [
    { id: "SL-1", strength: "MUST", pass: rises >= 3, observed: `${rises} wrestlers rose by 15+ points` },
    { id: "SL-2", strength: "MUST", pass: falls >= 3, observed: `${falls} wrestlers fell by 10+ points` },
    { id: "SL-3", strength: "MUST", pass: nonMonotonic / rosterSize >= 0.4, observed: `${nonMonotonic}/${rosterSize} careers had a 16+ point weekly range` },
    {
      id: "SL-4", strength: "MUST", pass: worldTitle.changes <= 2 && worldTitle.defenses >= 4,
      observed: `${worldTitle.changes} world-title changes, ${worldTitle.defenses} defenses`,
      detail: `${Math.round(pleFraction(worldTitle.matches) * 100)}% of world-title matches at PLEs (SHOULD: ${pleFraction(worldTitle.matches) >= 0.8 ? "PASS" : "FAIL"})`,
      shouldPass: pleFraction(worldTitle.matches) >= 0.8,
    },
    {
      id: "SL-5", strength: "MUST", pass: midcardTitle.changes >= 1 && midcardTitle.changes <= 3 && midcardTitle.defenses >= 5,
      observed: `${midcardTitle.changes} midcard-title changes, ${midcardTitle.defenses} defenses`,
      detail: `IC holder/ex-holder entered world-title scene (SHOULD): ${icInWorldScene ? "PASS" : "FAIL"}`,
      shouldPass: icInWorldScene,
    },
    { id: "SL-6", strength: "MUST", pass: storyStarts.length >= 8 && resolvedStories.length >= 5 && median(lifespans) >= 3 && median(lifespans) <= 9 && (resolvedStories.length === 0 || pleResolutions / resolvedStories.length >= 0.6), observed: `${storyStarts.length} starts, ${resolvedStories.length} resolutions, ${median(lifespans).toFixed(1)}-week median`, detail: `${resolvedStories.length === 0 ? 0 : Math.round((pleResolutions / resolvedStories.length) * 100)}% resolved at PLEs` },
    { id: "SL-7", strength: "MUST", pass: pleMainEventers.size >= 6 && mainEventerOutsideInitialTopFive, observed: `${pleMainEventers.size} distinct PLE main-eventers; outside initial top 5: ${mainEventerOutsideInitialTopFive ? "yes" : "no"}` },
    { id: "SL-8", strength: "MUST", pass: injuryEvents >= 2 && recoveryArc, observed: `${injuryEvents} match injuries; injury absence and return: ${recoveryArc ? "yes" : "no"}` },
    { id: "SL-9", strength: "MUST", pass: minimumMatches >= 3 && !appearsEveryShow, observed: `minimum ${minimumMatches} matches (${leastBooked}); anyone on every show: ${appearsEveryShow ? "yes" : "no"}` },
  ];

  return {
    criteria, titleLineages, stories, pleCards, injuryArcs, trajectories,
    popularityLogs: popularityLogs(finalWorld),
    topWrestlerId: finalRanking[0]?.wrestlerId ?? "unknown",
    ticksPerWeek: finalWorld.config.decisionTicksPerWeek + 1,
  };
}

/** SL-10 is intentionally a cross-seed calculation, never inferred from one run. */
export function crossSeedCriterion(analyses: readonly SliceAnalysis[]): SliceCriterion {
  const topActs = new Set(analyses.map((analysis) => analysis.topWrestlerId));
  return { id: "SL-10", strength: "SHOULD", pass: topActs.size >= 2, observed: `${topActs.size} distinct #1 popularity acts across ${analyses.length} seed(s)` };
}
