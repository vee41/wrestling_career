import { CONTRACTS_PACKAGE_NAME } from "@wrestling/contracts";

export const NARRATIVE_PACKAGE_NAME = "@wrestling/narrative";

export function describeNarrative(): string {
  return `${NARRATIVE_PACKAGE_NAME} depends on ${CONTRACTS_PACKAGE_NAME}`;
}
