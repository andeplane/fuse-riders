/**
 * Where an online page load goes, before any room exists (#255 P1): the landing page, a room (solo, a TV display,
 * the creator's browser or an invited device) or the invalid-code card. Pure: the page passes its query string and
 * a lookup of the creator token CREATE ROOM stored, and `landing.ts` / `ui.ts` act on the answer.
 */
import { validRoomCode } from "fuse-network-fe";
import type { RoomRole } from "./room-screen.js";

/** CREATE ROOM is the only writer of this key: its presence makes this browser the room's creator. */
export const hostTokenKey = (code: string) => `fuse-room-${code}`;
/** The last room this browser was in, for the landing page's REJOIN. */
export const LAST_ROOM_KEY = "fuse-last-room";

export const SOLO_QUERY = "?solo=1";
export const roomQuery = (code: string) => `?room=${code}`;
/** TV VIEW: the same room as a shared-screen display (ADR 042). */
export const displayQuery = (code: string) => `?room=${code}&display=1`;

/** A room this page load enters, and as whom. */
export interface RoomRoute {
  kind: "room";
  /** The room code, upper case; `SOLO` for a solo run. */
  code: string;
  solo: boolean;
  /** `?display=1`: a shared-screen TV with no seat. */
  displayOnly: boolean;
  role: RoomRole;
  /** The creator token CREATE ROOM stored for this code; only the creator's browser has one. */
  hostToken: string | null;
}

export type OnlineRoute =
  { kind: "landing" } | { kind: "invalid"; code: string } | RoomRoute;

export function onlineRoute(
  search: string,
  storedHostToken: (code: string) => string | null,
): OnlineRoute {
  const params = new URLSearchParams(search);
  const solo = params.get("solo") === "1";
  const code = solo ? "SOLO" : params.get("room")?.toUpperCase();
  if (!code) return { kind: "landing" };
  if (!solo && !validRoomCode(code)) return { kind: "invalid", code };
  const displayOnly = !solo && params.has("display");
  const hostToken = solo || displayOnly ? null : storedHostToken(code);
  return {
    kind: "room",
    code,
    solo,
    displayOnly,
    role: solo
      ? "solo"
      : displayOnly
        ? "display"
        : hostToken
          ? "host"
          : "joiner",
    hostToken,
  };
}

/** JOIN ROOM: the typed code, trimmed and upper-cased, or what to tell the player. */
export function joinQuery(
  typed: string,
): { query: string } | { error: string } {
  const code = typed.trim().toUpperCase();
  return validRoomCode(code)
    ? { query: roomQuery(code) }
    : { error: "Enter a room code, for example AB42" };
}

/** REJOIN: the stored last room, when it is still a room code. */
export function rejoinCode(stored: string | null): string | undefined {
  return stored && validRoomCode(stored) ? stored : undefined;
}

/**
 * PLAY SOLO is a real link. A plain primary click stays in the page (keeping the music); a middle click or one with
 * a modifier is the browser's (a new tab, a new window, a download).
 */
export function plainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return !(
    event.button ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
