import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSlice, crossSeedCriterion, crossSeedSignals, runHeadlessSlice, SIGNAL_DESCRIPTIONS, worldFromScenario, type SliceAnalysis } from "@wrestling/sim";
import { extractOption, parsePositiveInt } from "../args.js";
import type { CliContext } from "../context.js";
import { loadScenario } from "../scenario.js";
import { renderSliceHtmlReport } from "../slice-report.js";

const SPARKS = "▁▂▃▄▅▆▇█";

function sparkline(values: readonly number[]): string {
  if (values.length === 0) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return SPARKS[0]!.repeat(values.length);
  return values.map((value) => SPARKS[Math.round(((value - low) / (high - low)) * (SPARKS.length - 1))]!).join("");
}

function wrestlerName(analysis: SliceAnalysis, id: string): string {
  return analysis.trajectories.find((trajectory) => trajectory.wrestlerId === id)?.wrestlerName ?? id;
}

function week(analysis: SliceAnalysis, tick: number): number {
  return Math.floor(tick / analysis.ticksPerWeek) + 1;
}

function criteriaTable(criteria: readonly { id: string; strength: string; pass: boolean; observed: string; detail?: string }[]): string[] {
  return [
    "| Criterion | Strength | Result | Observed |",
    "| --- | --- | --- | --- |",
    ...criteria.map((criterion) => `| ${criterion.id} | ${criterion.strength} | ${criterion.pass ? "PASS" : "FAIL"} | ${criterion.observed}${criterion.detail ? `<br>${criterion.detail}` : ""} |`),
  ];
}

function signalsTable(signals: SliceAnalysis["signals"]): string[] {
  const rows: Array<[string, number | string, keyof typeof SIGNAL_DESCRIPTIONS]> = [
    ["Top-tier count (88+)", signals.topTierCount, "topTierCount"],
    ["Popularity spread (stdev)", signals.popularitySpreadStdDev.toFixed(1), "popularitySpreadStdDev"],
    ["Rank stability", signals.rankStability.toFixed(2), "rankStability"],
    ["Skill/popularity correlation", signals.skillPopularityCorrelation.toFixed(2), "skillPopularityCorrelation"],
    ["Running hot (near ceiling)", signals.starPowerRunningHotCount, "starPowerRunningHotCount"],
    ["Suppressed (well under status)", signals.starPowerSuppressedCount, "starPowerSuppressedCount"],
    ["Unresolved stories", signals.unresolvedStoryCount, "unresolvedStoryCount"],
  ];
  return [
    "| Signal | Value | What it means |",
    "| --- | ---: | --- |",
    ...rows.map(([label, value, key]) => `| ${label} | ${value} | ${SIGNAL_DESCRIPTIONS[key]} |`),
  ];
}

function seedReport(seed: string, analysis: SliceAnalysis): string[] {
  const lines = [
    `## Seed: \`${seed}\``, "", ...criteriaTable(analysis.criteria), "",
    "### Signals (advisory — not gates)", "", ...signalsTable(analysis.signals), "",
    "### Title lineages",
  ];
  for (const lineage of analysis.titleLineages) {
    const initial = lineage.initialHolderId ? wrestlerName(analysis, lineage.initialHolderId) : "vacant";
    const changes = lineage.changes.map((change) => {
      const label = change.defended ? "def." : "won by";
      return `week ${week(analysis, change.tick)}: ${label} ${wrestlerName(analysis, change.holderId)}`;
    });
    lines.push(`- ${lineage.titleName}: started with ${initial}${changes.length > 0 ? `; ${changes.join("; ")}` : "; no recorded title matches"}.`);
  }
  lines.push("", "### Story timelines");
  if (analysis.stories.length === 0) lines.push("- No stories started or resolved.");
  for (const story of analysis.stories) {
    const participants = story.participants.map((id) => wrestlerName(analysis, id)).join(" vs. ");
    const start = story.startTick === undefined ? "seeded" : `week ${week(analysis, story.startTick)}`;
    const end = story.resolveTick === undefined ? "still active" : `week ${week(analysis, story.resolveTick)}${story.resolvedAtPle ? " (PLE blowoff)" : ""}`;
    lines.push(`- ${participants}: ${start} → ${end}. ${story.description}`);
  }
  lines.push("", "### PLE cards");
  for (const card of analysis.pleCards) {
    lines.push(`- Week ${card.week}: ${card.matches.map((match) => `${match.position.replace(/_/g, " ")} — ${match.participants.map((id) => wrestlerName(analysis, id)).join(" vs. ")}${match.titleId ? " [title]" : ""}${match.storyId ? " [story]" : ""}`).join("; ")}`);
  }
  lines.push("", "### Complete show cards");
  for (const card of analysis.showCards) {
    const slots = card.slots.map((slot) => {
      const participants = slot.participants.map((id) => wrestlerName(analysis, id)).join(slot.kind === "match" ? " vs. " : " / ");
      const outcome = slot.kind === "segment"
        ? `${slot.dominantWrestlerId ? `; dominant: ${wrestlerName(analysis, slot.dominantWrestlerId)}` : ""}${slot.heatDeltas ? `; heat: ${slot.heatDeltas.map((delta) => `${wrestlerName(analysis, delta.wrestlerId)} +${delta.positive}/-${delta.negative}`).join(", ")}` : ""}`
        : slot.winnerWrestlerId ? `; winner: ${wrestlerName(analysis, slot.winnerWrestlerId)}` : "";
      return `${slot.position.replace(/_/g, " ")} ${slot.kind} — ${participants}${slot.storyId ? " [story]" : ""}${slot.titleId ? " [title]" : ""}${outcome}`;
    });
    lines.push(`- Week ${card.week} ${card.kind.toUpperCase()}: ${slots.join("; ")}`);
  }
  lines.push("", "### Injury and return arcs");
  if (analysis.injuryArcs.length === 0) lines.push("- No injury-related events.");
  for (const arc of analysis.injuryArcs) {
    lines.push(`- ${wrestlerName(analysis, arc.wrestlerId)}: injuries ${arc.injuryTicks.map((tick) => week(analysis, tick)).join(", ") || "none"}; missed shows ${arc.missedShowTicks.map((tick) => week(analysis, tick)).join(", ") || "none"}; returns ${arc.returnTicks.map((tick) => week(analysis, tick)).join(", ") || "none"}.`);
  }
  const { gains, losses, net } = analysis.popularityTotals;
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
  lines.push(
    "", "### Popularity quick stats", "",
    "| Gained | Lost | Net |", "| ---: | ---: | ---: |",
    `| ${signed(gains)} | ${signed(losses)} | ${signed(net)} |`,
    "", "### Popularity trajectories", "", "| Wrestler | Start | End | Weekly trajectory |", "| --- | ---: | ---: | --- |",
  );
  for (const trajectory of analysis.trajectories.slice().sort((a, b) => b.end - a.end)) {
    lines.push(`| ${trajectory.wrestlerName} | ${trajectory.start} | ${trajectory.end} | ${sparkline(trajectory.samples)} |`);
  }
  return lines;
}

