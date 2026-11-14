/**
 * The room socket is cut mid-round and the match must not notice. Two browsers play a Fuse Riders round against the
 * real local room service; the service then drops every WebSocket without a close frame, which is what Cloud Run's
 * hourly cut and a stopped instance look like from both ends. Each page reconnects, resumes its connection, and:
 *
 *   - no page builds a new RTCPeerConnection (a member the room heard had left would have its link rebuilt),
 *   - the round is still the same round, with both riders connected, on both pages,
 *   - an input pressed while the socket was down, and one after the resume, reach the other page.
 *
 * Then the opposite case, so the fallback stays honest: a seat the service no longer holds (its lease is ended here by
 * hand) is rejoined under a new connection, the links are rebuilt, and the match recovers.
 *
 *   pnpm build && pnpm exec tsx scripts/socket-resume-smoke.ts
 *
 * Headless Chromium on loopback: this is not evidence about a phone, a NAT or the production proxy.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { openPlayOptions, takeHostSeat } from "./lib/main-menu.js";
import { ridersPageUrl } from "./lib/riders-url.js";
import { readyRoom } from "./lib/ready-room.js";
import { instrument } from "./p2p-measure.js";
import { createDevRoomService } from "../service/dev.js";

interface Snapshot {
  phase: string;
  matchId?: string;
  round?: number;
  playerId: string;
  players: Array<{
    id: string;
    alive: boolean;
    heldMotion?: { left: boolean; right: boolean };
  }>;
}
interface Counters {
  peerConnections: number;
  sockets: number;
  welcomes: { connectionId: string; resumed?: boolean }[];
}

assert.ok(existsSync("dist/index.html"), "run `pnpm build` first");
const service = createDevRoomService({ staticDirectory: "dist" });
await new Promise<void>((resolve) =>
  service.server.listen(0, "127.0.0.1", resolve),
);
const base = `http://localhost:${(service.server.address() as AddressInfo).port}/`;
const browser = await launchSelected("chromium", { headless: true });
const errors: string[] = [];

/** Counts what the page builds: peer connections, room sockets, and the welcomes those sockets were given. */
const COUNTERS = `(() => {
  const counters = (window.__resume = { peerConnections: 0, sockets: 0, welcomes: [] });
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...args) { counters.peerConnections++; return new Peer(...args); };
  window.RTCPeerConnection.prototype = Peer.prototype;
  const Socket = window.WebSocket;
  window.WebSocket = function (...args) {
    const socket = new Socket(...args);
    counters.sockets++;
    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === 'welcome') counters.welcomes.push({ connectionId: frame.connectionId, resumed: frame.resumed });
      } catch {}
    });
    return socket;
  };
  window.WebSocket.prototype = Socket.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[key] = Socket[key];
})();`;

const latest = (page: Page) =>
  page.evaluate(() =>
    (Reflect.get(window, "__trace") as { snapshots: Snapshot[] }).snapshots.at(
      -1,
    )!,
  );
const counters = (page: Page) =>
  page.evaluate(() => Reflect.get(window, "__resume") as Counters);
/** Resolves once `watcher` sees `rider` holding (or no longer holding) a turn. */
const sees = (
  watcher: Page,
  rider: string,
  side: "left" | "right",
  held: boolean,
) =>
  watcher.waitForFunction(
    ({ rider, side, held }) =>
      (Reflect.get(window, "__trace") as { snapshots: Snapshot[] }).snapshots
        .at(-1)
        ?.players.find((player) => player.id === rider)?.heldMotion?.[side] ===
      held,
    { rider, side, held },
  );

