import {
  executionDeviationCauseSchema,
  plannedBeatStatusSchema,
  plannedBeatTypeSchema,
  programRevisionReasonSchema,
  programRevisionResponseSchema,
  type ExecutionAdherence,
  type ExecutionDeviationCause,
  type FinishFamily,
  type MatchResult,
  type MatchSlot,
  type PlannedBeat,
  type PlannedBeatSlotKind,
  type PlannedBeatStatus,
  type PlannedBeatType,
  type PlannedSegmentOutcome,
  type ProgramCreativeObjective,
  type ProgramIntentSnapshot,
  type ProgramParticipantRole,
  type ProgramPlan,
  type ProgramPlanStatus,
  type ProgramRevisionReason,
  type ProgramRevisionResponse,
  type SegmentResult,
  type SegmentSlot,
  type Show,
  type TitleConsequence,
  type WorldState,
} from "@wrestling/contracts";
import { weekForTick } from "./booking.js";
import { median, share, zeroedCounts } from "./stats.js";

export type SliceHeatDirection = PlannedSegmentOutcome["intendedHeatDirection"];

/**
 * One planned or actual outcome, in a single shape for matches and segments:
 * `wrestlerId` is the winner of a match or the dominant participant of a
 * segment, so a report can render planned-versus-actual without branching.
 */
export interface SliceOutcomeView {
  wrestlerId: string;
  finishFamily?: FinishFamily;
  titleConsequence?: TitleConsequence;
  heatDirection?: SliceHeatDirection;
}

/** The beat semantics a card slot carries — what a report needs to name the slot creatively. */
export interface SliceSlotBeat {
  plannedBeatId: string;
  programId: string;
  type: PlannedBeatType;
  escalationLevel: number;
}

export interface SlicePlannedExecution {
  planned?: SliceOutcomeView;
  actual?: SliceOutcomeView;
  adherence?: ExecutionAdherence;
  deviationCause?: ExecutionDeviationCause;
}

export interface SliceProgramBeat {
  beatId: string;
  type: PlannedBeatType;
  status: PlannedBeatStatus;
  escalationLevel: number;
  compatibleSlotKind: PlannedBeatSlotKind;
  spendsDirectMatchup: boolean;
  earliestWeek: number;
  latestWeek: number;
  /** The week the beat aired on, once it was committed to a card. */
  scheduledWeek?: number;
  intendedStoryEffect: string;
  /** Prerequisite beats that never resolved — why an unscheduled beat is still blocked. */
  blockedByBeatTypes: PlannedBeatType[];
  execution: SlicePlannedExecution;
}

export interface SliceProgramRevision {
  week: number;
  reason: ProgramRevisionReason;
  response?: ProgramRevisionResponse;
  /** Intent fields this revision actually changed; empty means the revision was an audit-only no-op. */
  changedFields: string[];
}

export interface SliceProgramTimeline {
  programId: string;
  storyId: string;
  premise: string;
  creativeObjective: ProgramCreativeObjective;
  status: ProgramPlanStatus;
  priority: number;
  escalation: number;
  stakesTitleId?: string;
  participants: Array<{ wrestlerId: string; role: ProgramParticipantRole }>;
  startWeek: number;
  targetPayoffWeek: number;
  /** The week the program ended, for a resolved or abandoned plan. */
  endWeek?: number;
  beats: SliceProgramBeat[];
  revisions: SliceProgramRevision[];
  /** Populated only while a plan is still open: the reason it has not paid off. */
  openReason?: string;
}

