import { plainStatus } from "./status-copy.js";
/** A status that already tells the player what to do; the boot card hides the header, so it must show these verbatim. */
const ACTIONABLE =
  /reload this page|newer tab|incompatible|damaged|room ended|room full|start a new room/i;
/** A delay alone says nothing about network compatibility; retain the actual transport reason. */
export function connectHint(status: string, elapsedMs: number): string {
  if (ACTIONABLE.test(status)) return status;
  // The link is up and the room is syncing: the network advice would be wrong, however long it takes.
  const plain = plainStatus(status);
  if (plain.tone === "ok" || plain.text.startsWith("Connected"))
    return "Connected — syncing the arena…";
  if (/ICE failed|NAT|relay|unreachable/i.test(status) || elapsedMs >= 20000)
    return `Still connecting across the internet. ${status} Open ROOM → LINK DIAGNOSTICS for details; if it stays stuck, retry the connection.`;
  if (elapsedMs >= 6000) return "Still reaching the host…";
  return "Warming up the arena…";
}
