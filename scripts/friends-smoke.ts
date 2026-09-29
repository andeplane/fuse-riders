/**
 * Friends end to end over the real local HTTP API with injected identities: two browsers, one asks, one accepts,
 * one joins a room and invites, the other is notified and can JOIN. No real Google account, no production data,
 * and the browser's Notification API is a stub that records what would have been shown.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";
import { WebSocket } from "ws";
import { createDevRoomService } from "../service/dev.js";
import { authFrame, peerId } from "fuse-network-be";
import type { FriendsView } from "fuse-platform/friends-api";

const vite = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
const service = createDevRoomService({
  allowedOrigins: [origin],
  identity: async (token) =>
    token.startsWith("smoke:") ? token.slice(6) : undefined,
});
await new Promise<void>((resolve) =>
  service.server.listen(0, "127.0.0.1", resolve),
);
const api = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
const sockets: WebSocket[] = [];
const call = (path: string, init: RequestInit = {}) =>
  fetch(api + path, { ...init, headers: { Origin: api, ...init.headers } });
const POLL_MS = 500;

/** Put a friends panel with `user`'s identity on the landing page of `page`, in place of the real one. */
async function mountPanel(page: Page, user: string, name: string) {
  await page.addInitScript("window.__name = value => value");
  await page.goto(new URL("?mute", origin).href);
  await page.locator(".online-app").waitFor();
  await page.evaluate(
    async ({ api, user, name, pollMs }) => {
      const path = "/games/fuse-riders/src/online/friends-panel.ts";
      const { createFriendsPanel } = (await import(
        path
      )) as typeof import("../games/fuse-riders/src/online/friends-panel.js");
      const shown: { title: string; body: string }[] = [],
        joined: string[] = [],
        tracked: string[] = [];
      let permission: "default" | "granted" | "denied" = "default";
      const panel = createFriendsPanel({
        fetch: (input, init) => fetch(input, init),
        apiUrl: (route) => `${api}${route}`,
        storage: localStorage,
        identity: () => ({ name, avatarId: "fox" }),
        join: (code) => joined.push(code),
        track: (event) => tracked.push(event),
        auth: {
          watch: (listener) => {
            listener({ name });
            return () => {};
          },
          token: async () => `smoke:${user}`,
        },
        notifications: {
          get permission() {
            return permission;
          },
          requestPermission: async () => (permission = "granted"),
          show: (title, options) => {
            shown.push({ title, body: options.body });
            return { onclick: null, close: () => {} };
          },
        },
        unattended: () => true,
        pollMs,
      });
      const app = document.querySelector(".online-app")!;
      const landing = app.querySelector(".landing-top-end")!;
      for (const control of landing.querySelectorAll(".friends-button"))
        control.remove();
      for (const dialog of app.querySelectorAll(".friends-dialog"))
        dialog.remove();
      for (const banner of app.querySelectorAll(".friends-invite-banner"))
        banner.remove();
      panel.banner.classList.add("friends-invite-banner");
      landing.append(panel.button);
      app.append(panel.dialog, panel.banner);
      Object.assign(window, {
        __friends: { panel, shown, joined, tracked },
      });
    },
    { api, user, name, pollMs: POLL_MS },
  );
}
type Injected = {
  panel: import("../games/fuse-riders/src/online/friends-panel.js").FriendsPanelHandle;
  shown: { title: string; body: string }[];
  joined: string[];
  tracked: string[];
};
const injected = (page: Page) =>
  page.evaluate(() => {
    const { shown, joined, tracked } = (
      window as unknown as { __friends: Injected }
    ).__friends;
    return { shown, joined, tracked };
  });

