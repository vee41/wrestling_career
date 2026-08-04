import {
  momentumDirection,
  popularityBand,
  relationshipTier,
  skillBand,
  type WorldState,
  type Wrestler,
} from "@wrestling/contracts";
import { upcomingSlotsFor } from "@wrestling/sim";

export function findWrestler(world: WorldState, id: string): Wrestler {
  const w = world.wrestlers.find((x) => x.id === id);
  if (!w) throw new Error(`unknown wrestler id "${id}"`);
  return w;
}

export function findName(world: WorldState, id: string): string {
  return world.wrestlers.find((x) => x.id === id)?.name ?? id;
}

/** Generic 0-100 intensity band for dimensions spec §8 doesn't name explicitly (reaction, fatigue, heat, condition). */
export function intensityBand(value: number): "low" | "moderate" | "high" {
  if (value < 34) return "low";
  if (value < 67) return "moderate";
  return "high";
}

function humanize(token: string): string {
  return token.replace(/_/g, " ");
}

function renderSkills(wrestler: Wrestler, debug: boolean): string[] {
  return Object.entries(wrestler.skills).map(([name, value]) =>
    debug ? `    ${name}: ${value}` : `    ${name}: ${skillBand(value, "own")}`,
  );
}

export function renderStatus(world: WorldState, wrestlerId: string, debug: boolean): string {
  const wrestler = findWrestler(world, wrestlerId);
  const popularity = world.popularity.find((p) => p.wrestlerId === wrestlerId);
  const stance = world.stances.find((s) => s.wrestlerId === wrestlerId);
  const lines: string[] = [];

  lines.push(`${wrestler.name}  [${wrestler.id}]`);
  lines.push(
    `  ${wrestler.alignment} · ${wrestler.controlledBy}-controlled · condition ${
      debug ? wrestler.condition : intensityBand(wrestler.condition)
    } · $${wrestler.money}`,
  );
  const heldTitles = world.titles.filter((title) => title.holderId === wrestlerId);
  if (heldTitles.length > 0) lines.push(`  ★ Champion: ${heldTitles.map((title) => title.name).join(", ")}`);
  else {
    const champions = world.titles.filter((title) => title.holderId !== undefined)
      .map((title) => `${title.name}: ${findName(world, title.holderId!)}`);
    if (champions.length > 0) lines.push(`  Champions: ${champions.join(" · ")}`);
  }

  lines.push("  Gimmick:");
  lines.push(`    ${wrestler.gimmick.concept} — ${wrestler.gimmick.promoTone}, ${wrestler.gimmick.presentation}`);
  lines.push(`    traits: ${wrestler.gimmick.traits.join(", ")}`);
  lines.push(`    direction: ${wrestler.gimmick.currentDirection}`);

  lines.push("  Skills:");
  lines.push(...renderSkills(wrestler, debug));

  if (popularity) {
    lines.push("  Popularity:");
    lines.push(
      `    general: ${debug ? popularity.generalPopularity : popularityBand(popularity.generalPopularity)}` +
        ` · momentum: ${debug ? popularity.momentum : momentumDirection(popularity.momentum)}` +
        ` · reaction: ${debug ? popularity.currentReaction : intensityBand(popularity.currentReaction)}`,
    );
    lines.push(
      `    heat: +${debug ? popularity.positiveHeat : intensityBand(popularity.positiveHeat)}` +
        ` / -${debug ? popularity.negativeHeat : intensityBand(popularity.negativeHeat)}` +
        ` · fatigue: ${debug ? popularity.fatigue : intensityBand(popularity.fatigue)}`,
    );
  }

  if (stance) {
    lines.push(
      `  Stance: ${humanize(stance.stance)}${
        stance.pendingStance ? ` (queued: ${humanize(stance.pendingStance)}, applies next tick)` : ""
      }`,
    );
  }

  const outgoing = world.relationships.filter((r) => r.fromWrestlerId === wrestlerId);
  if (outgoing.length > 0) {
    lines.push("  Relationships:");
    for (const r of outgoing) {
      const name = findName(world, r.toWrestlerId);
      if (debug) {
        lines.push(
          `    -> ${name}: affinity ${r.affinity}, respect ${r.respect}, trust ${r.trust}, rivalry ${r.rivalry}, resentment ${r.resentment}`,
        );
      } else {
        lines.push(
          `    -> ${name}: affinity ${relationshipTier(r.affinity)}, trust ${relationshipTier(r.trust)}, rivalry ${intensityBand(r.rivalry)}`,
        );
      }
    }
  }

  const stories = world.stories.filter((s) => s.participantWrestlerIds.includes(wrestlerId) && s.phase !== "resolved");
  if (stories.length > 0) {
    lines.push("  Active stories:");
    for (const s of stories) {
      const others = s.participantWrestlerIds.filter((id) => id !== wrestlerId).map((id) => findName(world, id));
      lines.push(
        `    ${humanize(s.tension)} vs ${others.join(", ")} (${s.phase}, stakes: ${s.stakes}, momentum: ${
          debug ? s.momentum : momentumDirection(s.momentum)
        })`,
      );
    }
  }

  const upcoming = upcomingSlotsFor(world, wrestlerId, world.tick);
  if (upcoming.length > 0) {
    lines.push("  Upcoming bookings:");
    for (const { show, slot } of upcoming) {
      const others = slot.participantWrestlerIds.filter((id) => id !== wrestlerId).map((id) => findName(world, id));
      const intent = slot.intents[wrestlerId];
      lines.push(
        `    ${slot.kind === "segment" ? "segment" : "match"} at tick ${show.tick}, slot ${slot.id}${others.length > 0 ? ` with ${others.join(", ")}` : " (solo)"}${
          intent ? ` — your intent: ${humanize(intent)}` : " — no intent set yet"
        }`,
      );
    }
  }

  const proposals = world.pendingProposals.filter(
    (p) => p.proposerWrestlerId === wrestlerId || p.recipientWrestlerId === wrestlerId,
  );
  if (proposals.length > 0) {
    lines.push("  Pending proposals:");
    for (const p of proposals) {
      const asRecipient = p.recipientWrestlerId === wrestlerId;
      const other = findName(world, asRecipient ? p.proposerWrestlerId : p.recipientWrestlerId);
      lines.push(
        `    [${p.id}] ${humanize(p.originatingIntent)} ${asRecipient ? "from" : "to"} ${other}` +
          ` (deadline tick ${p.deadlineTick})${asRecipient ? " — awaiting your response" : ""}`,
      );
    }
  }

  const decisions = world.pendingReactiveDecisions.filter((d) => d.targetWrestlerId === wrestlerId);
  if (decisions.length > 0) {
    lines.push("  Pending reactive decisions:");
    for (const d of decisions) {
      lines.push(
        `    [${d.id}] ${humanize(d.type)} — respond with one of: ${d.offeredResponses.join(", ")} (deadline tick ${d.deadlineTick})`,
      );
    }
  }

  return lines.join("\n");
}

export function renderSheet(world: WorldState, limit: number): string {
  const events = world.events.slice(-limit).reverse();
  if (events.length === 0) return "The dirt sheet is empty — nothing has happened yet.";
  const lines = [`=== DIRT SHEET (latest ${events.length} of ${world.events.length}) ===`];
  for (const event of events) {
    lines.push(`[tick ${event.tick}] ${event.summary}`);
  }
  return lines.join("\n");
}
