import assert from "node:assert/strict";
import { test } from "node:test";
import { createTopBar } from "fuse-ui";
import { page } from "./dom-fixture.js";

test("initially empty room notices remain connected and visible outside the menu", () => {
  const { document } = page();
  const root = document.createElement("header");
  const notice = document.createElement("div");
  root.append(notice);
  document.body.append(root);
  createTopBar({ element: root });
  notice.textContent = "Connection lost. Retry.";
  assert.equal(notice.isConnected, true);
  assert.equal(notice.closest("dialog"), null);
  assert.equal(notice.parentElement?.className, "fui-top-bar-context");
  createTopBar({ element: root });
  assert.equal(
    root.querySelector(".fui-top-bar-context")?.textContent,
    "Connection lost. Retry.",
  );
});

test("the shared header retains account/menu handlers and reflects later per-game Elo updates", async () => {
  const { document } = page(),
    root = document.createElement("header"),
    brand = document.createElement("a"),
    nav = document.createElement("nav");
  nav.className = "fui-social";
  brand.textContent = "FUSE VOLLEY";
  const profile = document.createElement("button"),
    friends = document.createElement("button");
  profile.textContent = "Sign in";
  friends.textContent = "Friends";
  let opened = 0;
  profile.onclick = () => {
    opened++;
  };
  nav.append(profile, friends);
  root.append(brand, nav);
  document.body.append(root);
  createTopBar({ element: root, brand, gameId: "fuse-volley" });
  const account = root.querySelector<HTMLButtonElement>(
    ".fui-top-bar-account",
  )!;
  account.click();
  assert.equal(opened, 1);
  profile.textContent = "Andeplane\n1,000 ELO";
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(account.textContent, "Andeplane\n1,000 ELO");
  assert.equal(root.dataset.gameId, "fuse-volley");
  assert.ok(root.querySelector(".fui-top-bar-actions")!.contains(friends));
  const toggle = root.querySelector(".fui-top-bar-toggle");
  createTopBar({ element: root, gameId: "fuse-volley" });
  assert.equal(root.querySelectorAll(".fui-top-bar-toggle").length, 1);
  assert.equal(root.querySelector(".fui-top-bar-toggle"), toggle);
});

test("a reconciled header can be rebuilt without appending its old brand container to itself", () => {
  const { document } = page(),
    root = document.createElement("header");
  root.innerHTML = '<div class="brand">FUSE CRAFT</div>';
  document.body.append(root);
  createTopBar({ element: root, gameId: "fuse-craft" });
  const oldLeft = root.querySelector<HTMLElement>(".fui-top-bar-left")!;
  root.className = "nd-header";
  oldLeft.className = "brand";
  oldLeft.textContent = "FUSE CRAFT";
  createTopBar({ element: root, gameId: "fuse-craft" });
  assert.equal(root.querySelectorAll(".fui-top-bar-left").length, 1);
  assert.match(
    root.querySelector(".fui-top-bar-brand")!.textContent!,
    /FUSE CRAFT/,
  );
});
