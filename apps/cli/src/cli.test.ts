import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliContext } from "./context.js";
import { runCli } from "./cli.js";
import { sliceJsonDumpSchema } from "./slice-json.js";
import { loadSave, writeSave } from "./store.js";

let dir: string;
let ctx: CliContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wrestling-cli-test-"));
  ctx = { filePath: join(dir, "save.json"), sliceReportDirectory: join(dir, "slice-reports") };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedSmallWorld(humans = 2): void {
  runCli(["seed", "--scenario", "wwe-2026", "--humans", String(humans), "--seed", "test-seed"], ctx);
}

describe("cli seed", () => {
  it("loads the default scenario with the requested human claims", () => {
    const output = runCli(["seed", "--scenario", "wwe-2026", "--humans", "2", "--seed", "abc"], ctx);
    expect(output).toContain("Seeded WWE 2026");
    expect(output).toContain("44 wrestlers, 2 human-controlled");

    const { world } = loadSave(ctx.filePath);
    expect(world.wrestlers).toHaveLength(44);
    expect(world.wrestlers.filter((w) => w.controlledBy === "human")).toHaveLength(2);
    expect(world.tick).toBe(0);
  });

  it("is deterministic for the same seed", () => {
    runCli(["seed", "--scenario", "wwe-2026", "--seed", "same"], ctx);
    const first = loadSave(ctx.filePath).world;
    runCli(["seed", "--scenario", "wwe-2026", "--seed", "same"], ctx);
    const second = loadSave(ctx.filePath).world;
    expect(second.wrestlers).toEqual(first.wrestlers);
  });

  it("rejects a nonsensical --humans count", () => {
    expect(() => runCli(["seed", "--scenario", "wwe-2026", "--humans", "99"], ctx)).toThrow(/--humans/);
  });
});

describe("cli status", () => {
  it("renders a qualitative career view by default", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers.find((w) => w.controlledBy === "human")!;
    const output = runCli(["status", human.id], ctx);
    expect(output).toContain(human.name);
    expect(output).not.toMatch(/ringPerformance: \d/);
  });

  it("shows raw numbers with --debug", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    const output = runCli(["status", human.id, "--debug"], ctx);
    expect(output).toMatch(/ringPerformance: \d+/);
  });

  it("errors on an unknown wrestler", () => {
    seedSmallWorld();
    expect(() => runCli(["status", "nobody"], ctx)).toThrow(/unknown wrestler/);
  });
});

describe("cli interact / act / stance", () => {
  it("queues an interaction targeting the GM", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    const output = runCli(["interact", human.id, "gm", "request_opportunity"], ctx);
    expect(output).toContain("the GM");

    const { pendingTurns } = loadSave(ctx.filePath);
    expect(pendingTurns[human.id]?.interaction?.intent).toBe("request_opportunity");
  });

  it("queues an interaction targeting another wrestler", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const [a, b] = world.wrestlers;
    runCli(["interact", a!.id, b!.id, "build_trust"], ctx);
    const { pendingTurns } = loadSave(ctx.filePath);
    expect(pendingTurns[a!.id]?.interaction?.target).toEqual({ kind: "wrestler", wrestlerId: b!.id });
  });

  it("rejects an intent invalid for the target kind", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    // build_trust is a wrestler-only intent, not valid toward the GM.
    expect(() => runCli(["interact", human.id, "gm", "build_trust"], ctx)).toThrow();
  });

  it("queues a train_skill action and reports the replacement note on a second call", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    const first = runCli(["act", human.id, "train_skill", "athleticism"], ctx);
    expect(first).not.toContain("replaced");
    const second = runCli(["act", human.id, "train_skill", "toughness"], ctx);
    expect(second).toContain("replaced a previously queued action");

    const { pendingTurns } = loadSave(ctx.filePath);
    const action = pendingTurns[human.id]?.action;
    expect(action?.type).toBe("train_skill");
    if (action?.type === "train_skill") expect(action.skill).toBe("toughness");
  });

  it("rejects an unknown skill name", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    expect(() => runCli(["act", human.id, "train_skill", "not_a_skill"], ctx)).toThrow();
  });

  it("requires at least one field for develop_character", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    expect(() => runCli(["act", human.id, "develop_character"], ctx)).toThrow(/at least one/);
  });

  it("queues a stance change", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    runCli(["stance", human.id, "pursue_championships"], ctx);
    const { pendingTurns } = loadSave(ctx.filePath);
    expect(pendingTurns[human.id]?.stanceChange).toBe("pursue_championships");
  });

  it("rejects an unknown stance token", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    expect(() => runCli(["stance", human.id, "not_a_stance"], ctx)).toThrow();
  });
});