/** Run the Phase 3.7 validation harness without creating or mutating a save file. */
export function runSlice(args: readonly string[], ctx: CliContext): string {
  const scenarioOption = extractOption(args, "scenario");
  const seedOption = extractOption(scenarioOption.rest, "seeds");
  const weekOption = extractOption(seedOption.rest, "weeks");
  const reportOption = extractOption(weekOption.rest, "report");
  if (reportOption.rest.length > 0) throw new Error(`slice: unexpected argument "${reportOption.rest[0]}"`);
  const scenarioId = scenarioOption.value ?? "wwe-2026";
  const seedCount = parsePositiveInt(seedOption.value, 3, "seeds");
  const scenario = loadScenario(scenarioId, ctx.dataRoot);
  const weeks = parsePositiveInt(weekOption.value, scenario.config.sliceWeeks, "weeks");
  const analyses = Array.from({ length: seedCount }, (_, index) => {
    const seed = `slice-${scenarioId}-${index + 1}`;
    return { seed, analysis: analyzeSlice(runHeadlessSlice(worldFromScenario(scenario, seed), seed, weeks)) };
  });
  const crossSeed = crossSeedCriterion(analyses.map(({ analysis }) => analysis));
  const volatility = crossSeedSignals(analyses.map(({ analysis }) => analysis));
  const mustPass = analyses.every(({ analysis }) => analysis.criteria.filter((criterion) => criterion.strength === "MUST").every((criterion) => criterion.pass));
  const shouldPass = analyses.filter(({ analysis }) => analysis.criteria
    .filter((criterion) => criterion.shouldPass !== undefined)
    .every((criterion) => criterion.shouldPass)).length;
  const defaultReportName = `${scenarioId}-${seedCount}-seed${seedCount === 1 ? "" : "s"}-${weeks}-weeks.html`;
  const reportPath = reportOption.value
    ? resolve(reportOption.value)
    : resolve(ctx.sliceReportDirectory ?? fileURLToPath(new URL("../../../../artifacts/slice-reports", import.meta.url)), defaultReportName);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderSliceHtmlReport({
    scenarioName: scenario.manifest.name,
    scenarioId,
    weeks,
    runs: analyses,
    crossSeed,
    volatility,
  }), "utf8");
  const lines = [
    `# Six-month slice validation: ${scenario.manifest.name}`,
    "",
    `Runs: ${seedCount}; weeks per run: ${weeks}; humans: 0.`,
    `HTML report: ${reportPath}`,
    "",
    "## Combined signals (advisory — not gates; use these to decide whether to retune)",
    "",
    ...criteriaTable([crossSeed]),
    "",
    `MUST criteria across every seed: ${mustPass ? "all pass" : "some below threshold"}.`,
    `Within-seed SHOULD criteria met on ${shouldPass}/${seedCount} seed(s); SL-10: ${crossSeed.pass ? "PASS" : "FAIL"}.`,
    `Cross-seed volatility — rises ${volatility.risesRange.join("-")}, falls ${volatility.fallsRange.join("-")}, non-monotonic share ${volatility.nonMonotonicShareRange.map((v) => `${Math.round(v * 100)}%`).join("-")}.`,
    "",
    ...analyses.flatMap(({ seed, analysis }) => ["", ...seedReport(seed, analysis)]),
  ];
  return lines.join("\n");
}