const pages = await Promise.all(
  ["Anchor", "Pilot"].map(async (name) => {
    const page = await (
      await browser.newContext({ viewport: { width: 1100, height: 760 } })
    ).newPage();
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    page.setDefaultTimeout(20_000);
    await instrument(page, false);
    await page.addInitScript(COUNTERS);
    await page.addInitScript(
      (rider) => localStorage.setItem("fuse-riders-player-name", rider),
      name,
    );
    return page;
  }),
);
const [host, guest] = pages as [Page, Page];
try {
  const entrance = new URL(ridersPageUrl(base));
  entrance.searchParams.set("mute", "");
  entrance.searchParams.set("benchmark", "1");
  entrance.searchParams.set("renderer", "phaser-canvas");
  await host.goto(entrance.href);
  await openPlayOptions(host);
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  await takeHostSeat(host, "Anchor");
  await host
    .locator(".room-rider strong")
    .filter({ hasText: "Anchor" })
    .waitFor();
  const invite = new URL(host.url());
  for (const [key, value] of entrance.searchParams)
    invite.searchParams.set(key, value);
  if (host.url() !== invite.href) {
    await host.goto(invite.href);
    await takeHostSeat(host, "Anchor");
  }
  await guest.goto(invite.href);
  await host
    .locator(".room-rider strong")
    .filter({ hasText: "Pilot" })
    .waitFor();
  // A long, quiet round: the classic arena with no pickups, so nobody dies of anything but their own steering.
  await readyRoom(host);
  for (const page of pages)
    await page.waitForFunction(
      () =>
        (
          Reflect.get(window, "__trace") as { snapshots: Snapshot[] }
        ).snapshots.at(-1)?.phase === "playing",
    );
  const pilot = (await latest(guest)).playerId,
    anchor = (await latest(host)).playerId;
  const round = await latest(host);

  // ---- The socket is cut mid-round, and resumed ------------------------------------------------------------------
  const before = await Promise.all(pages.map(counters));
  for (const count of before) assert.equal(count.welcomes.length, 1);
  service.server.terminateSockets();
  // While the socket is down the links still carry the round: a turn pressed now is seen on the other page.
  await guest.keyboard.down("ArrowLeft");
  await sees(host, pilot, "left", true);
  await guest.keyboard.up("ArrowLeft");
  await sees(host, pilot, "left", false);
  for (const page of pages)
    await page.waitForFunction(
      () => (Reflect.get(window, "__resume") as Counters).welcomes.length === 2,
    );
  // And after the resume, the other way.
  await host.keyboard.down("ArrowRight");
  await sees(guest, anchor, "right", true);
  await host.keyboard.up("ArrowRight");
  await sees(guest, anchor, "right", false);
  await host.waitForTimeout(1500);
  const after = await Promise.all(pages.map(counters));
  for (const [index, count] of after.entries()) {
    const was = before[index]!;
    assert.equal(count.sockets, was.sockets + 1, "one new room socket");
    assert.deepEqual(
      count.welcomes.at(-1),
      { connectionId: was.welcomes[0]!.connectionId, resumed: true },
      "welcomed back as the same connection",
    );
    assert.equal(
      count.peerConnections,
      was.peerConnections,
      "no peer connection was rebuilt",
    );
    const now = await latest(pages[index]!);
    assert.equal(now.matchId, round.matchId);
    assert.equal(now.round, round.round, "still the same round");
    assert.ok(
      ["playing", "roundOver"].includes(now.phase),
      `phase ${now.phase}`,
    );
    assert.equal(now.players.length, round.players.length);
  }
  console.log(
    `Resumed mid-round: ${after.map((count) => `${count.peerConnections} peer connection(s), ${count.sockets} sockets`).join("; ")}`,
  );

  // ---- A seat the service no longer holds: the old path, a new connection and rebuilt links ------------------------
  const code = new URL(host.url()).searchParams.get("room")!;
  const seats = Object.values((await service.gateway.store.get(code)).members);
  service.server.terminateSockets();
  // Each page said goodbye as far as the room record goes, so there is nothing to resume.
  for (const member of seats)
    await service.gateway.store.leave(code, member).catch(() => {});
  for (const page of pages)
    await page.waitForFunction(
      () => (Reflect.get(window, "__resume") as Counters).welcomes.length === 3,
    );
  const rebuilt = await Promise.all(pages.map(counters));
  for (const [index, count] of rebuilt.entries()) {
    assert.equal(count.welcomes.at(-1)!.resumed, false);
    assert.notEqual(
      count.welcomes.at(-1)!.connectionId,
      after[index]!.welcomes[0]!.connectionId,
    );
  }
  // The rebuilt mesh carries inputs again.
  await guest.keyboard.down("ArrowRight");
  await sees(host, pilot, "right", true);
  await guest.keyboard.up("ArrowRight");
  for (const count of await Promise.all(pages.map(counters)))
    assert.ok(
      count.peerConnections > after[0]!.peerConnections,
      "links rebuilt",
    );
  assert.deepEqual(errors, []);
  console.log("Socket resume smoke passed");
} finally {
  await browser.close();
  await service.close();
}
