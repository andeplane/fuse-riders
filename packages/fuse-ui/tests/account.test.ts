import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountDialog, type AccountAuth } from "fuse-ui";
import { HOSTILE, page } from "./dom-fixture.js";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

interface Match {
  endedAt: number;
  label: string;
}

function fakeAuth() {
  let listener: ((account: { name: string } | undefined) => void) | undefined;
  const remembered: string[] = [];
  const auth: AccountAuth<{ name: string }> = {
    watch: (next) => {
      listener = next;
      next(undefined);
      return () => {
        listener = undefined;
      };
    },
    token: async () => (listener ? "token" : undefined),
    ready: async () => {},
    warm: () => {},
    signIn: async () => listener?.({ name: HOSTILE }),
    signOut: async () => listener?.(undefined),
    remember: (name) => remembered.push(name),
    failure: () => "Sign-in failed",
  };
  return { auth, remembered, signIn: () => listener?.({ name: "Ada" }) };
}

function modal(dialog: HTMLDialogElement) {
  Object.defineProperty(dialog, "open", {
    get: () => dialog.hasAttribute("open"),
  });
  Object.defineProperty(dialog, "showModal", {
    value: () => dialog.setAttribute("open", ""),
  });
  Object.defineProperty(dialog, "close", {
    value: () => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(
        new dialog.ownerDocument.defaultView!.Event("close"),
      );
    },
  });
}

test("account dialog: signed out, signed in with history pages, and failed fetches", async () => {
  const { document } = page();
  const { auth, remembered, signIn } = fakeAuth();
  const requests: string[] = [];
  let history: (url: string) => Response = () =>
    new Response(JSON.stringify({ matches: [] }));
  const matches = Array.from({ length: 3 }, (_, i) => ({
    endedAt: 100 - i,
    label: i === 0 ? HOSTILE : `match ${i}`,
  }));
  const tracked: string[] = [];
  const panel = createAccountDialog<
    { name: string },
    { username?: string; rank?: number; avatarId?: string },
    Match,
    string
  >({
    auth,
    fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("/history")) return history(url);
      if (url === "/leaderboard") return new Response("", { status: 500 });
      return new Response(
        JSON.stringify({ profile: { username: "Ada", rank: 3 } }),
      );
    },
    historyUrl: (before) =>
      `/history${before === undefined ? "" : `?before=${before}`}`,
    profileUrl: "/me",
    leaderboardUrl: "/leaderboard",
    localName: () => null,
    track: (event) => tracked.push(event),
    names: {
      valid: (name) =>
        typeof name === "string" && name.length > 0 && name.length <= 12,
      suggest: (name) => name.split(" ")[0] || undefined,
      max: 12,
    },
    rating: () => 1234,
    totals: () => document.createElement("table"),
    match: (entry) => {
      const item = document.createElement("li");
      item.textContent = entry.label;
      return item;
    },
    leaderboard: () => document.createElement("ol"),
    avatar: (id) => {
      const portrait = document.createElement("span");
      portrait.dataset.avatar = id;
      return portrait;
    },
    pageSize: 2,
    classes: { button: "landing-account" },
    document,
  });
  modal(panel.dialog);
  assert.equal(panel.button.textContent, "SIGN IN");
  assert.equal(panel.button.className, "landing-account");
  assert.equal(panel.button.dataset.signedIn, "false");
  assert.equal(panel.leaderboardButton.textContent, "LEADERBOARD");

  panel.button.click();
  assert.equal(panel.dialog.open, true);
  const body = panel.dialog.querySelector(".fui-dialog-body")!;
  const enter = body.querySelector("button")!;
  assert.equal(enter.textContent, "SIGN IN WITH GOOGLE");
  assert.equal(enter.disabled, true, "held until sign-in is ready");
  await settle();
  assert.equal(enter.disabled, false);
  enter.click();
  await settle();
  assert.deepEqual(tracked, ["Signed In"]);

  // Signed in: the heading is the account name as text, then the first history page.
  history = () =>
    new Response(
      JSON.stringify({
        profile: { username: "Ada", avatarId: "owl" },
        matches: matches.slice(0, 2),
      }),
    );
  signIn();
  await settle();
  const heading = body.querySelector(".fui-account-name")!;
  assert.equal(heading.textContent, "Ada");
  assert.equal(heading.querySelector("span")!.dataset.avatar, "owl");
  assert.deepEqual(remembered.slice(-1), ["Ada"]);
  const list = body.querySelector(".fui-account-matches")!;
  assert.deepEqual(
    [...list.children].map((item) => item.textContent),
    [HOSTILE, "match 1"],
  );
  assert.equal(list.querySelector("img"), null);
  assert.equal(panel.button.textContent, "Ada\n1,234 ELO");
  assert.equal(panel.leaderboardButton.textContent, "#3 · LEADERBOARD");
  const older = [...body.querySelectorAll("button")].find(
    (b) => b.textContent === "OLDER GAMES",
  )!;
  assert.equal(older.hidden, false, "a full page offers older games");
  history = () => new Response(JSON.stringify({ matches: matches.slice(2) }));
  older.click();
  await settle();
  assert.ok(requests.includes("/history?before=99"));
  assert.equal(list.children.length, 3);
  assert.equal(older.hidden, true, "a short page ends the history");

  // A failed first page says so instead of spinning.
  history = () => new Response("", { status: 503 });
  panel.button.click();
  await settle();
  assert.equal(
    body.querySelector(".fui-account-note")!.textContent,
    "Could not load your games. Try again in a moment.",
  );

  // The leaderboard view: loading, then its failure line.
  panel.dialog.close();
  panel.leaderboardButton.click();
  assert.equal(
    body.querySelector(".fui-account-muted")!.textContent,
    "Loading leaderboard…",
  );
  await settle();
  assert.equal(
    body.querySelector(".fui-account-muted")!.textContent,
    "Could not load the leaderboard. Close and try again.",
  );
  const back = body.querySelector("button")!;
  assert.equal(back.textContent, "MY STATS");

  const shown = panel.button.textContent;
  panel.dispose();
  signIn();
  assert.equal(
    panel.button.textContent,
    shown,
    "a disposed panel stops listening",
  );
});
