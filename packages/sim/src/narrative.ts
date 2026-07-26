import type { NarrativeCharacter, NarrativeJob, WorldEvent, WorldState, Wrestler } from "@wrestling/contracts";
import type { TickContext } from "./context.js";
import { humanWrestlers, requireWrestler } from "./lookups.js";

function characterFor(wrestler: Wrestler): NarrativeCharacter {
  return {
    id: wrestler.id,
    voice: [wrestler.gimmick.promoTone, ...wrestler.gimmick.traits].slice(0, 3),
  };
}

/**
 * GDD §4 pipeline step 8 / §16: turn this tick's events into narrative jobs.
 * Job contents are facts-only (event summaries) — the narrative layer
 * (Phase 4) is responsible for turning facts into prose; this stage never
 * invents facts of its own.
 */
export function buildNarrativeJobs(world: WorldState, ctx: TickContext, tickEvents: WorldEvent[]): NarrativeJob[] {
  const jobs: NarrativeJob[] = [];
  if (tickEvents.length === 0) return jobs;
  const push = (job: NarrativeJob) => {
    world.narrativeJobs.push(job);
    jobs.push(job);
  };

  const matchEvents = tickEvents.filter((e) => e.type === "match_result");
  if (matchEvents.length > 0) {
    const wrestlerIds = new Set(matchEvents.flatMap((e) => e.wrestlerIds));
    push({
      id: ctx.ids.next("job"),
      tick: ctx.tick,
      jobType: "show_recap",
      facts: matchEvents.map((e) => e.summary),
      characters: [...wrestlerIds].map((id) => characterFor(requireWrestler(world, id))),
      constraints: { maxWords: 150, inventFacts: false },
      status: "pending",
    });
  }

  for (const wrestler of humanWrestlers(world)) {
    const own = tickEvents.filter((e) => e.wrestlerIds.includes(wrestler.id));
    if (own.length === 0) continue;
    push({
      id: ctx.ids.next("job"),
      tick: ctx.tick,
      jobType: "personal_summary",
      facts: own.map((e) => e.summary),
      characters: [characterFor(wrestler)],
      constraints: { maxWords: 100, inventFacts: false },
      status: "pending",
    });
  }

  const gmEvents = tickEvents.filter((e) => e.type === "gm_decision" || e.type === "show_booked");
  if (gmEvents.length > 0) {
    push({
      id: ctx.ids.next("job"),
      tick: ctx.tick,
      jobType: "gm_message",
      facts: gmEvents.map((e) => e.summary),
      characters: [],
      constraints: { maxWords: 80, inventFacts: false },
      status: "pending",
    });
  }

  const rumorEvents = tickEvents.filter(
    (e) => e.type === "reactive_decision_created" && e.data["decisionType"] === "rumor_published",
  );
  if (rumorEvents.length > 0) {
    const ids = new Set(rumorEvents.flatMap((e) => e.wrestlerIds));
    push({
      id: ctx.ids.next("job"),
      tick: ctx.tick,
      jobType: "rumour",
      facts: rumorEvents.map((e) => e.summary),
      characters: [...ids].map((id) => characterFor(requireWrestler(world, id))),
      constraints: { maxWords: 60, inventFacts: false },
      status: "pending",
    });
  }

  const allIds = new Set(tickEvents.flatMap((e) => e.wrestlerIds));
  jobs.push({
    id: ctx.ids.next("job"),
    tick: ctx.tick,
    jobType: "dirt_sheet_article",
    facts: tickEvents.map((e) => e.summary),
    characters: [...allIds].map((id) => characterFor(requireWrestler(world, id))),
    constraints: { maxWords: 200, inventFacts: false },
    status: "pending",
  });

  return jobs;
}
