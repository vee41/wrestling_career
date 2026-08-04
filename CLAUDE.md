# Wrestling Career Simulation

Mobile-first multiplayer wrestling career sim: each player is one wrestler in a shared promotion that advances on simulation ticks. The sim creates facts; LLMs only narrate them.

## Documentation (read before designing or building anything)

All documentation is meant for AI agents.

| Document | Role |
| --- | --- |
| [docs/GDD.md](docs/GDD.md) | Vision + simulation systems. Owns the canonical tick pipeline (§4). |
| [docs/player-decision-loop-spec.md](docs/player-decision-loop-spec.md) | **Authoritative for player choices** (slots, reactive decisions, intents, stance). Its backticked tokens are normative for all code. |
| [docs/six-month-slice.md](docs/six-month-slice.md) | **The MVP target**: measurable criteria (SL-1…SL-10) the simulation must meet on a headless 26-week run. Acceptance test for all sim tuning. |
| [docs/scenario-data-spec.md](docs/scenario-data-spec.md) | Data file formats for replaceable game worlds under `data/<scenario>/`. |
| [docs/booking_ai.md](docs/booking_ai.md) | **Booking architecture vision**: program plans, beats, planned finishes, card composition, replanning, and observability. |
| [docs/PLAN.md](docs/PLAN.md) | Phased execution plan. |

Precedence on conflict: spec > GDD §5–6; GDD elsewhere; the slice spec owns the 26-week MVP acceptance bar; `booking_ai.md` owns booking-AI architecture and design intent; `PLAN.md` owns execution order; `packages/contracts` is machine canon for implemented tokens and data formats.

## Layout

pnpm monorepo: `packages/contracts` (zod schemas — the shared vocabulary), `packages/sim` (pure, deterministic domain logic), `packages/narrative` (provider-agnostic prose generation), `apps/cli` (headless harness), `apps/web` (SvelteKit mobile-first client). World content lives in `data/<scenario>/` (default: `data/wwe-2026`).

## Commands

- `pnpm test` · `pnpm typecheck` · `pnpm lint` — all must pass at the root before work is considered done.

## Hard rules

- `packages/sim` never imports SvelteKit, Supabase, or LLM SDKs. All randomness flows through the seeded RNG passed into `runTick`.
- The LLM never mutates game state.
- Enum values in code must match the spec's tokens verbatim; changing one requires updating the spec in the same change.
- The sim is scenario-agnostic: no wrestler/title/show name from any dataset in `packages/` source — all world content flows from `data/<scenario>/` through the contracts scenario schemas.
- Scope discipline: anything GDD §3 excludes or the spec tags *post-prototype* stays out (incl. women's/tag divisions and a second brand for the MVP).
- Players never see raw sim numbers — use the qualitative projections (spec §8).
