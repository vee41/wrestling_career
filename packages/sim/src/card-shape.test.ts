import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CardPosition, Show, Story, WorldState } from "@wrestling/contracts";
import { bookShow } from "./gm.js";
import { createIdFactory } from "./ids.js";
import { planPrograms } from "./program-plans.js";
import { createRng } from "./rng.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { worldFromScenario } from "./scenario.js";
import { runHeadlessSlice } from "./slice.js";
import { analyzeBooking } from "./booking-metrics.js";
import { rotationForm } from "./form.js";
import { isGoHomeShowTick } from "./booking.js";
import type { TickContext } from "./context.js";

function context(tick: number): TickContext {
  return { tick, rng: createRng(`card-shape:${tick}`), ids: createIdFactory(tick), events: [] };
}

function story(id: string, participants: [string, string], interest: number): Story {
  return {
    id, participantWrestlerIds: participants, tension: "grudge",
    tensionDescription: "A personal score to settle", stakes: "pride", audienceInterest: interest,
    momentum: 20, coherence: 80, phase: "building", unresolvedDevelopments: [],
  };
}

/** A roster with one hot program running, i.e. a card with something to say. */
function worldWithProgram(interest: number): WorldState {
  const world = createTestWorld({ wrestlerCount: 12, humanCount: 0, seed: "card-shape" });
  world.stories = [story("hot-program", ["wrestler-0", "wrestler-1"], interest)];
  planPrograms(world, context(0));
  return world;
}

/**
 * The card-shape question in its purest form: an angle and a match with
 * comparable heat, competing for the same show. The angle is the hotter of the
 * two on raw heat, so only the main-event match bias can decide the close.
 */
function worldWithAngleAndMatch(): WorldState {
  const world = worldWithProgram(70);
  // A story with no program of its own reaches the card through the story
  // pass; with the segment roll off, it books as a match.
  world.config.booking.segmentChance = 0;
  world.stories.push(story("rival-match", ["wrestler-2", "wrestler-3"], 60));
  return world;
}

const DISTINGUISHED: CardPosition[] = ["main_event", "opener", "upper"];

function implementationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return implementationFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("card shape", () => {
  it("closes a television show on a match while keeping a segment elsewhere on the card", () => {
    const show = bookShow(worldWithAngleAndMatch(), context(1), 2);
    const main = show.card.find((slot) => slot.position === "main_event")!;
    expect(show.kind).toBe("tv");
    expect(main.kind).not.toBe("segment");
    // The rule is about the *close*, not about banning angles: the program's
    // own promo beat still airs, just not last.
    const segments = show.card.filter((slot) => slot.kind === "segment");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((slot) => slot.position !== "main_event")).toBe(true);
  });

  it("still lets a hotter angle close the show, because the match bias is additive", () => {
    // The same card with the bias switched off puts the angle back on top, so
    // it is the knob deciding between comparable attractions rather than a
    // hard "television main-events matches" rule.
    const world = worldWithAngleAndMatch();
    world.config.booking.tvMainEventMatchBias = 0;
    const show = bookShow(world, context(1), 2);
    expect(show.card.find((slot) => slot.position === "main_event")!.kind).toBe("segment");
  });

  it("does not put a program in the same distinguished position on consecutive shows", () => {
    const world = worldWithProgram(90);
    const first = bookShow(world, context(1), 2);
    const held = first.card.find((slot) => slot.programId !== undefined && slot.position === "main_event");
    expect(held).toBeDefined();
    // Nothing else on this card is remotely as hot, so without the penalty the
    // program keeps the main event by heat alone.
    world.config.booking.repeatPlacementPenalty = 1000;
    const second = bookShow(world, context(4), 5);
    expect(second.card.find((slot) => slot.position === "main_event")!.programId).not.toBe(held!.programId);
  });

  it("scores a promotion objective per slot rather than flat across every candidate", () => {
    const world = worldWithProgram(70);
    world.gmObjective = "rebuild_championship";
    world.titles[0]!.holderId = "wrestler-4";
    const show = bookShow(world, context(1), 2);
    const fits = (show.bookingTrace?.candidates ?? []).map((candidate) => candidate.scoreComponents["promotionObjectiveFit"]);
    expect(fits.length).toBeGreaterThan(1);
    expect(new Set(fits).size).toBeGreaterThan(1);
  });

  it("reads prepare_major_event as go-home proximity, not as booking popular people", () => {
    const world = worldWithProgram(70);
    world.gmObjective = "prepare_major_event";
    // Tick 8 is the last television show of the shipped four-week cycle.
    expect(isGoHomeShowTick(8, world.config)).toBe(true);
    expect(isGoHomeShowTick(5, world.config)).toBe(false);
    const beatFit = (tick: number): number => {
      const show = bookShow(structuredClone(world), context(tick - 1), tick);
      const beat = (show.bookingTrace?.candidates ?? []).find((candidate) => candidate.plannedBeatId !== undefined)!;
      const rotation = (show.bookingTrace?.candidates ?? []).find((candidate) => candidate.programId === undefined)!;
      // Rotation gets nothing from this objective at any point in the cycle.
      expect(rotation.scoreComponents["promotionObjectiveFit"]).toBe(0);
      return beat.scoreComponents["promotionObjectiveFit"]!;
    };
    expect(beatFit(8)).toBeGreaterThan(beatFit(5));
  });

  it("reads a wrestler's rotation form from open matches only", () => {
    const scenario = loadDefaultScenario();
    const seed = "slice-wwe-2026-1";
    const world = runHeadlessSlice(worldFromScenario(scenario, seed), seed, 12).finalWorld;
    const forms = world.wrestlers.map((wrestler) => rotationForm(world, wrestler.id, world.tick));
    // Every form read is bounded by the window and agrees with itself.
    for (const form of forms) {
      expect(form.wins + form.losses).toBeLessThanOrEqual(world.config.booking.rotationFormMatches);
      expect(form.net).toBe(form.wins - form.losses);
    }
    // And it is a real signal rather than a constant: some acts are winning
    // the matches nobody planned and some are losing them.
    expect(forms.some((form) => form.net > 0)).toBe(true);
    expect(forms.some((form) => form.net < 0)).toBe(true);
  });
});

describe("one objective system", () => {
  it("has no `bookingObjective` left anywhere in contracts or sim", () => {
    const roots = ["contracts", "sim"].map((name) => fileURLToPath(new URL(`../../${name}/src/`, import.meta.url)));
    for (const path of roots.flatMap((root) => implementationFiles(root))) {
      expect(readFileSync(path, "utf8"), `${path} still references the retired objective`).not.toContain("bookingObjective");
    }
  });

  it("drives slot intent and the card composer from the single gmObjective", () => {
    const world = worldWithProgram(70);
    world.gmObjective = "capitalise_on_rising_star";
    const show = bookShow(world, context(1), 2);
    expect(show.card.every((slot) => slot.gmIntent === "capitalise_on_rising_star")).toBe(true);
  });
});

/**
 * Card shape is a property of a *week of television*, not of one composed show,
 * so the rules that matter here can only be asserted against a real loop: a
 * repeat placement needs two consecutive cards, and score-ordered selection
 * needs a trace with candidates that actually lost.
 */
