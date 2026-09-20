import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountDialog, dayLabel, type AccountAuth } from "fuse-ui";
import { HOSTILE, page } from "./dom-fixture.js";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

interface Match {
  id: string;
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

/** The dialog's own harness: one document, one panel, and the fetches it is allowed to make. */
function panelFixture(options: { pageSize?: number } = {}) {
  const { document } = page();
  const { auth, remembered, signIn } = fakeAuth();
  const requests: string[] = [],
    puts: string[] = [];
  const day = 86_400_000,
    now = 1_700_000_000_000;
  const match = (index: number, endedAt: number): Match => ({
    id: `match-${index}`,
    endedAt,
    // A hostile name heads each list: it must arrive as text in both the history and the feed.
    label: index % 10 === 0 ? HOSTILE : `match ${index}`,
  });
  const replies = {
    history: (url: string): Response =>
      new Response(
        JSON.stringify({
          profile: { username: "Ada", avatarId: "owl" },
          matches: url.includes("before=")
            ? [match(2, now - 2 * day)]
            : [match(0, now), match(1, now - 1)],
        }),
      ),
    feed: (url: string): Response =>
      new Response(
        JSON.stringify({
          matches: url.includes("before=")
            ? [match(12, now - day)]
            : [match(10, now), match(11, now - 2)],
        }),
      ),
    leaderboard: (): Response => new Response("", { status: 500 }),
    profile: (): Response =>
      new Response(JSON.stringify({ profile: { username: "Ada", rank: 3 } })),
  };
  const tracked: string[] = [];
  const panel = createAccountDialog<
    { name: string },
    { username?: string; rank?: number; avatarId?: string },
    Match,
    string
  >({
    auth,
    fetch: async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "PUT") puts.push(String(init.body));
      if (url.startsWith("/history")) return replies.history(url);
      if (url.startsWith("/matches")) return replies.feed(url);
      if (url === "/leaderboard") return replies.leaderboard();
      return replies.profile();
    },
    historyUrl: (before) =>
      `/history${before === undefined ? "" : `?before=${before}`}`,
    matchesUrl: (before) =>
      `/matches${before === undefined ? "" : `?before=${before}`}`,
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
    totals: (histories, handlers) => {
      const chips = document.createElement("div");
      chips.className = "totals";
      for (const entry of histories.matches) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = entry.id;
        chip.onclick = () => handlers.openMatch(entry);
        chips.append(chip);
      }
      return chips;
    },
    match: (entry, context) => {
      const item = document.createElement("li");
      const open = document.createElement("button");
      open.className = "row";
      open.dataset.focus = `match-${entry.id}`;
      open.textContent = `${entry.label} (${context.day})`;
      open.onclick = () => context.open();
      item.append(open);
      return item;
    },
    matchDetail: (entry, context) => {
      const report = document.createElement("section");
      report.className = "detail";
      report.textContent = `${entry.label} · ${context.day}`;
      return report;
    },
    leaderboard: () => document.createElement("ol"),
    avatar: (id) => {
      const portrait = document.createElement("span");
      portrait.dataset.avatar = id;
      return portrait;
    },
    pageSize: options.pageSize ?? 2,
    refreshClock: { now: () => now, schedule: () => () => {} },
    classes: { button: "landing-account" },
    document,
  });
  modal(panel.dialog);
  const body = panel.dialog.querySelector<HTMLElement>(".fui-dialog-body")!;
  const named = (name: string) =>
    [...body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    );
  const tab = (name: string) =>
    [...panel.dialog.querySelectorAll(".fui-account-tabs button")].find(
      (candidate) => candidate.textContent === name,
    ) as HTMLButtonElement | undefined;
  return {
    document,
    panel,
    body,
    requests,
    puts,
    remembered,
    tracked,
    signIn,
    replies,
    named,
    tab,
    now,
    day,
  };
}

