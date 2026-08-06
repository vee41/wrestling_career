import { describe, expect, it } from "vitest";
import type { MatchSlot, Show, WorldState } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { absenceWeeks, clearanceTick, injurySeverity, isAvailable, isAvailableId, unavailableReason } from "./injury.js";
import { resolveShow } from "./match.js";
import { createIdFactory } from "./ids.js";
import { createRng } from "./rng.js";
import { createTestWorld, loadDefaultScenario } from "./test-helpers.js";
import { runTick } from "./tick.js";
import { worldFromScenario } from "./scenario.js";
import { updateChampionships } from "./title.js";

function ctxAt(tick: number, seed = "injury"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function scenarioWorld(seed: string): WorldState {
  return worldFromScenario(loadDefaultScenario(), seed);
}

function runWeeks(world: WorldState, weeks: number): WorldState {
  const ticks = weeks * (world.config.decisionTicksPerWeek + 1);
  let current = world;
  for (let i = 0; i < ticks; i++) current = runTick(current, [], current.seed).world;
  return current;
}

describe("injury severity and clearance", () => {
  const config = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "cfg" }).config;

  it("reads both severity axes off config, not code", () => {
    const health = config.health;
    // Ordinary wear: left above the serious line, at an ordinary cost.
    expect(injurySeverity(config, health.seriousInjuryCondition + 5, 20)).toBe("minor");
    // Left badly hurt.
    expect(injurySeverity(config, health.seriousInjuryCondition, 20)).toBe("serious");
    // Or came through it but paid an extreme price getting there.
    expect(injurySeverity(config, health.bookableCondition - 1, health.seriousInjuryPhysicalCost)).toBe("serious");
    expect(absenceWeeks(config, "minor")).toBe(config.health.minorAbsenceWeeks);
    expect(absenceWeeks(config, "serious")).toBe(config.health.seriousAbsenceWeeks);
  });

  it("counts an absence in whole show weeks after the week the injury happened in", () => {
    // Week length is 3 ticks (2 decision + 1 show); shows land on ticks 2, 5, 8.
    // Hurt on the week-1 show, a one-week absence must still be running when
    // the week-2 show is booked (tick 4) and be over by the week-3 booking.
    const clearance = clearanceTick(2, 1, config);
    expect(clearance).toBeGreaterThan(4);
    expect(clearance).toBeLessThanOrEqual(7);
    // A four-week absence spans a whole PLE cycle at the shipped cadence.
    expect(clearanceTick(2, 4, config) - clearanceTick(2, 1, config)).toBe(9);
  });

  it("answers availability on the calendar as well as on condition", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "avail" });
    const wrestler = world.wrestlers[0]!;
    world.tick = 4;
    wrestler.condition = 90;
    expect(isAvailable(world, wrestler)).toBe(true);
    expect(unavailableReason(world, wrestler)).toBeUndefined();

    // Fit but not cleared.
    wrestler.unavailableUntilTick = 6;
    expect(isAvailable(world, wrestler)).toBe(false);
    expect(unavailableReason(world, wrestler)).toBe("not_cleared");
    expect(isAvailableId(world, wrestler.id)).toBe(false);

    // Cleared but worn out.
    wrestler.unavailableUntilTick = 4;
    wrestler.condition = world.config.health.bookableCondition - 1;
    expect(isAvailable(world, wrestler)).toBe(false);
    expect(unavailableReason(world, wrestler)).toBe("condition");

    expect(isAvailableId(world, "nobody")).toBe(false);
  });
});

describe("an injury costs shows", () => {
  it("writes a clearance tick a night's rest cannot reach", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "cost" });
    const hurt = world.wrestlers[0]!;
    hurt.condition = 41;
    const show: Show = {
      id: "show-a", tick: 2, kind: "tv",
      card: [{ id: "slot-a", participantWrestlerIds: [hurt.id, world.wrestlers[1]!.id], position: "mid", intents: {} }],
    };
    world.shows.push(show);
    resolveShow(world, show, ctxAt(2));

    expect(hurt.unavailableUntilTick).toBe(clearanceTick(2, world.config.health.minorAbsenceWeeks, world.config));
    // The whole point of the calendar fact: recovering the condition back does
    // not clear the wrestler, so they still miss the show they were booked for.
    hurt.condition = 100;
    world.tick = 4;
    expect(isAvailable(world, hurt)).toBe(false);
  });

  it("extends an existing layoff rather than resetting it to the lighter injury", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "extend" });
    const hurt = world.wrestlers[0]!;
    hurt.condition = 41;
    hurt.unavailableUntilTick = 60;
    const show: Show = {
      id: "show-b", tick: 2, kind: "tv",
      card: [{ id: "slot-b", participantWrestlerIds: [hurt.id, world.wrestlers[1]!.id], position: "mid", intents: {} }],
    };
    world.shows.push(show);
    resolveShow(world, show, ctxAt(2));

    expect(hurt.unavailableUntilTick).toBe(60);
  });
});