export interface SliceBookingMetrics {
  programsCreated: number;
  programsResolved: number;
  programsAbandoned: number;
  /** Unresolved-program backlog: plans still `proposed`, `active`, or `payoff_ready` at the end of the run. */
  programsOpen: number;
  completionRate: number;
  abandonmentRate: number;
  medianProgramDurationWeeks: number;
  medianBeatsBeforePayoff: number;
  beatsGeneratedByType: Record<PlannedBeatType, number>;
  beatsResolvedByType: Record<PlannedBeatType, number>;
  beatsByStatus: Record<PlannedBeatStatus, number>;
  /** PLE story/title matches with at least two prior resolved beats behind them. */
  pleBuildCoverage: { built: number; total: number; share: number };
  directRematches: number;
  consecutivePairings: number;
  segmentStoryAdvancementShare: number;
  escalationOrderViolations: number;
  revisionsByCause: Record<Exclude<ProgramRevisionReason, "initial_plan">, number>;
  revisionsByResponse: Record<ProgramRevisionResponse, number>;
  /** Revisions whose new intent snapshot is identical to the previous one — a recorded change that changed nothing. */
  noOpRevisions: number;
  finishAdherence: {
    planned: number;
    adhered: number;
    deviated: number;
    rate: number;
    deviationCauses: Record<ExecutionDeviationCause, number>;
  };
  distinctMainEventers: number;
  distinctTitleChallengers: number;
}

/** Shared, human-facing explanations for the booking metrics — the single source of truth for CLI/report tooltips. */
export const BOOKING_METRIC_DESCRIPTIONS = {
  programsCreated: "Program plans the planner created over the run. A plan is the GM's private four-week creative intent behind a story.",
  completionRate: "Share of created programs that reached a resolved payoff. Low means feuds are being started but never finished.",
  abandonmentRate: "Share of created programs explicitly abandoned. Zero alongside a large backlog means plans are being left open rather than closed.",
  programsOpen: "Programs still open (proposed, active, or payoff-ready) at the end of the run — the unresolved-program backlog. A growing number means plans pile up instead of paying off.",
  medianProgramDurationWeeks: "Median weeks from a program's start to its resolution or abandonment, counted only for programs that actually ended.",
  medianBeatsBeforePayoff: "Median number of resolved beats a program ran before it ended. Low means payoffs arrive with no build.",
  pleBuildCoverage: "Share of PLE story or title matches that had at least two prior resolved beats of the same program behind them. This is the 'no cold PLE match' measure.",
  directRematches: "Matches whose exact participant set had already met earlier in the run.",
  consecutivePairings: "Matches repeating the same participant set on back-to-back shows — the weekly-rematch smell.",
  segmentStoryAdvancementShare: "Share of story advancement produced by segments rather than matches. Very low means programs are being told entirely through matches.",
  escalationOrderViolations: "Beats that resolved at a lower escalation level than a beat the same program had already resolved — a story that went backwards.",
  noOpRevisions: "Plan revisions whose new intent is identical to the previous intent: audit entries that changed nothing.",
  finishAdherence: "Share of planned finishes and segment outcomes that executed as planned. Deviations should be rare and always attributed to a cause.",
  distinctMainEventers: "Distinct wrestlers who appeared in a main-event slot.",
  distinctTitleChallengers: "Distinct wrestlers who challenged for a title without holding it going in.",
} as const satisfies Partial<Record<keyof SliceBookingMetrics, string>>;

type AnyResult = MatchResult | SegmentResult;

function participantKey(ids: readonly string[]): string {
  return [...ids].slice().sort().join("+");
}

function changedIntentFields(next: ProgramIntentSnapshot, previous?: ProgramIntentSnapshot): string[] {
  if (previous === undefined) return [];
  const fields: string[] = [];
  if (previous.creativeObjective !== next.creativeObjective) fields.push("creativeObjective");
  if (previous.stakesTitleId !== next.stakesTitleId) fields.push("stakesTitleId");
  if (previous.targetPayoffTick !== next.targetPayoffTick) fields.push("targetPayoffTick");
  if (previous.intendedPayoff !== next.intendedPayoff) fields.push("intendedPayoff");
  if (previous.protectedWrestlerIds.join(",") !== next.protectedWrestlerIds.join(",")) fields.push("protectedWrestlerIds");
  return fields;
}

