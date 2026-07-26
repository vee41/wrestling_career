import { CONTRACTS_PACKAGE_NAME } from "@wrestling/contracts";
import { describeNarrative } from "@wrestling/narrative";
import { describeSim } from "@wrestling/sim";

export function describeCli(): string {
  return [CONTRACTS_PACKAGE_NAME, describeSim(), describeNarrative()].join(" | ");
}
