import { CONTRACTS_PACKAGE_NAME } from "@wrestling/contracts";

export const SIM_PACKAGE_NAME = "@wrestling/sim";

export function describeSim(): string {
  return `${SIM_PACKAGE_NAME} depends on ${CONTRACTS_PACKAGE_NAME}`;
}
