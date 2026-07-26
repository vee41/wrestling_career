import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, tickSchema } from "./common.js";
import { wrestlerSchema } from "./wrestler.js";
import { popularityBlockSchema } from "./popularity.js";
import { relationshipSchema } from "./relationship.js";
import { storySchema } from "./story.js";
import { gmObjectiveSchema, showSchema } from "./show.js";
import { matchResultSchema } from "./match.js";
import { worldEventSchema } from "./events.js";
import { narrativeJobSchema, narrativeResultSchema } from "./narrative.js";
import { wrestlerStanceSchema } from "./stance.js";
import { proposalSchema } from "./proposal.js";
import { reactiveDecisionSchema } from "./reactive.js";

export const worldStateSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    tick: tickSchema,
    seed: z.string().min(1),
    wrestlers: z.array(wrestlerSchema),
    popularity: z.array(popularityBlockSchema),
    relationships: z.array(relationshipSchema),
    stories: z.array(storySchema),
    shows: z.array(showSchema),
    matchResults: z.array(matchResultSchema),
    events: z.array(worldEventSchema),
    narrativeJobs: z.array(narrativeJobSchema),
    narrativeResults: z.array(narrativeResultSchema),
    gmObjective: gmObjectiveSchema,
    gmObjectiveSince: tickSchema,
    stances: z.array(wrestlerStanceSchema),
    pendingProposals: z.array(proposalSchema),
    pendingReactiveDecisions: z.array(reactiveDecisionSchema),
  })
  .superRefine((world, ctx) => {
    const wrestlerIds = new Set(world.wrestlers.map((w) => w.id));
    const storyIds = new Set(world.stories.map((s) => s.id));
    const showIds = new Set(world.shows.map((s) => s.id));
    const matchIds = new Set([
      ...world.shows.flatMap((show) => show.card.map((slot) => slot.id)),
      ...world.matchResults.map((m) => m.id),
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
    });

    world.events.forEach((e, i) => {
      e.wrestlerIds.forEach((id, j) => requireKnownWrestler(id, ["events", i, "wrestlerIds", j]));
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