test("account dialog: signed out, then stats with its own paged history", async () => {
  const f = panelFixture();
  const { panel, body } = f;
  assert.equal(panel.button.textContent, "SIGN IN");
  assert.equal(panel.button.className, "landing-account");
  assert.equal(panel.button.dataset.signedIn, "false");
  assert.equal(panel.leaderboardButton.textContent, "LEADERBOARD");
  assert.equal(panel.matchesButton.textContent, "MATCHES");

  panel.button.click();
  assert.equal(panel.dialog.open, true);
  const enter = body.querySelector("button")!;
  assert.equal(enter.textContent, "SIGN IN WITH GOOGLE");
  assert.equal(enter.disabled, true, "held until sign-in is ready");
  await settle();
  assert.equal(enter.disabled, false);
  enter.click();
  await settle();
  assert.deepEqual(f.tracked, ["Signed In"]);

  // Signed in: the heading is the username as text, and the STATS tab shows totals, not a match list.
  f.signIn();
  await settle();
  const heading = body.querySelector(".fui-account-name")!;
  assert.equal(heading.textContent, "Ada");
  assert.equal(heading.querySelector("span")!.dataset.avatar, "owl");
  assert.deepEqual(f.remembered.slice(-1), ["Ada"]);
  assert.equal(body.querySelector("img"), null, "a hostile name stays text");
  assert.equal(panel.button.textContent, "Ada\n1,234 ELO");
  assert.equal(panel.leaderboardButton.textContent, "#3 · LEADERBOARD");
  assert.equal(f.tab("STATS")!.getAttribute("aria-current"), "page");
  assert.equal(body.dataset.view, "stats");
  assert.equal(body.querySelector(".fui-account-matches"), null);
});