try {
  await mkdir("artifacts", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const alice = await browser.newPage({
        viewport: { width: 1280, height: 1000 },
      }),
      bob = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    for (const page of [alice, bob]) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.url().includes("/api/") && response.status() >= 400)
          void response
            .text()
            .then((body) =>
              console.error(
                `${response.request().method()} ${response.url()} → ${response.status()} ${body}`,
              ),
            );
      });
    }
    await mountPanel(alice, "alice", "Alice");
    await mountPanel(bob, "bob", "Bob");
    // Both have synced once now, so each has a public id the other can address.
    const sync = async (user: string) =>
      (await (
        await call("/api/friends/sync", {
          method: "POST",
          headers: {
            Authorization: `Bearer smoke:${user}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).json()) as FriendsView;
    const bobId = (await sync("bob")).me.publicId;
    // Alice meets Bob on a list: an ADD FRIEND button beside his name.
    await alice.evaluate((publicId) => {
      const { panel } = (window as unknown as { __friends: Injected })
        .__friends;
      const button = panel.friendButton(publicId);
      button.id = "smoke-add-bob";
      document.querySelector(".landing-top-end")!.append(button);
    }, bobId);
    await alice.locator("#smoke-add-bob").waitFor();
    assert.equal(
      await alice.locator("#smoke-add-bob").textContent(),
      "+ ADD FRIEND",
    );
    await alice.locator("#smoke-add-bob").click();
    await alice.locator('#smoke-add-bob[data-relation="outgoing"]').waitFor();
    assert.equal(await alice.locator("#smoke-add-bob").textContent(), "SENT");
    // Bob sees the request on his next poll and accepts it in the dialog.
    await bob.locator(".friends-button[data-waiting='true']").waitFor();
    await bob.locator(".friends-button").click();
    await bob.locator(".friends-dialog[open]").waitFor();
    await bob.getByRole("button", { name: "ACCEPT", exact: true }).click();
    await bob
      .locator(".friends-dialog .fui-friends-row[data-online='true']")
      .waitFor();
    assert.equal(
      await bob
        .locator(".friends-dialog .fui-friends-name")
        .first()
        .textContent(),
      "Alice",
    );
    await bob.screenshot({ path: "artifacts/friends-bob-accepted.png" });
    // Bob turns invite alerts on: the permission prompt is asked inside that tap.
    await bob.getByRole("button", { name: "🔕 INVITE ALERTS OFF" }).click();
    await bob.getByRole("button", { name: "🔔 INVITE ALERTS ON" }).waitFor();
    await bob.getByRole("button", { name: "CLOSE" }).click();
    await alice.locator('#smoke-add-bob[data-relation="friend"]').waitFor();
    // Alice takes a seat in a room, and her panel learns it; Bob is online and invitable.
    const created = (await (
      await call("/api/rooms", { method: "POST" })
    ).json()) as { code: string; token: string };
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `${api.replace("http", "ws")}/api/rooms/${created.code}/ws`,
        { origin: api },
      );
      sockets.push(socket);
      socket.once("open", () => socket.send(authFrame(created.token)));
      socket.once("message", () => resolve());
      socket.once("error", reject);
    });
    await alice.evaluate(
      ({ code, token, memberId }) => {
        const { panel } = (window as unknown as { __friends: Injected })
          .__friends;
        panel.setRoom({ code, memberId, gameId: "fuse-riders", token });
      },
      {
        code: created.code,
        token: created.token,
        memberId: peerId(created.token),
      },
    );
    await alice.locator(".friends-button").click();
    await alice.locator(".friends-dialog[open]").waitFor();
    await alice.getByRole("button", { name: "INVITE", exact: true }).waitFor();
    await alice.screenshot({ path: "artifacts/friends-alice-room.png" });
    await alice.getByRole("button", { name: "INVITE", exact: true }).click();
    // Bob: the banner, and a system notification since nobody is looking at his page.
    await bob.locator(".friends-invite-banner:not([hidden])").waitFor();
    assert.match(
      (await bob.locator(".friends-invite-banner").textContent()) ?? "",
      new RegExp(`Alice invited you to room ${created.code}`),
    );
    const bobState = await injected(bob);
    assert.equal(bobState.shown.length, 1, "one system notification");
    assert.equal(bobState.shown[0]!.title, "Alice invited you to Fuse Riders");
    assert.match(bobState.shown[0]!.body, new RegExp(created.code));
    await bob.screenshot({ path: "artifacts/friends-bob-invited.png" });
    await bob
      .locator(".friends-invite-banner")
      .getByRole("button", { name: "JOIN" })
      .click();
    assert.deepEqual((await injected(bob)).joined, [created.code]);
    // Alice's list shows Bob's presence; Alice leaves the room and the INVITE goes with it.
    await alice.getByRole("button", { name: "CLOSE" }).click();
    await alice.evaluate(() => {
      const { panel } = (window as unknown as { __friends: Injected })
        .__friends;
      panel.setRoom(undefined);
    });
    await alice.locator(".friends-button").click();
    await alice.locator(".friends-dialog[open]").waitFor();
    await alice.getByRole("button", { name: "REMOVE", exact: true }).waitFor();
    assert.equal(
      await alice.getByRole("button", { name: "INVITE", exact: true }).count(),
      0,
    );
    // Unfriend from Alice's side; Bob's list empties on his next poll.
    await alice.getByRole("button", { name: "REMOVE", exact: true }).click();
    await alice
      .locator(".friends-dialog")
      .getByText("No friends yet")
      .waitFor();
    await bob.locator(".friends-button").click();
    await bob.locator(".friends-dialog").getByText("No friends yet").waitFor();
    assert.deepEqual(errors, []);
    console.log("friends smoke passed");
  } finally {
    await browser.close();
  }
} finally {
  for (const socket of sockets) socket.close();
  await service.close();
  await vite.close();
}
