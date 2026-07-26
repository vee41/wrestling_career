import { proposalResponseSchema, reactiveResponseSchema } from "@wrestling/contracts";
import type { CliContext } from "../context.js";
import { findName, findWrestler } from "../format.js";
import { emptyPendingTurn, loadSave, writeSave } from "../store.js";
import { parseOrThrow } from "../validate.js";

export function runRespond(args: readonly string[], ctx: CliContext): string {
  const [wrestlerId, targetId, responseArg, ...counterParts] = args;
  if (!wrestlerId || !targetId || !responseArg) {
    throw new Error("usage: respond <wrestlerId> <decisionId|proposalId> <response> [counterPayload...]");
  }

  const save = loadSave(ctx.filePath);
  const wrestler = findWrestler(save.world, wrestlerId);
  const turn = save.pendingTurns[wrestlerId] ?? emptyPendingTurn(wrestlerId);

  const decision = save.world.pendingReactiveDecisions.find(
    (d) => d.id === targetId && d.targetWrestlerId === wrestlerId && d.status === "pending",
  );
  if (decision) {
    if (!decision.offeredResponses.includes(responseArg as (typeof decision.offeredResponses)[number])) {
      throw new Error(
        `"${responseArg}" isn't offered for this decision — choose one of: ${decision.offeredResponses.join(", ")}`,
      );
    }
    const response = parseOrThrow(
      reactiveResponseSchema,
      { reactiveDecisionId: targetId, response: responseArg },
      "respond",
    );
    save.pendingTurns[wrestlerId] = {
      ...turn,
      reactiveResponses: [...turn.reactiveResponses.filter((r) => r.reactiveDecisionId !== targetId), response],
    };
    writeSave(ctx.filePath, save);
    return `${wrestler.name} will ${responseArg.replace(/_/g, " ")} on the ${decision.type.replace(/_/g, " ")} decision next tick.`;
  }

  const proposal = save.world.pendingProposals.find(
    (p) => p.id === targetId && p.recipientWrestlerId === wrestlerId && p.status === "pending",
  );
  if (proposal) {
    const counterPayload = counterParts.length > 0 ? counterParts.join(" ") : undefined;
    if (responseArg === "counter" && counterPayload === undefined) {
      throw new Error('countering requires a payload: `respond <wrestlerId> <proposalId> counter "..."`');
    }
    const response = parseOrThrow(
      proposalResponseSchema,
      {
        proposalId: targetId,
        response: responseArg,
        ...(counterPayload !== undefined ? { counterPayload } : {}),
      },
      "respond",
    );
    save.pendingTurns[wrestlerId] = {
      ...turn,
      proposalResponses: [...turn.proposalResponses.filter((r) => r.proposalId !== targetId), response],
    };
    writeSave(ctx.filePath, save);
    return `${wrestler.name} will ${responseArg} the proposal from ${findName(save.world, proposal.proposerWrestlerId)} next tick.`;
  }

  const pendingIds = [
    ...save.world.pendingReactiveDecisions.filter((d) => d.targetWrestlerId === wrestlerId).map((d) => d.id),
    ...save.world.pendingProposals.filter((p) => p.recipientWrestlerId === wrestlerId).map((p) => p.id),
  ];
  throw new Error(
    `no pending reactive decision or proposal "${targetId}" for ${wrestler.name}.` +
      (pendingIds.length > 0 ? ` Pending: ${pendingIds.join(", ")}` : " Nothing is pending."),
  );
}