test("matches: everyone by default, yours on demand, each row opening its results", async () => {
  const f = panelFixture();
  const { panel, body } = f;
  panel.button.click();
  f.signIn();
  await settle();
  f.tab("MATCHES")!.click();
  await settle();
  assert.equal(body.dataset.view, "matches");
  assert.deepEqual(
    [...body.querySelectorAll(".fui-account-day h3")].map(
      (head) => head.textContent,
    ),
    ["TODAY"],
    "a day heading groups the rows under it",
  );
  assert.equal(body.querySelectorAll(".row").length, 2);
  assert.equal(body.querySelector("img"), null, "a hostile name stays text");
  assert.ok(
    f.requests.includes("GET /matches"),
    "the everyone feed is read without a cursor",
  );

  // A full page offers OLDER MATCHES, and the next page pages from the oldest entry listed.
  const older = f.named("OLDER MATCHES")!;
  assert.equal(older.hidden, false);
  older.click();
  await settle();
  assert.ok(f.requests.includes(`GET /matches?before=${f.now - 2}`));
  assert.equal(body.querySelectorAll(".row").length, 3);
  assert.deepEqual(
    [...body.querySelectorAll(".fui-account-day h3")].map(
      (head) => head.textContent,
    ),
    ["TODAY", "YESTERDAY"],
  );
  assert.equal(
    f.named("OLDER MATCHES")!.hidden,
    true,
    "a short page ends the list",
  );

  // Opening a row shows that match's report; back returns to the list.
  const requestsBefore = f.requests.length;
  body.querySelector<HTMLButtonElement>(".row")!.click();
  assert.equal(body.dataset.view, "match");
  assert.equal(
    body.querySelector(".detail")!.textContent,
    `${HOSTILE} · TODAY`,
  );
  f.named("‹ MATCHES")!.click();
  assert.equal(body.dataset.view, "matches");
  assert.equal(
    f.requests.length,
    requestsBefore,
    "opening a match and coming back refetches nothing",
  );

  // YOURS reads the signed-in history instead, and switching back does not read the feed again.
  f.named("YOURS")!.click();
  await settle();
  assert.equal(
    body
      .querySelector<HTMLButtonElement>(".fui-account-scope button")!
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(body.querySelectorAll(".row").length, 2);
  assert.ok(f.requests.includes("GET /history"));
  const feedReads = f.requests.filter((url) =>
    url.startsWith("GET /matches"),
  ).length;
  f.named("EVERYONE")!.click();
  await settle();
  assert.equal(
    f.requests.filter((url) => url.startsWith("GET /matches")).length,
    feedReads,
    "a feed already read is kept, not re-read",
  );
});

test("matches: a failed page offers TRY AGAIN, and an empty feed is read once", async () => {
  const f = panelFixture();
  const { panel, body } = f;
  f.replies.feed = () => new Response("", { status: 503 });
  panel.matchesButton.click();
  await settle();
  assert.equal(
    body.querySelector(".fui-account-note")!.textContent,
    "Could not load matches.",
  );
  const retry = f.named("TRY AGAIN")!;
  assert.equal(retry.hidden, false, "a first page that failed can be retried");
  let served = 0;
  f.replies.feed = () => {
    served++;
    return new Response(JSON.stringify({ matches: [] }));
  };
  retry.click();
  await settle();
  assert.equal(
    body.querySelector(".fui-account-note")!.textContent,
    "No finished games yet. Start a room and be the first.",
  );
  assert.equal(f.named("OLDER MATCHES")!.hidden, true);
  assert.equal(served, 1);
  // An empty feed must not ask again on a redraw: switching scope and back is a redraw, not a reload.
  f.named("YOURS")!.click();
  await settle();
  f.named("EVERYONE")!.click();
  await settle();
  assert.equal(served, 1, "an empty feed is fetched once");
});

test("account dialog: a failed history and a failed leaderboard each say so", async () => {
  const f = panelFixture();
  const { panel, body } = f;
  f.replies.history = () => new Response("", { status: 503 });
  panel.button.click();
  f.signIn();
  await settle();
  assert.equal(
    body.querySelector(".fui-account-note")!.textContent,
    "Could not load your games.",
  );
  f.replies.history = () =>
    new Response(JSON.stringify({ profile: { username: "Ada" }, matches: [] }));
  f.named("TRY AGAIN")!.click();
  await settle();
  assert.equal(body.querySelector(".fui-account-name")!.textContent, "Ada");

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
  assert.equal(f.tab("LEADERBOARD")!.getAttribute("aria-current"), "page");

  const shown = panel.button.textContent;
  panel.dispose();
  f.signIn();
  assert.equal(
    panel.button.textContent,
    shown,
    "a disposed panel stops listening",
  );
});

test("a recent-finish chip opens its match in the MATCHES tab", async () => {
  const f = panelFixture();
  const { panel, body } = f;
  panel.button.click();
  f.signIn();
  await settle();
  body.querySelector<HTMLButtonElement>(".chip")!.click();
  assert.equal(body.dataset.view, "match");
  assert.equal(f.tab("MATCHES")!.getAttribute("aria-current"), "page");
  f.named("‹ MATCHES")!.click();
  assert.equal(
    body
      .querySelector<HTMLButtonElement>(".fui-account-scope button")!
      .getAttribute("aria-pressed"),
    "false",
    "a match opened from the stats chips comes back to YOURS",
  );
  assert.equal(body.querySelectorAll(".row").length, 2);
});

test("day labels read as today, yesterday or the date", () => {
  const now = new Date(2026, 4, 20, 12).getTime();
  assert.equal(dayLabel(now - 3_600_000, now), "TODAY");
  assert.equal(dayLabel(new Date(2026, 4, 19, 23).getTime(), now), "YESTERDAY");
  assert.match(dayLabel(new Date(2026, 4, 10).getTime(), now), /10/);
  assert.match(dayLabel(new Date(2025, 4, 10).getTime(), now), /2025/);
  assert.equal(
    dayLabel(now, now, { today: "I DAG", yesterday: "I GÅR" }),
    "I DAG",
  );
});

test("settings: the username is saved, a refusal says so, and sign-out is offered", async () => {
  const f = panelFixture();
  const { panel, body, document } = f;
  panel.button.click();
  f.signIn();
  await settle();
  const form = body.querySelector<HTMLFormElement>(".fui-account-username")!;
  const name = form.querySelector("input")!;
  const status = form.querySelector("small")!;
  const submit = () =>
    form.dispatchEvent(new document.defaultView!.Event("submit"));
  assert.equal(name.value, "Ada", "the field starts at the stored username");

  // A name the game's rule refuses never becomes a request.
  name.value = "far too long a name";
  submit();
  await settle();
  assert.equal(status.textContent, "1 to 12 characters");
  assert.deepEqual(f.puts, []);

  // Accepted: the heading, the browser's remembered name and the status line all follow.
  name.value = "  Bee  ";
  submit();
  await settle();
  assert.deepEqual(f.puts, ['{"username":"Bee"}'], "the name is trimmed");
  assert.equal(body.querySelector(".fui-account-name")!.textContent, "Bee");
  assert.equal(status.textContent, "Saved. This is your name in every room.");
  assert.deepEqual(f.remembered.slice(-1), ["Bee"]);
  name.dispatchEvent(new document.defaultView!.Event("input"));
  assert.equal(status.textContent, "", "typing clears the last verdict");

  // Refused by the service: the heading keeps the name that is actually stored.
  f.replies.profile = () => new Response("", { status: 503 });
  name.value = "Cass";
  submit();
  await settle();
  assert.equal(status.textContent, "Could not save. Try again.");
  assert.equal(body.querySelector(".fui-account-name")!.textContent, "Bee");

  f.named("SIGN OUT")!.click();
  await settle();
  assert.equal(panel.button.textContent, "SIGN IN");
  assert.equal(
    body.querySelector("button")!.textContent,
    "SIGN IN WITH GOOGLE",
    "signing out returns the dialog to its signed-out view",
  );
});