describe("a deviated finish never moves a belt", () => {
  it("retains the championship and leaves the change to the planner", () => {
    const world = createTestWorld({ wrestlerCount: 2, humanCount: 0, seed: "title" });
    const [champion, challenger] = [world.wrestlers[0]!, world.wrestlers[1]!];
    world.titles = [{ id: "title-world", name: "Test Championship", tier: "world", holderId: champion.id, since: 0 }];
    // The champion is hurt going in, so the booked finish cannot be executed.
    champion.unavailableUntilTick = 10;
    const slot: MatchSlot = {
      id: "slot-t", participantWrestlerIds: [champion.id, challenger.id], position: "main_event", intents: {},
      titleId: "title-world",
      plannedFinish: {
        intendedWinnerWrestlerId: champion.id, finishFamily: "clean", adherenceStrength: "strict",
        intendedTitleConsequence: "retain", intendedStoryEffect: "The champion goes over clean.",
        protectedWrestlerIds: [champion.id],
      },
    };
    const show: Show = { id: "show-t", tick: 2, kind: "ple", card: [slot] };
    world.shows.push(show);

    const ctx = ctxAt(2);
    const [result] = resolveShow(world, show, ctx);

    expect(result?.adherence).toBe("deviated");
    expect(result?.deviationCause).toBe("injury");
    // The challenger stood tall, and the belt still did not move.
    expect(result?.winnerWrestlerId).toBe(challenger.id);
    expect(result?.actualOutcome?.titleConsequence).toBe("retain");
    updateChampionships(world, ctx, [result!]);
    expect(world.titles[0]!.holderId).toBe(champion.id);
  });
});

describe("injuries over a live tick loop", () => {
  it("takes a wrestler off the card and brings them back", () => {
    const world = runWeeks(scenarioWorld("1"), 8);
    const injuries = world.events.filter((event) => event.type === "injury");
    const hurt = injuries.filter((event) => event.matchId !== undefined);
    expect(hurt.length).toBeGreaterThan(0);
    // Every match injury names its tier and what that tier costs.
    for (const injury of hurt) {
      expect(["minor", "serious"]).toContain(injury.data["severity"]);
      expect(Number(injury.data["absenceWeeks"])).toBeGreaterThanOrEqual(1);
    }

    // A full arc: hurt on a card, missing at least one show for not being
    // cleared, and back on a later one.
    const arc = world.wrestlers.find((wrestler) => {
      const own = injuries.filter((event) => event.wrestlerIds.includes(wrestler.id));
      const injured = own.find((event) => event.matchId !== undefined);
      if (injured === undefined) return false;
      const missed = own.find((event) => event.data["absence"] === "missed_show"
        && event.data["reason"] === "not_cleared" && event.tick > injured.tick);
      if (missed === undefined) return false;
      return own.some((event) => event.data["absence"] === "return" && event.tick > missed.tick);
    });
    expect(arc, "no injury absence-and-return arc in 8 weeks").toBeDefined();

    // The absence is enforced, not advisory. A card is composed one tick before
    // it airs, so a layoff clearing at tick C bars every show up to and
    // including C — the first show a returning wrestler can make is C + 1.
    for (const injury of hurt) {
      const id = injury.wrestlerIds[0]!;
      const clearance = Number(injury.data["unavailableUntilTick"]);
      const worked = world.shows.filter((show) =>
        show.tick > injury.tick && show.tick <= clearance
        && show.card.some((slot) => slot.participantWrestlerIds.includes(id)));
      expect(worked.map((show) => show.tick), `${id} worked during a layoff`).toEqual([]);
    }
  });

  it("invalidates and substitutes the beats an unavailable participant was booked for", () => {
    const world = runWeeks(scenarioWorld("1"), 12);
    const invalidated = world.events.filter((event) => event.type === "planned_beat_invalidated");
    expect(invalidated.length).toBeGreaterThan(0);
    // The program answers the absence rather than losing the beat silently:
    // every invalidation records the response it chose, and the plan carries a
    // revision that changed something.
    for (const event of invalidated) {
      expect(event.data["response"]).toBe("substitute_beat");
      const plan = world.programPlans.find((candidate) => candidate.id === event.data["programPlanId"])!;
      const revision = plan.revisions.find((entry) => entry.reason === "participant_unavailable")!;
      expect(JSON.stringify(revision.previousIntent)).not.toBe(JSON.stringify(revision.newIntent));
    }
    expect(world.plannedBeats.some((beat) => beat.status === "invalidated")).toBe(true);
    // At least one invalidated beat was replaced rather than simply dropped.
    expect(invalidated.some((event) => event.data["substituteBeatId"] !== undefined)).toBe(true);
  });

  it("never changes a title on a deviated finish, and replans the program instead", () => {
    for (const seed of ["1", "2", "3"]) {
      const world = runWeeks(scenarioWorld(seed), 12);
      const deviations = world.events.filter((event) => event.type === "execution_deviation");
      for (const deviation of deviations) {
        const lineage = world.events.find((event) =>
          event.type === "title_change" && event.matchId === deviation.matchId && event.data["defended"] === false);
        expect(lineage, `a deviated finish moved a belt on seed ${seed}`).toBeUndefined();
        const programId = deviation.data["programId"];
        if (typeof programId !== "string") continue;
        // booking_ai §9: the deviation is a replanning trigger, and 3.12.4's
        // primitives mean the revision it appends actually changes the plan.
        // The exception is a deviation *at the payoff*: `resolvePayoff` closes
        // the plan before the deviation is read, and a feud that is over has no
        // remaining intent to revise.
        const plan = world.programPlans.find((candidate) => candidate.id === programId)!;
        if (plan.status === "resolved" || plan.status === "abandoned") continue;
        const revision = plan.revisions.find((entry) => entry.reason === "execution_deviation");
        expect(revision, `deviation on ${programId} recorded no revision`).toBeDefined();
        expect(JSON.stringify(revision!.previousIntent)).not.toBe(JSON.stringify(revision!.newIntent));
      }
    }
  });

  it("reproduces identical absences on a same-seed replay", () => {
    const absences = (world: WorldState) => world.wrestlers.map((wrestler) => `${wrestler.id}:${wrestler.unavailableUntilTick ?? "-"}`).join("|");
    expect(absences(runWeeks(scenarioWorld("3"), 6))).toBe(absences(runWeeks(scenarioWorld("3"), 6)));
  });
});
