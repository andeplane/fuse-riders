import type { WindowCommands } from "../windows/useWindowCommands";

/** The one Network Neighborhood window: opening it again brings the open one to the front. */
export const NETWORK_WINDOW_ID = "network-neighborhood";

export function openNetworkNeighborhood(
  commands: Pick<WindowCommands, "open">,
): void {
  commands.open({ kind: "network" }, { id: NETWORK_WINDOW_ID });
}