describe("cli tick", () => {
  it("runs a complete 26-week default scenario slice", () => {
    runCli(["seed", "--scenario", "wwe-2026", "--humans", "0", "--seed", "slice-seed"], ctx);
    runCli(["tick", "--count", "78"], ctx);
    expect(loadSave(ctx.filePath).world.tick).toBe(78);
  });

  it("resolves queued turns, advances the tick, and clears pending turns", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    runCli(["act", human.id, "recover"], ctx);

    const output = runCli(["tick"], ctx);
    expect(output).toContain("Tick 0 resolved (now tick 1)");

    const after = loadSave(ctx.filePath);
    expect(after.world.tick).toBe(1);
    expect(Object.keys(after.pendingTurns)).toHaveLength(0);
    expect(after.world.events.length).toBeGreaterThan(0);
  });

  it("supports resolving multiple ticks in one call", () => {
    seedSmallWorld();
    runCli(["tick", "--count", "3"], ctx);
    const { world } = loadSave(ctx.filePath);
    expect(world.tick).toBe(3);
  });

  it("rejects a non-positive --count", () => {
    seedSmallWorld();
    expect(() => runCli(["tick", "--count", "0"], ctx)).toThrow(/--count/);
  });
});

describe("cli slice", () => {
  it("renders a markdown slice report and writes a reviewable HTML report without mutating the saved world", () => {
    const output = runCli(["slice", "--scenario", "wwe-2026", "--seeds", "1", "--weeks", "4"], ctx);
    expect(output).toContain("# Six-month slice validation: WWE 2026");
    expect(output).toContain("HTML report:");
    expect(output).toContain("| SL-1 |");
    expect(output).toContain("### Title lineages");
    expect(output).toContain("| Gained | Lost | Net |");
    expect(output).toContain("### Popularity trajectories");
    expect(output).toContain("### Complete show cards");
    const reportPath = join(ctx.sliceReportDirectory!, "wwe-2026-1-seed-4-weeks.html");
    expect(existsSync(reportPath)).toBe(true);
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("<span>Gained</span>");
    expect(report).toContain("<span>Lost</span>");
    expect(report).toContain("<span>Net</span>");
    expect(report).toContain('data-sort="end"');
    expect(report).toContain('aria-sort="descending"');
    expect(report).toContain("Complete show cards");
    expect(() => loadSave(ctx.filePath)).toThrow(/no saved world/i);
  });

  it("labels beats, program timelines, and booking metrics in both report formats", () => {
    const output = runCli(["slice", "--scenario", "wwe-2026", "--seeds", "1", "--weeks", "4"], ctx);
    expect(output).toContain("### Booking metrics (booking_ai §12)");
    expect(output).toContain("| Unresolved-program backlog |");
    expect(output).toContain("| PLE build coverage |");
    expect(output).toContain("| Beats generated by type |");
    expect(output).toContain("### Program timelines");
    expect(output).toMatch(/- beat promo interview \[escalation 0, segment\]/);
    expect(output).toMatch(/\[beat: promo interview, escalation 0, program-/);
    expect(output).toMatch(/planned focus .+ heat\)/);
    // A 4-week run must not read as failing the 26-week bar.
    expect(output).toContain("26-week criteria; shown for reference on this 4-week run");

    const report = readFileSync(join(ctx.sliceReportDirectory!, "wwe-2026-1-seed-4-weeks.html"), "utf8");
    expect(report).toContain("Booking metrics");
    expect(report).toContain("Program timelines");
    expect(report).toContain("PLE build coverage");
    expect(report).toContain("Planned focus");
    expect(report).toMatch(/<i>promo interview · esc 0<\/i>/);
  });

  it("writes a schema-valid JSON dump that round-trips", () => {
    const jsonPath = join(dir, "slice.json");
    const output = runCli(["slice", "--scenario", "wwe-2026", "--seeds", "2", "--weeks", "4", "--json", jsonPath], ctx);
    expect(output).toContain(`JSON dump: ${jsonPath}`);
    const raw: unknown = JSON.parse(readFileSync(jsonPath, "utf8"));
    const parsed = sliceJsonDumpSchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.weeks).toBe(4);
    const [first] = parsed.runs;
    expect(first!.analysis.criteriaAdvisory).toBe(true);
    expect(first!.analysis.bookingMetrics.programsCreated).toBeGreaterThan(0);
    expect(first!.analysis.programTimelines.length).toBeGreaterThan(0);
    expect(first!.analysis.showCards.some((card) => card.slots.some((slot) => slot.beat !== undefined))).toBe(true);
    expect(first!.analysis.showCards.some((card) => card.bookingTrace !== undefined)).toBe(true);
  });

  it("rejects an unknown slice argument", () => {
    expect(() => runCli(["slice", "--seeds", "1", "--weeks", "2", "--bogus", "x"], ctx)).toThrow(/unexpected argument/);
  });
});