/** Planned-versus-actual for a committed match slot, preferring the resolved result's own record. */
export function matchExecutionView(slot: MatchSlot, result?: MatchResult): SlicePlannedExecution {
  const plannedFinish = result?.plannedFinish ?? slot.plannedFinish;
  if (plannedFinish === undefined) return {};
  return {
    planned: {
      wrestlerId: plannedFinish.intendedWinnerWrestlerId,
      finishFamily: plannedFinish.finishFamily,
      titleConsequence: plannedFinish.intendedTitleConsequence,
    },
    ...(result?.actualOutcome === undefined ? {} : {
      actual: {
        wrestlerId: result.actualOutcome.winnerWrestlerId,
        finishFamily: result.actualOutcome.finishFamily,
        titleConsequence: result.actualOutcome.titleConsequence,
      },
    }),
    ...(result?.adherence === undefined ? {} : { adherence: result.adherence }),
    ...(result?.deviationCause === undefined ? {} : { deviationCause: result.deviationCause }),
  };
}

/** Planned-versus-actual for a committed segment slot, preferring the resolved result's own record. */
export function segmentExecutionView(slot: SegmentSlot, result?: SegmentResult): SlicePlannedExecution {
  const plannedOutcome = result?.plannedOutcome ?? slot.plannedOutcome;
  if (plannedOutcome === undefined) return {};
  return {
    planned: {
      wrestlerId: plannedOutcome.intendedDominantWrestlerId,
      heatDirection: plannedOutcome.intendedHeatDirection,
    },
    ...(result?.actualOutcome === undefined ? {} : {
      actual: { wrestlerId: result.actualOutcome.dominantWrestlerId, heatDirection: result.actualOutcome.heatDirection },
    }),
    ...(result?.adherence === undefined ? {} : { adherence: result.adherence }),
    ...(result?.deviationCause === undefined ? {} : { deviationCause: result.deviationCause }),
  };
}

/** The beat a committed slot executes, when it executes one. */
export function slotBeat(world: WorldState, slot: MatchSlot | SegmentSlot): SliceSlotBeat | undefined {
  if (slot.plannedBeatId === undefined) return undefined;
  const beat = world.plannedBeats.find((candidate) => candidate.id === slot.plannedBeatId);
  if (beat === undefined) return undefined;
  return { plannedBeatId: beat.id, programId: beat.programId, type: beat.type, escalationLevel: beat.escalationLevel };
}

/**
 * The booking_ai §12 observability set, derived from world facts only. Every
 * number here answers a specific creative-booking question the popularity
 * outcomes cannot: did programs finish, did beats escalate, did PLE matches
 * have build, did plans change when they said they changed.
 */
