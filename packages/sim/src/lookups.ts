import type {
  PopularityBlock,
  Relationship,
  Story,
  WorldState,
  Wrestler,
  WrestlerStance,
} from "@wrestling/contracts";
import { clampDelta100, clampScale100 } from "./clamp.js";

export function findWrestler(world: WorldState, id: string): Wrestler | undefined {
  return world.wrestlers.find((w) => w.id === id);
}

export function requireWrestler(world: WorldState, id: string): Wrestler {
  const w = findWrestler(world, id);
  if (!w) throw new Error(`unknown wrestler id "${id}"`);
  return w;
}

export function findPopularity(world: WorldState, wrestlerId: string): PopularityBlock {
  const p = world.popularity.find((p) => p.wrestlerId === wrestlerId);
  if (!p) throw new Error(`missing popularity block for wrestler "${wrestlerId}"`);
  return p;
}

export function findStance(world: WorldState, wrestlerId: string): WrestlerStance {
  const s = world.stances.find((s) => s.wrestlerId === wrestlerId);
  if (!s) throw new Error(`missing stance entry for wrestler "${wrestlerId}"`);
  return s;
}

export function findStory(world: WorldState, id: string): Story | undefined {
  return world.stories.find((s) => s.id === id);
}

export function findRelationship(
  world: WorldState,
  fromWrestlerId: string,
  toWrestlerId: string,
): Relationship | undefined {
  return world.relationships.find(
    (r) => r.fromWrestlerId === fromWrestlerId && r.toWrestlerId === toWrestlerId,
  );
}

/**
 * Fetch the from->to relationship, creating a neutral one in place if absent.
 * Relationships are directed and sparse — most pairs start neutral until an
 * interaction or shared story creates a reason to track them explicitly.
 */
export function ensureRelationship(
  world: WorldState,
  fromWrestlerId: string,
  toWrestlerId: string,
): Relationship {
  const existing = findRelationship(world, fromWrestlerId, toWrestlerId);
  if (existing) return existing;
  const fresh: Relationship = {
    fromWrestlerId,
    toWrestlerId,
    affinity: 0,
    respect: 0,
    trust: 0,
    rivalry: 0,
    resentment: 0,
    influence: 0,
  };
  world.relationships.push(fresh);
  return fresh;
}

export type RelationshipDelta = Partial<
  Pick<Relationship, "affinity" | "respect" | "trust" | "rivalry" | "resentment" | "influence">
>;

/** Apply signed deltas to a from->to relationship, clamping to each dimension's scale. */
export function applyRelationshipDelta(
  world: WorldState,
  fromWrestlerId: string,
  toWrestlerId: string,
  delta: RelationshipDelta,
): Relationship {
  const rel = ensureRelationship(world, fromWrestlerId, toWrestlerId);
  if (delta.affinity) rel.affinity = clampDelta100(rel.affinity + delta.affinity);
  if (delta.respect) rel.respect = clampDelta100(rel.respect + delta.respect);
  if (delta.trust) rel.trust = clampDelta100(rel.trust + delta.trust);
  if (delta.rivalry) rel.rivalry = clampScale100(rel.rivalry + delta.rivalry);
  if (delta.resentment) rel.resentment = clampScale100(rel.resentment + delta.resentment);
  if (delta.influence) rel.influence = clampScale100(rel.influence + delta.influence);
  return rel;
}

export function humanWrestlers(world: WorldState): Wrestler[] {
  return world.wrestlers.filter((w) => w.controlledBy === "human");
}

export function aiWrestlers(world: WorldState): Wrestler[] {
  return world.wrestlers.filter((w) => w.controlledBy === "ai");
}