describe("cli sheet", () => {
  it("reports an empty dirt sheet before any ticks", () => {
    seedSmallWorld();
    expect(runCli(["sheet"], ctx)).toMatch(/empty/);
  });

  it("renders events after a tick", () => {
    seedSmallWorld();
    runCli(["tick"], ctx);
    const output = runCli(["sheet"], ctx);
    expect(output).toContain("DIRT SHEET");
    expect(output).toMatch(/\[tick \d+\]/);
  });
});

describe("cli respond", () => {
  it("answers a pending reactive decision", () => {
    seedSmallWorld();
    const save = loadSave(ctx.filePath);
    const human = save.world.wrestlers[0]!;
    save.world.pendingReactiveDecisions.push({
      id: "reactive-1",
      type: "risky_opportunity",
      targetWrestlerId: human.id,
      offeredResponses: ["accept", "refuse"],
      deadlineTick: 5,
      status: "pending",
    });
    writeSave(ctx.filePath, save);

    const output = runCli(["respond", human.id, "reactive-1", "accept"], ctx);
    expect(output).toContain("accept");

    const { pendingTurns } = loadSave(ctx.filePath);
    expect(pendingTurns[human.id]?.reactiveResponses).toEqual([
      { reactiveDecisionId: "reactive-1", response: "accept" },
    ]);
  });

  it("rejects a response not offered by the decision", () => {
    seedSmallWorld();
    const save = loadSave(ctx.filePath);
    const human = save.world.wrestlers[0]!;
    save.world.pendingReactiveDecisions.push({
      id: "reactive-2",
      type: "risky_opportunity",
      targetWrestlerId: human.id,
      offeredResponses: ["accept", "refuse"],
      deadlineTick: 5,
      status: "pending",
    });
    writeSave(ctx.filePath, save);

    expect(() => runCli(["respond", human.id, "reactive-2", "escalate"], ctx)).toThrow(/isn't offered/);
  });

  it("answers a pending proposal, requiring a payload to counter", () => {
    seedSmallWorld();
    const save = loadSave(ctx.filePath);
    const [proposer, recipient] = save.world.wrestlers;
    save.world.pendingProposals.push({
      id: "proposal-1",
      proposerWrestlerId: proposer!.id,
      recipientWrestlerId: recipient!.id,
      originatingIntent: "propose_alliance",
      createdAtTick: 0,
      deadlineTick: 2,
      status: "pending",
    });
    writeSave(ctx.filePath, save);

    expect(() => runCli(["respond", recipient!.id, "proposal-1", "counter"], ctx)).toThrow(/counter/);

    const output = runCli(["respond", recipient!.id, "proposal-1", "counter", "let's", "talk"], ctx);
    expect(output).toContain("counter");

    const { pendingTurns } = loadSave(ctx.filePath);
    expect(pendingTurns[recipient!.id]?.proposalResponses).toEqual([
      { proposalId: "proposal-1", response: "counter", counterPayload: "let's talk" },
    ]);
  });

  it("errors helpfully when nothing matches the given id", () => {
    seedSmallWorld();
    const { world } = loadSave(ctx.filePath);
    const human = world.wrestlers[0]!;
    expect(() => runCli(["respond", human.id, "does-not-exist", "accept"], ctx)).toThrow(/no pending/);
  });
});

describe("cli intent", () => {
  it("sets a match intent for a booked wrestler", () => {
    seedSmallWorld();
    const save = loadSave(ctx.filePath);
    const [a, b] = save.world.wrestlers;
    save.world.shows.push({
      id: "show-1",
      tick: 2,
      kind: "tv",
      card: [{ id: "slot-1", participantWrestlerIds: [a!.id, b!.id], position: "mid", intents: {} }],
    });
    writeSave(ctx.filePath, save);

    const output = runCli(["intent", a!.id, "slot-1", "chase_quality"], ctx);
    expect(output).toContain("chase quality");

    const { pendingTurns } = loadSave(ctx.filePath);
    expect(pendingTurns[a!.id]?.matchIntents).toEqual({ "slot-1": "chase_quality" });
  });

  it("rejects a wrestler not booked in the slot", () => {
    seedSmallWorld();
    const save = loadSave(ctx.filePath);
    const [a, b, c] = save.world.wrestlers;
    save.world.shows.push({
      id: "show-1",
      tick: 2,
      kind: "tv",
      card: [{ id: "slot-1", participantWrestlerIds: [a!.id, b!.id], position: "mid", intents: {} }],
    });
    writeSave(ctx.filePath, save);

    expect(() => runCli(["intent", c!.id, "slot-1", "chase_quality"], ctx)).toThrow(/isn't booked/);
  });
});

describe("cli help / unknown command", () => {
  it("prints usage with no command", () => {
    expect(runCli([], ctx)).toContain("Commands:");
  });

  it("throws on an unknown command", () => {
    expect(() => runCli(["bogus"], ctx)).toThrow(/unknown command/);
  });
});