export function analyzeBooking(initialWorld: WorldState, finalWorld: WorldState): {
  metrics: SliceBookingMetrics;
  timelines: SliceProgramTimeline[];
} {
  const config = finalWorld.config;
  const week = (tick: number) => weekForTick(tick, config);
  const shows = finalWorld.shows.slice().sort((a, b) => a.tick - b.tick);
  const showById = new Map<string, Show>(shows.map((show) => [show.id, show]));
  const results: AnyResult[] = [...finalWorld.matchResults, ...finalWorld.segmentResults];
  const resultById = new Map<string, AnyResult>(results.map((result) => [result.id, result]));
  const beatById = new Map<string, PlannedBeat>(finalWorld.plannedBeats.map((beat) => [beat.id, beat]));
  const beatsByProgram = new Map<string, PlannedBeat[]>();
  for (const beat of finalWorld.plannedBeats) {
    const list = beatsByProgram.get(beat.programId);
    if (list) list.push(beat);
    else beatsByProgram.set(beat.programId, [beat]);
  }

  const beatTick = (beat: PlannedBeat): number | undefined => {
    const scheduled = beat.scheduledShowId === undefined ? undefined : showById.get(beat.scheduledShowId)?.tick;
    if (scheduled !== undefined) return scheduled;
    for (const resultId of beat.resultIds) {
      const tick = showById.get(resultById.get(resultId)?.showId ?? "")?.tick;
      if (tick !== undefined) return tick;
    }
    return undefined;
  };
  const beatExecution = (beat: PlannedBeat): SlicePlannedExecution => {
    for (const resultId of beat.resultIds) {
      const result = resultById.get(resultId);
      if (result === undefined) continue;
      const slotId = "matchSlotId" in result ? result.matchSlotId : result.segmentSlotId;
      const slot = showById.get(result.showId)?.card.find((candidate) => candidate.id === slotId);
      if (slot === undefined) continue;
      if (slot.kind === "segment") {
        if ("segmentSlotId" in result) return segmentExecutionView(slot, result);
        continue;
      }
      if ("matchSlotId" in result) return matchExecutionView(slot, result);
    }
    // Not yet executed: the beat still owns its own planned segment outcome.
    return beat.plannedSegmentOutcome === undefined ? {} : {
      planned: {
        wrestlerId: beat.plannedSegmentOutcome.intendedDominantWrestlerId,
        heatDirection: beat.plannedSegmentOutcome.intendedHeatDirection,
      },
    };
  };

  const timelines: SliceProgramTimeline[] = finalWorld.programPlans.map((plan) => {
    const beats = (beatsByProgram.get(plan.id) ?? []).slice()
      .sort((a, b) => a.escalationLevel - b.escalationLevel || a.id.localeCompare(b.id));
    const resolvedTicks = beats.filter((beat) => beat.status === "resolved").flatMap((beat) => {
      const tick = beatTick(beat);
      return tick === undefined ? [] : [tick];
    });
    const storyResolvedTick = finalWorld.events
      .find((event) => event.type === "story_resolved" && event.storyId === plan.storyId)?.tick;
    const lastRevisionTick = plan.revisions.at(-1)?.tick;
    const endTick = plan.status === "resolved" || plan.status === "abandoned"
      ? Math.max(...resolvedTicks, ...(storyResolvedTick === undefined ? [] : [storyResolvedTick]), ...(lastRevisionTick === undefined ? [] : [lastRevisionTick]))
      : undefined;
    return {
      programId: plan.id,
      storyId: plan.storyId,
      premise: plan.premise,
      creativeObjective: plan.creativeObjective,
      status: plan.status,
      priority: plan.priority,
      escalation: plan.escalation,
      ...(plan.stakesTitleId === undefined ? {} : { stakesTitleId: plan.stakesTitleId }),
      participants: plan.participants.map((participant) => ({ wrestlerId: participant.wrestlerId, role: participant.role })),
      startWeek: week(plan.startTick),
      targetPayoffWeek: week(plan.targetPayoffTick),
      ...(endTick === undefined ? {} : { endWeek: week(endTick) }),
      beats: beats.map((beat) => {
        const scheduledTick = beatTick(beat);
        return {
          beatId: beat.id,
          type: beat.type,
          status: beat.status,
          escalationLevel: beat.escalationLevel,
          compatibleSlotKind: beat.compatibleSlotKind,
          spendsDirectMatchup: beat.spendsDirectMatchup,
          earliestWeek: week(beat.earliestTick),
          latestWeek: week(beat.latestTick),
          ...(scheduledTick === undefined ? {} : { scheduledWeek: week(scheduledTick) }),
          intendedStoryEffect: beat.intendedStoryEffect,
          blockedByBeatTypes: beat.preconditions.requiredResolvedBeatIds
            .filter((id) => beatById.get(id)?.status !== "resolved")
            .flatMap((id) => {
              const blocking = beatById.get(id);
              return blocking === undefined ? [] : [blocking.type];
            }),
          execution: beatExecution(beat),
        };
      }),
      revisions: plan.revisions.map((revision) => ({
        week: week(revision.tick),
        reason: revision.reason,
        ...(revision.response === undefined ? {} : { response: revision.response }),
        changedFields: changedIntentFields(revision.newIntent, revision.previousIntent),
      })),
      ...(plan.status === "resolved" || plan.status === "abandoned"
        ? {}
        : { openReason: openReason(beats, beatById, config) }),
    };
  });

  const endedDurations = timelines
    .filter((timeline) => timeline.endWeek !== undefined)
    .map((timeline) => timeline.endWeek! - timeline.startWeek + 1);
  const beatsBeforeEnd = timelines
    .filter((timeline) => timeline.endWeek !== undefined)
    .map((timeline) => timeline.beats.filter((beat) => beat.status === "resolved" && beat.type !== "ple_payoff").length);

  const beatsGeneratedByType = zeroedCounts(plannedBeatTypeSchema.options);
  const beatsResolvedByType = zeroedCounts(plannedBeatTypeSchema.options);
  const beatsByStatus = zeroedCounts(plannedBeatStatusSchema.options);
  for (const beat of finalWorld.plannedBeats) {
    beatsGeneratedByType[beat.type] += 1;
    beatsByStatus[beat.status] += 1;
    if (beat.status === "resolved") beatsResolvedByType[beat.type] += 1;
  }

  const plansByStory = new Map<string, ProgramPlan[]>();
  for (const plan of finalWorld.programPlans) {
    const list = plansByStory.get(plan.storyId);
    if (list) list.push(plan);
    else plansByStory.set(plan.storyId, [plan]);
  }
  let pleBuilt = 0;
  let pleTotal = 0;
  for (const show of shows) {
    if (show.kind !== "ple") continue;
    for (const slot of show.card) {
      if (slot.kind === "segment") continue;
      if (slot.storyId === undefined && slot.titleId === undefined) continue;
      pleTotal += 1;
      const programIds = new Set<string>([
        ...(slot.programId === undefined ? [] : [slot.programId]),
        ...(slot.storyId === undefined ? [] : (plansByStory.get(slot.storyId) ?? []).map((plan) => plan.id)),
      ]);
      const priorBeats = finalWorld.plannedBeats.filter((beat) =>
        programIds.has(beat.programId) && beat.status === "resolved" && (beatTick(beat) ?? Number.POSITIVE_INFINITY) < show.tick,
      ).length;
      if (priorBeats >= 2) pleBuilt += 1;
    }
  }

  const seenPairings = new Set<string>();
  let previousShowPairings = new Set<string>();
  let directRematches = 0;
  let consecutivePairings = 0;
  const mainEventers = new Set<string>();
  const titleChallengers = new Set<string>();
  for (const show of shows) {
    const showPairings = new Set<string>();
    for (const slot of show.card) {
      if (slot.position === "main_event") slot.participantWrestlerIds.forEach((id) => mainEventers.add(id));
      if (slot.kind === "segment") continue;
      if (slot.titleId !== undefined) {
        const holder = titleHolderBefore(initialWorld, finalWorld, slot.titleId, show.tick);
        slot.participantWrestlerIds.filter((id) => id !== holder).forEach((id) => titleChallengers.add(id));
      }
      if (slot.participantWrestlerIds.length < 2) continue;
      const key = participantKey(slot.participantWrestlerIds);
      showPairings.add(key);
      if (seenPairings.has(key)) directRematches += 1;
      if (previousShowPairings.has(key)) consecutivePairings += 1;
      seenPairings.add(key);
    }
    previousShowPairings = showPairings;
  }

  let escalationOrderViolations = 0;
  for (const beats of beatsByProgram.values()) {
    const resolved = beats
      .filter((beat) => beat.status === "resolved")
      .map((beat) => ({ beat, tick: beatTick(beat) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.tick - b.tick || a.beat.id.localeCompare(b.beat.id));
    let peak = -1;
    for (const { beat } of resolved) {
      if (beat.escalationLevel < peak) escalationOrderViolations += 1;
      peak = Math.max(peak, beat.escalationLevel);
    }
  }

  const segmentAdvancement = finalWorld.segmentResults
    .filter((result) => result.storyId !== undefined)
    .reduce((total, result) => total + result.storyAdvancement, 0);
  const matchAdvancement = finalWorld.matchResults
    .filter((result) => result.storyId !== undefined)
    .reduce((total, result) => total + result.storyAdvancement, 0);

  const revisionsByCause = zeroedCounts(
    programRevisionReasonSchema.options.filter((reason): reason is Exclude<ProgramRevisionReason, "initial_plan"> => reason !== "initial_plan"),
  );
  const revisionsByResponse = zeroedCounts(programRevisionResponseSchema.options);
  let noOpRevisions = 0;
  for (const timeline of timelines) {
    for (const revision of timeline.revisions) {
      if (revision.reason === "initial_plan") continue;
      revisionsByCause[revision.reason] += 1;
      if (revision.response !== undefined) revisionsByResponse[revision.response] += 1;
      if (revision.changedFields.length === 0) noOpRevisions += 1;
    }
  }

  const deviationCauses = zeroedCounts(executionDeviationCauseSchema.options);
  let adhered = 0;
  let deviated = 0;
  for (const result of results) {
    if (result.adherence === undefined) continue;
    if (result.adherence === "adhered") adhered += 1;
    else deviated += 1;
    if (result.deviationCause !== undefined) deviationCauses[result.deviationCause] += 1;
  }

  const created = finalWorld.programPlans.length;
  const metrics: SliceBookingMetrics = {
    programsCreated: created,
    programsResolved: finalWorld.programPlans.filter((plan) => plan.status === "resolved").length,
    programsAbandoned: finalWorld.programPlans.filter((plan) => plan.status === "abandoned").length,
    programsOpen: finalWorld.programPlans.filter((plan) => plan.status !== "resolved" && plan.status !== "abandoned").length,
    completionRate: share(finalWorld.programPlans.filter((plan) => plan.status === "resolved").length, created),
    abandonmentRate: share(finalWorld.programPlans.filter((plan) => plan.status === "abandoned").length, created),
    medianProgramDurationWeeks: median(endedDurations),
    medianBeatsBeforePayoff: median(beatsBeforeEnd),
    beatsGeneratedByType,
    beatsResolvedByType,
    beatsByStatus,
    pleBuildCoverage: { built: pleBuilt, total: pleTotal, share: share(pleBuilt, pleTotal) },
    directRematches,
    consecutivePairings,
    segmentStoryAdvancementShare: share(segmentAdvancement, segmentAdvancement + matchAdvancement),
    escalationOrderViolations,
    revisionsByCause,
    revisionsByResponse,
    noOpRevisions,
    finishAdherence: {
      planned: adhered + deviated,
      adhered,
      deviated,
      rate: share(adhered, adhered + deviated),
      deviationCauses,
    },
    distinctMainEventers: mainEventers.size,
    distinctTitleChallengers: titleChallengers.size,
  };

  return { metrics, timelines };
}

/** Why an open plan has not paid off — the question the 8-week report could not answer before Phase 3.12.1. */
/**
 * Why a program has not paid off yet. There is deliberately no "payoff window
 * closed" case: since Phase 3.12.3 an open plan whose payoff tick has passed
 * either extended or was abandoned before the tick ended, and `worldStateSchema`
 * asserts it — so an open plan always has its payoff still ahead of it.
 */
function openReason(
  beats: readonly PlannedBeat[],
  beatById: Map<string, PlannedBeat>,
  config: WorldState["config"],
): string {
  const week = (tick: number) => weekForTick(tick, config);
  const pending = beats.filter((beat) => beat.status === "provisional" || beat.status === "scheduled");
  if (pending.length === 0) return "every planned beat was skipped or invalidated";
  const next = pending[0]!;
  const blocking = next.preconditions.requiredResolvedBeatIds
    .filter((id) => beatById.get(id)?.status !== "resolved")
    .flatMap((id) => {
      const beat = beatById.get(id);
      return beat === undefined ? [] : [`${beat.type} (${beat.status})`];
    });
  if (blocking.length > 0) return `${next.type} waits on unresolved ${blocking.join(", ")}`;
  return `${next.type} is due between weeks ${week(next.earliestTick)} and ${week(next.latestTick)}`;
}

/** The holder going into a match, reconstructed from the initial table plus the title-change log. */
function titleHolderBefore(initialWorld: WorldState, finalWorld: WorldState, titleId: string, tick: number): string | undefined {
  const changes = finalWorld.events
    .filter((event) => event.type === "title_change" && event.data["titleId"] === titleId && event.tick < tick)
    .sort((a, b) => a.tick - b.tick);
  return changes.at(-1)?.wrestlerIds[0] ?? initialWorld.titles.find((title) => title.id === titleId)?.holderId;
}