describe("card shape over a live tick loop", () => {
  const analyse = (seed: string, weeks: number) => {
    const run = runHeadlessSlice(worldFromScenario(loadDefaultScenario(), seed), seed, weeks);
    return { world: run.finalWorld, ...analyzeBooking(run.initialWorld, run.finalWorld) };
  };

  it("closes most television shows on a match over eight weeks", () => {
    for (const seed of ["slice-wwe-2026-1", "slice-wwe-2026-2"]) {
      const { metrics } = analyse(seed, 8);
      expect(metrics.televisionMatchMainEvents.total).toBeGreaterThan(0);
      expect(metrics.televisionMatchMainEvents.share, seed).toBeGreaterThan(0.5);
      // Not *every* one: the opening week of a cycle has only fresh promos to
      // offer, and an angle closing that show is the intended exception.
      expect(metrics.televisionMatchMainEvents.matches).toBeLessThanOrEqual(metrics.televisionMatchMainEvents.total);
    }
  });

  it("never repeats a program's card position three shows running", () => {
    for (const seed of ["slice-wwe-2026-1", "slice-wwe-2026-3"]) {
      const { world } = analyse(seed, 12);
      const shows: Show[] = world.shows.slice().sort((a, b) => a.tick - b.tick);
      const streaks = new Map<string, number>();
      for (const show of shows) {
        const held = new Map<string, CardPosition>();
        for (const slot of show.card) {
          if (slot.programId === undefined || !DISTINGUISHED.includes(slot.position)) continue;
          held.set(slot.programId, slot.position);
          const key = `${slot.programId}:${slot.position}`;
          const streak = (streaks.get(key) ?? 0) + 1;
          streaks.set(key, streak);
          expect(streak, `${key} held the same position on ${streak} consecutive shows in ${seed}`).toBeLessThan(3);
        }
        for (const key of [...streaks.keys()]) {
          const [programId, position] = key.split(":");
          if (held.get(programId!) !== position) streaks.delete(key);
        }
      }
    }
  });

  it("commits discretionary candidates strictly in soft-score order", () => {
    for (const seed of ["slice-wwe-2026-1", "slice-wwe-2026-2", "slice-wwe-2026-3"]) {
      const { world, metrics } = analyse(seed, 12);
      expect(metrics.scoreInversions, seed).toBe(0);
      // The metric is only meaningful if candidates genuinely lost on score:
      // a run where nothing was ever rejected would report zero for free.
      const rejected = world.shows.flatMap((show) => (show.bookingTrace?.candidates ?? [])
        .filter((candidate) => candidate.selection !== "reserved" && candidate.disposition === "rejected"));
      expect(rejected.length, seed).toBeGreaterThan(0);
      expect(rejected.every((candidate) => Object.keys(candidate.scoreComponents).length > 0)).toBe(true);
    }
  });

  it("charges the repeat-pairing penalty, and books everyone at least once", () => {
    const seed = "slice-wwe-2026-2";
    const { world } = analyse(seed, 12);
    const penalties = world.shows.flatMap((show) => (show.bookingTrace?.candidates ?? [])
      .map((candidate) => candidate.scoreComponents["repeatPairing"] ?? 0));
    expect(penalties.some((penalty) => penalty < 0)).toBe(true);
    // Freshness reads an act nobody has booked as the freshest on the roster,
    // so no one can be starved out of the card by never having been on it.
    const booked = new Set(world.shows.flatMap((show) => show.card.flatMap((slot) => slot.participantWrestlerIds)));
    const unbooked = world.wrestlers.filter((wrestler) => !booked.has(wrestler.id));
    expect(unbooked.map((wrestler) => wrestler.id)).toEqual([]);
  });

  it("lets a story's alternative creative objective win when the score says so", () => {
    // The planner scores two objectives per story. Before this phase only the
    // primary was reachable; the run must now show the other one being chosen.
    const fallbackWins = ["slice-wwe-2026-1", "slice-wwe-2026-2", "slice-wwe-2026-3"].map((seed) => {
      const { world } = analyse(seed, 26);
      const groups = new Map<string, typeof world.programPlanCandidates>();
      for (const candidate of world.programPlanCandidates) {
        const key = `${candidate.storyId}:${candidate.tick}`;
        groups.set(key, [...(groups.get(key) ?? []), candidate]);
      }
      return [...groups.values()].filter((group) => group.findIndex((entry) => entry.disposition === "selected") > 0).length;
    });
    expect(fallbackWins.reduce((total, wins) => total + wins, 0)).toBeGreaterThan(0);
  });
});
