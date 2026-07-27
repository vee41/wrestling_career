import { z } from "zod";
import { worldConfigSchema } from "./config.js";
import { idSchema } from "./common.js";
import { popularityBlockSchema } from "./popularity.js";
import { relationshipSchema } from "./relationship.js";
import { wrestlerStanceSchema } from "./stance.js";
import { storySchema } from "./story.js";
import { titleSchema } from "./title.js";
import { wrestlerSchema } from "./wrestler.js";

/** Stable scenario manifest stored in data/<scenario-id>/scenario.json. */
export const scenarioManifestSchema = z.object({
  id: idSchema.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "scenario id must be kebab-case"),
  name: z.string().min(1),
  description: z.string().min(1),
  formatVersion: z.literal(1),
});
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

/** Promotion identity and the ordered PLE names that the calendar cycles through. */
export const promotionSchema = z.object({
  name: z.string().min(1),
  identityBlurb: z.string().min(1),
  weeklyTvShowName: z.string().min(1),
  pleCalendar: z.array(z.string().min(1)).min(1),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const scenarioRosterEntrySchema = z.object({
  wrestler: wrestlerSchema.omit({ controlledBy: true }),
  popularity: popularityBlockSchema,
  stance: wrestlerStanceSchema.omit({ wrestlerId: true, pendingStance: true }).shape.stance,
});
export type ScenarioRosterEntry = z.infer<typeof scenarioRosterEntrySchema>;
export const rosterFileSchema = z.array(scenarioRosterEntrySchema).min(2);

export const scenarioTitleSchema = titleSchema.omit({ holderId: true, since: true }).extend({
  initialHolderId: idSchema.optional(),
  reignStartNote: z.string().min(1).optional(),
});
export type ScenarioTitle = z.infer<typeof scenarioTitleSchema>;
export const titlesFileSchema = z.array(scenarioTitleSchema).min(2);
export const relationshipsFileSchema = z.array(relationshipSchema);
export const storiesFileSchema = z.array(storySchema);
export const configFileSchema = worldConfigSchema;

/** Parsed contents of every file in a scenario directory. */
export const scenarioSchema = z.object({
  manifest: scenarioManifestSchema,
  promotion: promotionSchema,
  roster: rosterFileSchema,
  titles: titlesFileSchema,
  relationships: relationshipsFileSchema,
  stories: storiesFileSchema,
  config: configFileSchema,
}).superRefine((scenario, ctx) => {
  const rosterIds = new Set(scenario.roster.map(({ wrestler }) => wrestler.id));
  const titleIds = new Set(scenario.titles.map((title) => title.id));

  if (rosterIds.size !== scenario.roster.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "roster wrestler ids must be unique", path: ["roster"] });
  }
  if (titleIds.size !== scenario.titles.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "title ids must be unique", path: ["titles"] });
  }

  const requireRosterId = (id: string, path: (string | number)[]) => {
    if (!rosterIds.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `references unknown roster id "${id}"`, path });
    }
  };

  scenario.roster.forEach(({ wrestler, popularity }, index) => {
    if (popularity.wrestlerId !== wrestler.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "popularity.wrestlerId must match the roster wrestler id",
        path: ["roster", index, "popularity", "wrestlerId"],
      });
    }
  });
  scenario.titles.forEach((title, index) => {
    if (title.initialHolderId !== undefined) requireRosterId(title.initialHolderId, ["titles", index, "initialHolderId"]);
  });
  scenario.relationships.forEach((relationship, index) => {
    requireRosterId(relationship.fromWrestlerId, ["relationships", index, "fromWrestlerId"]);
    requireRosterId(relationship.toWrestlerId, ["relationships", index, "toWrestlerId"]);
  });
  scenario.stories.forEach((story, index) => {
    story.participantWrestlerIds.forEach((id, participantIndex) =>
      requireRosterId(id, ["stories", index, "participantWrestlerIds", participantIndex]),
    );
  });
});
export type Scenario = z.infer<typeof scenarioSchema>;
