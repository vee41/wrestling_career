import {
  bookingTraceSchema,
  executionAdherenceSchema,
  executionDeviationCauseSchema,
  finishFamilySchema,
  plannedBeatSlotKindSchema,
  plannedBeatStatusSchema,
  plannedBeatTypeSchema,
  plannedSegmentOutcomeSchema,
  popularityChangeReasonSchema,
  programCreativeObjectiveSchema,
  programParticipantRoleSchema,
  programPlanStatusSchema,
  programRevisionReasonSchema,
  programRevisionResponseSchema,
  showKindSchema,
  titleConsequenceSchema,
} from "@wrestling/contracts";
import type { SliceAnalysis, SliceCriterion, CrossSeedSignals } from "@wrestling/sim";
import { z } from "zod";

const heatDirectionSchema = plannedSegmentOutcomeSchema.shape.intendedHeatDirection;

const impactSchema = z.strictObject({
  wrestlerId: z.string(),
  delta: z.number(),
  before: z.number(),
  after: z.number(),
  segment: z.number(),
  expectedSegment: z.number(),
  edge: z.number(),
  momentumBefore: z.number(),
  momentumAfter: z.number(),
  reason: popularityChangeReasonSchema.optional(),
});

const outcomeViewSchema = z.strictObject({
  wrestlerId: z.string(),
  finishFamily: finishFamilySchema.optional(),
  titleConsequence: titleConsequenceSchema.optional(),
  heatDirection: heatDirectionSchema.optional(),
});

const executionSchema = z.strictObject({
  planned: outcomeViewSchema.optional(),
  actual: outcomeViewSchema.optional(),
  adherence: executionAdherenceSchema.optional(),
  deviationCause: executionDeviationCauseSchema.optional(),
});

const criterionSchema = z.strictObject({
  id: z.string().regex(/^SL-\d+$/),
  strength: z.enum(["MUST", "SHOULD"]),
  pass: z.boolean(),
  observed: z.string(),
  detail: z.string().optional(),
  shouldPass: z.boolean().optional(),
});

const counts = z.record(z.string(), z.number());

const bookingMetricsSchema = z.strictObject({
  programsCreated: z.number(),
  programsResolved: z.number(),
  programsAbandoned: z.number(),
  programsOpen: z.number(),
  completionRate: z.number(),
  abandonmentRate: z.number(),
  medianProgramDurationWeeks: z.number(),
  medianBeatsBeforePayoff: z.number(),
  beatsGeneratedByType: counts,
  beatsResolvedByType: counts,
  beatsByStatus: counts,
  pleBuildCoverage: z.strictObject({ built: z.number(), total: z.number(), share: z.number() }),
  directRematches: z.number(),
  consecutivePairings: z.number(),
  segmentStoryAdvancementShare: z.number(),
  escalationOrderViolations: z.number(),
  revisionsByCause: counts,
  revisionsByResponse: counts,
  noOpRevisions: z.number(),
  finishAdherence: z.strictObject({
    planned: z.number(),
    adhered: z.number(),
    deviated: z.number(),
    rate: z.number(),
    deviationCauses: counts,
  }),
  distinctMainEventers: z.number(),
  distinctTitleChallengers: z.number(),
  programsWithSoleDominant: z.number(),
  televisionMatchBeats: z.number(),
  outsideBeatParticipants: z.number(),
  televisionMatchMainEvents: z.strictObject({ matches: z.number(), total: z.number(), share: z.number() }),
  repeatedPlacements: z.number(),
  scoreInversions: z.number(),
  programsByObjective: counts,
});

const programTimelineSchema = z.strictObject({
  programId: z.string(),
  storyId: z.string(),
  premise: z.string(),
  creativeObjective: programCreativeObjectiveSchema,
  status: programPlanStatusSchema,
  priority: z.number(),
  escalation: z.number(),
  stakesTitleId: z.string().optional(),
  participants: z.array(z.strictObject({ wrestlerId: z.string(), role: programParticipantRoleSchema })),
  startWeek: z.number(),
  targetPayoffWeek: z.number(),
  endWeek: z.number().optional(),
  beats: z.array(z.strictObject({
    beatId: z.string(),
    type: plannedBeatTypeSchema,
    status: plannedBeatStatusSchema,
    escalationLevel: z.number(),
    compatibleSlotKind: plannedBeatSlotKindSchema,
    spendsDirectMatchup: z.boolean(),
    earliestWeek: z.number(),
    latestWeek: z.number(),
    scheduledWeek: z.number().optional(),
    intendedStoryEffect: z.string(),
    blockedByBeatTypes: z.array(plannedBeatTypeSchema),
    execution: executionSchema,
  })),
  revisions: z.array(z.strictObject({
    week: z.number(),
    reason: programRevisionReasonSchema,
    response: programRevisionResponseSchema.optional(),
    changedFields: z.array(z.string()),
  })),
  openReason: z.string().optional(),
});

const showSlotSchema = z.strictObject({
  kind: z.enum(["match", "segment"]),
  position: z.string(),
  participants: z.array(z.string()),
  storyId: z.string().optional(),
  titleId: z.string().optional(),
  quality: z.number().optional(),
  crowdResponse: z.number().optional(),
  winnerWrestlerId: z.string().optional(),
  dominantWrestlerId: z.string().optional(),
  impacts: z.array(impactSchema),
  heatDeltas: z.array(z.strictObject({
    wrestlerId: z.string(), positive: z.number(), negative: z.number(), storyAdvancement: z.number(),
  })).optional(),
  beat: z.strictObject({
    plannedBeatId: z.string(), programId: z.string(), type: plannedBeatTypeSchema, escalationLevel: z.number(),
  }).optional(),
  execution: executionSchema,
});

