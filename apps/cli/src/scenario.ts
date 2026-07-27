import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configFileSchema,
  promotionSchema,
  relationshipsFileSchema,
  rosterFileSchema,
  scenarioManifestSchema,
  scenarioSchema,
  storiesFileSchema,
  titlesFileSchema,
  type Scenario,
} from "@wrestling/contracts";
import type { z } from "zod";

const SCENARIO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_DATA_ROOT = resolve(fileURLToPath(new URL("../../../data", import.meta.url)));

function issueMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

function crossFileIssueMessage(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const [fileKey, ...path] = issue.path;
    const filename = typeof fileKey === "string" ? `${fileKey === "manifest" ? "scenario" : fileKey}.json` : "scenario";
    return `${filename}:${path.join(".") || "<root>"}: ${issue.message}`;
  }).join("; ");
}

function readJsonFile<T extends z.ZodTypeAny>(directory: string, filename: string, schema: T): z.infer<T> {
  const path = resolve(directory, filename);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`scenario ${filename}: ${detail}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`scenario ${filename}: ${issueMessage(result.error)}`);
  return result.data;
}

/** Reads and validates a complete data/<scenario-id> directory. */
export function loadScenario(scenarioId: string, dataRoot = DEFAULT_DATA_ROOT): Scenario {
  if (!SCENARIO_ID.test(scenarioId)) throw new Error("--scenario must be a kebab-case scenario id");
  const directory = resolve(dataRoot, scenarioId);
  const manifest = readJsonFile(directory, "scenario.json", scenarioManifestSchema);
  if (manifest.id !== scenarioId) {
    throw new Error(`scenario scenario.json: id "${manifest.id}" does not match requested scenario "${scenarioId}"`);
  }

  const result = scenarioSchema.safeParse({
    manifest,
    promotion: readJsonFile(directory, "promotion.json", promotionSchema),
    roster: readJsonFile(directory, "roster.json", rosterFileSchema),
    titles: readJsonFile(directory, "titles.json", titlesFileSchema),
    relationships: readJsonFile(directory, "relationships.json", relationshipsFileSchema),
    stories: existsSync(resolve(directory, "stories.json"))
      ? readJsonFile(directory, "stories.json", storiesFileSchema)
      : storiesFileSchema.parse([]),
    config: readJsonFile(directory, "config.json", configFileSchema),
  });
  if (!result.success) throw new Error(`scenario ${scenarioId}: ${crossFileIssueMessage(result.error)}`);
  return result.data;
}
