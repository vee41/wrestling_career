import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, tickSchema } from "./common.js";
import { wrestlerSchema } from "./wrestler.js";
import { popularityBlockSchema } from "./popularity.js";
import { relationshipSchema } from "./relationship.js";
import { storySchema } from "./story.js";
import { programPlanCandidateSchema, programPlanSchema } from "./program-plan.js";
import { plannedBeatSchema } from "./planned-beat.js";
import { gmObjectiveSchema, showSchema } from "./show.js";
import { matchResultSchema, segmentResultSchema } from "./match.js";
import { worldEventSchema } from "./events.js";
import { narrativeJobSchema, narrativeResultSchema } from "./narrative.js";
import { wrestlerStanceSchema } from "./stance.js";
import { proposalSchema } from "./proposal.js";
import { reactiveDecisionSchema } from "./reactive.js";
import { titleSchema } from "./title.js";
import { worldConfigSchema } from "./config.js";
import { promotionSchema } from "./scenario.js";

export const worldStateSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    tick: tickSchema,
    seed: z.string().min(1),
    promotion: promotionSchema,
    config: worldConfigSchema,
    wrestlers: z.array(wrestlerSchema),
    popularity: z.array(popularityBlockSchema),
    relationships: z.array(relationshipSchema),
    stories: z.array(storySchema),
    /** Private GM creative intent. Never use this directly in player projections. */
    programPlans: z.array(programPlanSchema),
    /** Private planner audit trail, including valid losers and hard-invalid candidates. */
    programPlanCandidates: z.array(programPlanCandidateSchema),
    /** Private, inspectable creative progression owned by program plans. */
    plannedBeats: z.array(plannedBeatSchema).default([]),
    shows: z.array(showSchema),
    matchResults: z.array(matchResultSchema),
    segmentResults: z.array(segmentResultSchema),
    events: z.array(worldEventSchema),
    narrativeJobs: z.array(narrativeJobSchema),
    narrativeResults: z.array(narrativeResultSchema),
    gmObjective: gmObjectiveSchema,
    gmObjectiveSince: tickSchema,
    // Phase 3.9 keeps the old card-filler heuristic isolated while private
    // program objectives settle over a full PLE cycle. Phase 3.12 replaces it.
    bookingObjective: gmObjectiveSchema,
    bookingObjectiveSince: tickSchema,
    // Championship lineage is derived from title_change events; this is the
    // current title table for booking and status views.
    titles: z.array(titleSchema).min(2),
    stances: z.array(wrestlerStanceSchema),
    pendingProposals: z.array(proposalSchema),
    pendingReactiveDecisions: z.array(reactiveDecisionSchema),
  })
  .superRefine((world, ctx) => {
    const wrestlerIds = new Set(world.wrestlers.map((w) => w.id));
    const storyIds = new Set(world.stories.map((s) => s.id));
    const titleIds = new Set(world.titles.map((t) => t.id));
    const showIds = new Set(world.shows.map((s) => s.id));
    const matchIds = new Set([
      ...world.shows.flatMap((show) => show.card.map((slot) => slot.id)),
      ...world.matchResults.map((m) => m.id),
      ...world.segmentResults.map((s) => s.id),
    ]);

    const requireKnownWrestler = (id: string, path: (string | number)[]) => {
      if (!wrestlerIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `references unknown wrestler id "${id}"`,
          path,
        });
      }
    };

    const popularityWrestlerIds = world.popularity.map((p) => p.wrestlerId);
    if (new Set(popularityWrestlerIds).size !== wrestlerIds.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "every wrestler must have exactly one popularity block, with no orphans",
        path: ["popularity"],
      });
    }
    popularityWrestlerIds.forEach((id, i) => requireKnownWrestler(id, ["popularity", i, "wrestlerId"]));

    world.relationships.forEach((r, i) => {
      requireKnownWrestler(r.fromWrestlerId, ["relationships", i, "fromWrestlerId"]);
      requireKnownWrestler(r.toWrestlerId, ["relationships", i, "toWrestlerId"]);
    });

    world.stories.forEach((s, i) => {
      s.participantWrestlerIds.forEach((id, j) =>
        requireKnownWrestler(id, ["stories", i, "participantWrestlerIds", j]),
      );
    });

    const planIds = new Set(world.programPlans.map((plan) => plan.id));
    const beatIds = new Set(world.plannedBeats.map((beat) => beat.id));
    if (beatIds.size !== world.plannedBeats.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "planned beat ids must be unique", path: ["plannedBeats"] });
    }
    if (planIds.size !== world.programPlans.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "program plan ids must be unique", path: ["programPlans"] });
    }
    const activePlanStoryIds = world.programPlans
      .filter((plan) => plan.status === "active" || plan.status === "payoff_ready")
      .map((plan) => plan.storyId);
    if (new Set(activePlanStoryIds).size !== activePlanStoryIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only one active program plan may exist per story", path: ["programPlans"] });
    }
    world.programPlans.forEach((plan, i) => {
      if (!storyIds.has(plan.storyId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown story id "${plan.storyId}"`, path: ["programPlans", i, "storyId"] });
      }
      if (plan.stakesTitleId !== undefined && !titleIds.has(plan.stakesTitleId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown title id "${plan.stakesTitleId}"`, path: ["programPlans", i, "stakesTitleId"] });
      }
      if (plan.targetShowId !== undefined && !showIds.has(plan.targetShowId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown show id "${plan.targetShowId}"`, path: ["programPlans", i, "targetShowId"] });
      }
      plan.participants.forEach((participant, j) => requireKnownWrestler(participant.wrestlerId, ["programPlans", i, "participants", j, "wrestlerId"]));
      plan.protectedWrestlerIds.forEach((id, j) => requireKnownWrestler(id, ["programPlans", i, "protectedWrestlerIds", j]));
      plan.revisions.forEach((revision, j) => {
        for (const snapshot of [revision.previousIntent, revision.newIntent]) {
          if (snapshot?.stakesTitleId !== undefined && !titleIds.has(snapshot.stakesTitleId)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown title id "${snapshot.stakesTitleId}"`, path: ["programPlans", i, "revisions", j] });
          }
          snapshot?.protectedWrestlerIds.forEach((id, k) => requireKnownWrestler(id, ["programPlans", i, "revisions", j, "protectedWrestlerIds", k]));
        }
      });
      // A plan whose payoff window has passed must have extended, resolved, or
      // been abandoned before the tick ended. An open plan pointing at a tick
      // in the past is the zombie state Phase 3.12.3 removed.
      if ((plan.status === "active" || plan.status === "payoff_ready") && plan.targetPayoffTick < world.tick) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an open program plan must not target a payoff tick in the past", path: ["programPlans", i, "targetPayoffTick"] });
      }
      for (const beatId of [...plan.plannedBeatIds, ...plan.completedBeatIds]) {
        if (!beatIds.has(beatId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown planned beat id "${beatId}"`, path: ["programPlans", i] });
      }
    });
    world.plannedBeats.forEach((beat, i) => {
      if (!planIds.has(beat.programId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown program plan id "${beat.programId}"`, path: ["plannedBeats", i, "programId"] });
      [...beat.requiredParticipantWrestlerIds, ...beat.optionalParticipantWrestlerIds].forEach((id, j) => requireKnownWrestler(id, ["plannedBeats", i, "participants", j]));
      beat.preconditions.requiredResolvedBeatIds.forEach((id, j) => {
        if (!beatIds.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown planned beat id "${id}"`, path: ["plannedBeats", i, "preconditions", "requiredResolvedBeatIds", j] });
      });
    });
    world.programPlanCandidates.forEach((candidate, i) => {
      if (!storyIds.has(candidate.storyId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown story id "${candidate.storyId}"`, path: ["programPlanCandidates", i, "storyId"] });
      candidate.participantWrestlerIds.forEach((id, j) => requireKnownWrestler(id, ["programPlanCandidates", i, "participantWrestlerIds", j]));
      if (candidate.selectedPlanId !== undefined && !planIds.has(candidate.selectedPlanId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown program plan id "${candidate.selectedPlanId}"`, path: ["programPlanCandidates", i, "selectedPlanId"] });
      }
    });

    world.shows.forEach((show, i) => {
      show.card.forEach((slot, j) => {
        slot.participantWrestlerIds.forEach((id, k) =>
          requireKnownWrestler(id, ["shows", i, "card", j, "participantWrestlerIds", k]),
        );
        if (slot.storyId !== undefined && !storyIds.has(slot.storyId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `references unknown story id "${slot.storyId}"`,
            path: ["shows", i, "card", j, "storyId"],
          });
        }
        if (slot.programId !== undefined && !planIds.has(slot.programId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown program plan id "${slot.programId}"`, path: ["shows", i, "card", j, "programId"] });
        if (slot.plannedBeatId !== undefined && !beatIds.has(slot.plannedBeatId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown planned beat id "${slot.plannedBeatId}"`, path: ["shows", i, "card", j, "plannedBeatId"] });
        if (slot.plannedBeatId !== undefined) {
          const beat = world.plannedBeats.find((candidate) => candidate.id === slot.plannedBeatId);
          if (slot.programId !== beat?.programId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "planned beat slot must reference its owning program", path: ["shows", i, "card", j] });
        }
        if (slot.kind === "match" && slot.titleId !== undefined && !titleIds.has(slot.titleId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `references unknown title id "${slot.titleId}"`,
            path: ["shows", i, "card", j, "titleId"],
          });
        }
      });
    });

    world.matchResults.forEach((m, i) => {
      if (!showIds.has(m.showId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `references unknown show id "${m.showId}"`,
          path: ["matchResults", i, "showId"],
        });
      }
      m.participantWrestlerIds.forEach((id, j) =>
        requireKnownWrestler(id, ["matchResults", i, "participantWrestlerIds", j]),
      );
      if (m.storyId !== undefined && !storyIds.has(m.storyId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `references unknown story id "${m.storyId}"`,
          path: ["matchResults", i, "storyId"],
        });
      }
      if (m.programId !== undefined && !planIds.has(m.programId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown program plan id "${m.programId}"`, path: ["matchResults", i, "programId"] });
      if (m.plannedBeatId !== undefined && !beatIds.has(m.plannedBeatId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown planned beat id "${m.plannedBeatId}"`, path: ["matchResults", i, "plannedBeatId"] });
      if (m.plannedBeatId !== undefined && m.programId !== world.plannedBeats.find((beat) => beat.id === m.plannedBeatId)?.programId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "planned beat result must reference its owning program", path: ["matchResults", i] });
    });

    world.segmentResults.forEach((segment, i) => {
      if (!showIds.has(segment.showId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown show id "${segment.showId}"`, path: ["segmentResults", i, "showId"] });
      }
      segment.participantWrestlerIds.forEach((id, j) => requireKnownWrestler(id, ["segmentResults", i, "participantWrestlerIds", j]));
      if (segment.storyId !== undefined && !storyIds.has(segment.storyId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown story id "${segment.storyId}"`, path: ["segmentResults", i, "storyId"] });
      }
      if (segment.programId !== undefined && !planIds.has(segment.programId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown program plan id "${segment.programId}"`, path: ["segmentResults", i, "programId"] });
      if (segment.plannedBeatId !== undefined && !beatIds.has(segment.plannedBeatId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown planned beat id "${segment.plannedBeatId}"`, path: ["segmentResults", i, "plannedBeatId"] });
      if (segment.plannedBeatId !== undefined && segment.programId !== world.plannedBeats.find((beat) => beat.id === segment.plannedBeatId)?.programId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "planned beat result must reference its owning program", path: ["segmentResults", i] });
    });

    world.events.forEach((e, i) => {
      e.wrestlerIds.forEach((id, j) => requireKnownWrestler(id, ["events", i, "wrestlerIds", j]));
    });

    if (titleIds.size !== world.titles.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "title ids must be unique", path: ["titles"] });
    }
    world.titles.forEach((title, i) => {
      if (title.holderId !== undefined) requireKnownWrestler(title.holderId, ["titles", i, "holderId"]);
    });

    const stanceWrestlerIds = world.stances.map((s) => s.wrestlerId);
    if (new Set(stanceWrestlerIds).size !== wrestlerIds.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "every wrestler must have exactly one stance entry, with no orphans",
        path: ["stances"],
      });
    }
    stanceWrestlerIds.forEach((id, i) => requireKnownWrestler(id, ["stances", i, "wrestlerId"]));

    world.pendingProposals.forEach((p, i) => {
      requireKnownWrestler(p.proposerWrestlerId, ["pendingProposals", i, "proposerWrestlerId"]);
      requireKnownWrestler(p.recipientWrestlerId, ["pendingProposals", i, "recipientWrestlerId"]);
      // Resolved proposals leave this collection (they live on as world
      // events); the pending list may only ever hold pending items.
      if (p.status !== "pending") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `pendingProposals may only contain pending proposals, found status "${p.status}"`,
          path: ["pendingProposals", i, "status"],
        });
      }
    });

    world.pendingReactiveDecisions.forEach((d, i) => {
      requireKnownWrestler(d.targetWrestlerId, ["pendingReactiveDecisions", i, "targetWrestlerId"]);
      if (d.status !== "pending") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `pendingReactiveDecisions may only contain pending decisions, found status "${d.status}"`,
          path: ["pendingReactiveDecisions", i, "status"],
        });
      }
      if (d.originWrestlerId !== undefined) {
        requireKnownWrestler(d.originWrestlerId, ["pendingReactiveDecisions", i, "originWrestlerId"]);
      }
      if (d.originStoryId !== undefined && !storyIds.has(d.originStoryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `references unknown story id "${d.originStoryId}"`,
          path: ["pendingReactiveDecisions", i, "originStoryId"],
        });
      }
      if (d.originMatchId !== undefined && !matchIds.has(d.originMatchId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `references unknown match id "${d.originMatchId}"`,
          path: ["pendingReactiveDecisions", i, "originMatchId"],
        });
      }
    });
  });
export type WorldState = z.infer<typeof worldStateSchema>;