export const sliceAnalysisJsonSchema = z.strictObject({
  criteria: z.array(criterionSchema),
  weeks: z.number(),
  criteriaHorizonWeeks: z.number(),
  criteriaAdvisory: z.boolean(),
  bookingMetrics: bookingMetricsSchema,
  programTimelines: z.array(programTimelineSchema),
  titleLineages: z.array(z.strictObject({
    titleId: z.string(),
    titleName: z.string(),
    initialHolderId: z.string().optional(),
    changes: z.array(z.strictObject({
      tick: z.number(), holderId: z.string(), previousHolderId: z.string().optional(), defended: z.boolean(),
    })),
  })),
  stories: z.array(z.strictObject({
    storyId: z.string(),
    description: z.string(),
    participants: z.array(z.string()),
    startTick: z.number().optional(),
    resolveTick: z.number().optional(),
    resolvedAtPle: z.boolean(),
    matches: z.array(z.strictObject({
      tick: z.number(),
      showKind: showKindSchema,
      position: z.string(),
      participants: z.array(z.string()),
      winnerWrestlerId: z.string(),
      quality: z.number(),
      titleId: z.string().optional(),
      impacts: z.array(impactSchema),
    })),
  })),
  pleCards: z.array(z.strictObject({
    week: z.number(),
    showId: z.string(),
    matches: z.array(z.strictObject({
      position: z.string(),
      participants: z.array(z.string()),
      titleId: z.string().optional(),
      storyId: z.string().optional(),
      impacts: z.array(impactSchema),
    })),
  })),
  showCards: z.array(z.strictObject({
    week: z.number(),
    showId: z.string(),
    kind: showKindSchema,
    slots: z.array(showSlotSchema),
    bookingTrace: bookingTraceSchema.optional(),
  })),
  injuryArcs: z.array(z.strictObject({
    wrestlerId: z.string(),
    injuryTicks: z.array(z.number()),
    seriousInjuryTicks: z.array(z.number()),
    weeksLost: z.number(),
    missedShowTicks: z.array(z.number()),
    returnTicks: z.array(z.number()),
    events: z.array(z.strictObject({ tick: z.number(), summary: z.string() })),
  })),
  trajectories: z.array(z.strictObject({
    wrestlerId: z.string(), wrestlerName: z.string(), samples: z.array(z.number()), start: z.number(), end: z.number(),
  })),
  popularityLogs: z.record(z.string(), z.array(z.strictObject({
    tick: z.number(),
    kind: z.enum(["match", "status"]),
    delta: z.number(),
    before: z.number(),
    after: z.number(),
    reason: popularityChangeReasonSchema.optional(),
    opponentIds: z.array(z.string()),
    won: z.boolean().optional(),
    titleId: z.string().optional(),
    showKind: showKindSchema.optional(),
    summary: z.string().optional(),
  }))),
  popularityTotals: z.strictObject({ gains: z.number(), losses: z.number(), net: z.number() }),
  topWrestlerId: z.string(),
  ticksPerWeek: z.number(),
  rises: z.number(),
  falls: z.number(),
  nonMonotonicCount: z.number(),
  rosterSize: z.number(),
  signals: z.strictObject({
    topTierCount: z.number(),
    popularitySpreadStdDev: z.number(),
    rankStability: z.number(),
    skillPopularityCorrelation: z.number(),
    starPowerRunningHotCount: z.number(),
    starPowerSuppressedCount: z.number(),
    unresolvedStoryCount: z.number(),
  }),
});

/**
 * The `slice --json` document: every per-seed analysis plus the cross-seed
 * verdicts, for programmatic diffing between runs. Strict objects on purpose —
 * a new `SliceAnalysis` field that never reaches the dump fails the schema
 * test rather than silently disappearing from the tooling.
 */
export const sliceJsonDumpSchema = z.strictObject({
  scenarioId: z.string(),
  scenarioName: z.string(),
  weeks: z.number(),
  seeds: z.number(),
  runs: z.array(z.strictObject({ seed: z.string(), analysis: sliceAnalysisJsonSchema })),
  crossSeed: criterionSchema,
  volatility: z.strictObject({
    distinctTopActs: z.number(),
    risesRange: z.tuple([z.number(), z.number()]),
    fallsRange: z.tuple([z.number(), z.number()]),
    nonMonotonicShareRange: z.tuple([z.number(), z.number()]),
  }),
});
export type SliceJsonDump = z.infer<typeof sliceJsonDumpSchema>;

export function sliceJsonDump(input: {
  scenarioId: string;
  scenarioName: string;
  weeks: number;
  runs: readonly { seed: string; analysis: SliceAnalysis }[];
  crossSeed: SliceCriterion;
  volatility: CrossSeedSignals;
}): SliceJsonDump {
  // Round-tripping through JSON strips `undefined` optional properties, so the
  // dump matches exactly what a consumer reading the file back will see.
  return sliceJsonDumpSchema.parse(JSON.parse(JSON.stringify({
    scenarioId: input.scenarioId,
    scenarioName: input.scenarioName,
    weeks: input.weeks,
    seeds: input.runs.length,
    runs: input.runs,
    crossSeed: input.crossSeed,
    volatility: input.volatility,
  })));
}
