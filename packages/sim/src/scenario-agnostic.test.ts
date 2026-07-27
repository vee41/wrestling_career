import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("scenario agnosticism", () => {
  it("keeps WWE dataset names out of package implementation source", () => {
    const packagesDirectory = fileURLToPath(new URL("../../", import.meta.url));
    const dataDirectory = fileURLToPath(new URL("../../../data/wwe-2026/", import.meta.url));
    const roster = JSON.parse(readFileSync(join(dataDirectory, "roster.json"), "utf8")) as Array<{ wrestler: { name: string } }>;
    const titles = JSON.parse(readFileSync(join(dataDirectory, "titles.json"), "utf8")) as Array<{ name: string }>;
    const source = sourceFiles(packagesDirectory).map((path) => readFileSync(path, "utf8")).join("\n");

    for (const name of [...roster.map((entry) => entry.wrestler.name), ...titles.map((title) => title.name)]) {
      expect(source).not.toContain(name);
    }
  });
});
