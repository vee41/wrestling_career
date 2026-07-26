import { describe, expect, it } from "vitest";
import type { PlayerTurn } from "@wrestling/contracts";
import { resolveInteractions } from "./interactions.js";
import { createTestWorld } from "./test-helpers.js";
import { findPopularity } from "./lookups.js";
import type { TickContext } from "./context.js";
import { createRng } from "./rng.js";
import { createIdFactory } from "./ids.js";

function ctxAt(tick: number, seed = "interactions-test"): TickContext {
  return { tick, rng: createRng(`${seed}:${tick}`), ids: createIdFactory(tick), events: [] };
}

function turnsWith(turn: PlayerTurn): Map<string, PlayerTurn> {
  return new Map([[turn.wrestlerId, turn]]);
}

// gmAcceptanceProbability is a function of popularity/professionalism/GM
// objective — pin inputs high enough that acceptance is effectively certain
// across the handful of seeds these tests try, so a flaky miss doesn't slip
// through unnoticed as a false pass.
function forceHighAcceptance(world: ReturnType<typeof createTestWorld>, wrestlerId: string): void {
  const w = world.wrestlers.find((x) => x.id === wrestlerId);
  if (w) w.skills.professionalism = 100;
  const p = findPopularity(world, wrestlerId);
  p.generalPopularity = 100;
}

function firstAcceptedTick(
  buildTurn: (ctx: TickContext) => PlayerTurn,
  assertOutcome: (world: ReturnType<typeof createTestWorld>, ctx: TickContext) => boolean,
): void {
  for (let tick = 0; tick < 40; tick++) {
    const world = createTestWorld({ wrestlerCount: 3, humanCount: 0, seed: "gap4" });
    forceHighAcceptance(world, "wrestler-0");
    const ctx = ctxAt(tick, "gap4");
    const turn = buildTurn(ctx);
    resolveInteractions(world, turnsWith(turn), ctx);
    const outcome = ctx.events.find((e) => e.type === "interaction_resolved")?.data["outcome"];
    if (outcome === "accepted") {
      expect(assertOutcome(world, ctx)).toBe(true);
      return;
    }
  }
  throw new Error("no seed within range produced an accepted GM interaction — widen the search");
}

describe("resolveInteractions — accepted GM pitches have material effect (tuning gap #4)", () => {
  it("seeds a new story between the proposer and the named subject when an accepted pitch_feud names one", () => {
    firstAcceptedTick(
      (ctx) => ({
        wrestlerId: "wrestler-0",
        interaction: {
          id: ctx.ids.next("interaction"),
          wrestlerId: "wrestler-0",
          target: { kind: "gm" },
          intent: "pitch_feud",
          subjectWrestlerId: "wrestler-1",
        },
        reactiveResponses: [],
        proposalResponses: [],
        matchIntents: {},
        segmentIntents: {},
      }),
      (world) =>
        world.stories.some(
          (s) => s.participantWrestlerIds.includes("wrestler-0") && s.participantWrestlerIds.includes("wrestler-1"),
        ),
    );
  });

  it("gives request_opportunity a materially bigger momentum bump than a generic accepted ask", () => {
    let opportunityBump = 0;
    firstAcceptedTick(
      (ctx) => ({
        wrestlerId: "wrestler-0",
        interaction: {
          id: ctx.ids.next("interaction"),
          wrestlerId: "wrestler-0",
          target: { kind: "gm" },
          intent: "request_opportunity",
        },
        reactiveResponses: [],
        proposalResponses: [],
        matchIntents: {},
        segmentIntents: {},
      }),
      (world) => {
        opportunityBump = findPopularity(world, "wrestler-0").momentum;
        return opportunityBump > 0;
      },
    );

    let genericBump = 0;
    firstAcceptedTick(
      (ctx) => ({
        wrestlerId: "wrestler-0",
        interaction: {
          id: ctx.ids.next("interaction"),
          wrestlerId: "wrestler-0",
          target: { kind: "gm" },
          intent: "request_feedback",
        },
        reactiveResponses: [],
        proposalResponses: [],
        matchIntents: {},
        segmentIntents: {},
      }),
      (world) => {
        genericBump = findPopularity(world, "wrestler-0").momentum;
        return genericBump > 0;
      },
    );

    expect(opportunityBump).toBeGreaterThan(genericBump);
  });
});
