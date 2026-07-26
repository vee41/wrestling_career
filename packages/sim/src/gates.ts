import type { InteractionIntent, Relationship } from "@wrestling/contracts";

// GDD §12 / spec §12 task list: "relationship/state gates — some intents
// require trust/affinity thresholds." The spec lists this as a requirement
// without pinning exact thresholds, so this is the Phase 2 simplification:
// intents that ask someone to actively vouch for or team up with you require
// the relationship not be actively hostile; everything else (build_trust,
// repair_relationship, provoke, undermine, pitch_feud...) needs no gate —
// those make sense to attempt from any starting point.
const GATED_INTENTS: ReadonlySet<InteractionIntent> = new Set<InteractionIntent>([
  "propose_alliance",
  "coordinate_pitch",
  "offer_elevation",
  "request_support",
]);

const HOSTILE_THRESHOLD = -20;

/** Neutral relationship values to assume when no Relationship row exists yet. */
const NEUTRAL = { trust: 0, respect: 0 } as const;

export function interactionGatePasses(
  intent: InteractionIntent,
  relationship: Pick<Relationship, "trust" | "respect"> | undefined,
): boolean {
  if (!GATED_INTENTS.has(intent)) return true;
  const { trust, respect } = relationship ?? NEUTRAL;
  return trust >= HOSTILE_THRESHOLD && respect >= HOSTILE_THRESHOLD;
}
