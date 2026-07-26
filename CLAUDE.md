# Wrestling Career Simulation

Mobile-first multiplayer wrestling career sim: each player is one wrestler in a shared promotion that advances on simulation ticks. The sim creates facts; LLMs only narrate them.

## Documentation (read before designing or building anything)

| Document | Role |
| --- | --- |
| [docs/GDD.md](docs/GDD.md) | Vision + simulation systems. Owns the canonical tick pipeline (§4). |
| [docs/player-decision-loop-spec.md](docs/player-decision-loop-spec.md) | **Authoritative for player choices** (slots, reactive decisions, intents, stance). Its backticked tokens are normative for all code. |
| [docs/PLAN.md](docs/PLAN.md) | Phased execution plan. |

Precedence on conflict: spec > GDD §5–6; GDD elsewhere; `packages/contracts` is machine canon for tokens.

## Layout

pnpm monorepo: `packages/contracts` (zod schemas — the shared vocabulary), `packages/sim` (pure, deterministic domain logic), `packages/narrative` (provider-agnostic prose generation), `apps/cli` (headless harness), `apps/web` (SvelteKit mobile-first client).

## Commands

- `pnpm test` · `pnpm typecheck` · `pnpm lint` — all must pass at the root before work is considered done.

## Hard rules

- `packages/sim` never imports SvelteKit, Supabase, or LLM SDKs. All randomness flows through the seeded RNG passed into `runTick`.
- The LLM never mutates game state.
- Enum values in code must match the spec's tokens verbatim; changing one requires updating the spec in the same change.
- Scope discipline: anything GDD §3 excludes or the spec tags *post-prototype* stays out.
- Players never see raw sim numbers — use the qualitative projections (spec §8).
