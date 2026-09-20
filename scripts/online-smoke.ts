import { readyRoom } from "./lib/ready-room.js";
import type { Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { smokeTimeout } from "./smoke-timeout.js";
import { openTopMenu } from "./lib/top-menu.js";
// Online gate: create, joins through the join card, start, three rounds on the shared log, rematch dismisses every recap, guest and creator refresh
// mid-round, settings and the phone lobby, a lobby reload that re-confirms the seat, an AI rider, and shared-TV mode
// with controller phones steering riders the TV simulates — in Chromium and WebKit.
interface Snapshot {
  kind: "snapshot";
  at: number;
  matchId: string;
  round: number;
  tick: number;
  phase: string;
  playerId: string;
  players: Array<{ id: string; alive: boolean; angle: number }>;
}
await mkdir("artifacts", { recursive: true });
const browser = await launchSelected("chromium", { headless: true });
const base = process.env.ONLINE_URL ?? "http://localhost:8787/";
const phone = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
} as const;
const latest = (page: Page) =>
  page.evaluate(() =>
    (Reflect.get(window, "__snapshots") as Snapshot[] | undefined)?.at(-1),
  );
const recording = (page: Page) =>
  page.addInitScript(() => {
    const list: unknown[] = [];
    Reflect.set(window, "__snapshots", list);
    window.addEventListener("fuse-benchmark", (event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.kind === "snapshot") {
        list.push(detail);
        if (list.length > 400) list.shift();
      }
    });
  });
const waitPhase = (page: Page, phases: string[], timeout = 30000) =>
  page.waitForFunction(
    (wanted) => {
      const list = Reflect.get(window, "__snapshots") as Snapshot[] | undefined;
      const state = list?.at(-1);
      return !!state && wanted.includes(state.phase);
    },
    phases,
    { timeout: smokeTimeout(timeout) },
  );
const waitRound = (page: Page, round: number, timeout = 90000) =>
  page.waitForFunction(
    (wanted) => {
      const list = Reflect.get(window, "__snapshots") as Snapshot[] | undefined;
      const state = list?.at(-1);
      return !!state && state.round >= wanted;
    },
    round,
    { timeout: smokeTimeout(timeout) },
  );
/**
 * The room is the join screen: a device that opens a room link seats itself, under the name this browser remembers,
 * so the smoke seeds that name rather than filling a form that is no longer in the way
 * (`docs/design/room-is-the-join-screen.md`).
 */
const joinAs = async (page: Page, name: string, url: string) => {
  await recording(page);
  await page.addInitScript(
    (rider) => localStorage.setItem("fuse-riders-player-name", rider),
    name,
  );
  await page.goto(url + "&benchmark=1");
  await page
    .locator(".room-riders")
    .locator(":is(.room-rider strong, .online-score-name)")
    .filter({ hasText: name })
    .first()
    .waitFor();
};
// A member's own name: these lists also carry the HOST badge and the status lines, and `getByText` is not case
// sensitive, so "Host" would match the badge too. The watching list is nested in `.room-riders`, so this matches a
// watcher's name as well as a rider's — no spectator takes part in this smoke.
const RIDER_NAME = ":is(.room-rider strong, .online-score-name)";
const rosterHas = (page: Page, name: string) =>
  page
    .locator(":is(.online-roster,.room-riders):visible")
    .locator(RIDER_NAME)
    .filter({ hasText: name })
    .first()
    .waitFor();
try {
  const a = await browser.newContext({
    viewport: { width: 1000, height: 700 },
  });
  a.setDefaultTimeout(smokeTimeout(30000));
  const host = await a.newPage();
  const roundReports: Array<{ round: number; length: number }> = [];
  host.on("request", (request) => {
    if (request.url().endsWith("/round-results") && request.method() === "POST")
      roundReports.push(request.postDataJSON().result);
  });
  // WebKit reports a send on a channel whose transport just died as a page error (the transport gates on connection state, but the last task hop can still race),
  // and a spurious same-origin access-control failure from Phaser's asset loader that Chromium never raises.
  const benign = (error: Error) =>
    /Error sending (binary data|string) through RTCDataChannel|due to access control checks/.test(
      error.message,
    );
  const pageErrors: string[] = [];
  const watch = (page: Page, label: string) =>
    page.on("pageerror", (error) => {
      if (benign(error)) return;
      pageErrors.push(`${label}: ${error.message}`);
      console.error(`${label.toUpperCase()} ERROR`, error);
    });
  watch(host, "host");
  await recording(host);
  await host.goto(base);
  // CREATE ROOM swaps the landing view for the room in place: a page load would cost the soundtrack, because no
  // browser autoplays before the new page has been tapped. The marker and the same media element are the evidence.
  const music = () =>
    host.evaluate(() => {
      const element = document.querySelector("audio");
      return {
        kept: "kept" in window,
        src: element?.getAttribute("src") ?? null,
        time: element?.currentTime ?? -1,
      };
    });
  // The radio attaches its <audio> and sets the track from the page's first audio update, after `load` resolves goto.
  await host.waitForFunction(
    () => !!document.querySelector("audio")?.getAttribute("src"),
  );
  await host.evaluate(() => {
    Reflect.set(window, "kept", true);
  });
  const beforeEnter = await music();
  assert.ok(beforeEnter.src, "the landing page owns a music element");
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  {
    const afterEnter = await music();
    assert.ok(
      afterEnter.kept,
      "CREATE ROOM keeps the document, so the radio keeps playing",
    );
    assert.equal(
      afterEnter.src,
      beforeEnter.src,
      "the room plays the same track the landing page did",
    );
    assert.ok(
      afterEnter.time >= beforeEnter.time,
      `the track never rewinds: ${beforeEnter.time} -> ${afterEnter.time}`,
    );
  }
  // Keep UI room creation coverage. Phaser Canvas in CI avoids six software-GL views competing for one runner; dedicated Phaser gates test the intended renderer.
  // The creator is seated by the room it just opened, with no screen in between — the same arrival an invited device
  // makes, under the name this browser remembers (`docs/design/room-is-the-join-screen.md`).
  await host.addInitScript(() =>
    localStorage.setItem("fuse-riders-player-name", "Host"),
  );
  const target = new URL(host.url());
  if (process.env.ROOM_RENDERER === "phaser-canvas")
    target.searchParams.set("renderer", "phaser-canvas");
  target.searchParams.set("benchmark", "1");
  await host.goto(target.href);
  const url = host.url().replace(/&benchmark=1/, "");
  await rosterHas(host, "Host");
  assert.equal(
    await host.locator(".online-join").isVisible(),
    false,
    "the creator is seated without being asked: no join form in its lobby",
  );
  // Everything the creator used to settle on that form is in the action bar beside READY, and stays there until it
  // readies up: its name, its head, its colour and which side of the room it is on.
  const bar = host.locator(".room-lobby-footer .online-host");
  for (const label of ["NAME", "AVATAR", "COLOUR"])
    assert.equal(
      await bar.getByRole("button", { name: label, exact: true }).isVisible(),
      true,
      `${label} is offered beside READY`,
    );
  assert.equal(
    await bar.locator("button.room-switch").textContent(),
    "SWAP TO SPECTATOR",
    "and the way to the watching list, which is where JOIN AS SPECTATOR went",
  );
  const b = await browser.newContext(phone);
  b.setDefaultTimeout(smokeTimeout(30000));
  const guest = await b.newPage();
  watch(guest, "guest");
  // A joiner is seated by the room itself, under the name this browser remembers, with no form in between
  // (`docs/design/room-is-the-join-screen.md`). It settles its head in the room afterwards instead.
  await recording(guest);
  await guest.addInitScript(() =>
    localStorage.setItem("fuse-riders-player-name", "Guest"),
  );
  await guest.goto(url + "&benchmark=1");
  await rosterHas(guest, "Guest");
  assert.equal(
    await guest.locator(".room-join").isVisible(),
    false,
    "a device the room can seat never sees the join card",
  );
  // Head and colour are chosen in the room now, and only until this rider is ready. The head the host wears is
  // offered as theirs rather than as a choice, since no two riders share one (rules `fuse-p2p-48`) — the host took
  // the default fox, so the guest was seated in another head and cannot reach for that one.
  await guest.getByRole("button", { name: "AVATAR", exact: true }).click();
  const takenHead = guest.getByRole("button", { name: "Fox", exact: true });
  await takenHead.waitFor();
  assert.equal(
    await takenHead.isDisabled(),
    true,
    "a head another rider wears is shown as theirs, not offered",
  );
  assert.match(
    (await takenHead.getAttribute("title")) ?? "",
    /^Taken by /,
    "and says whose it is",
  );
  await guest.getByRole("button", { name: "Owl", exact: true }).click();
  await guest.getByRole("button", { name: "COLOUR", exact: true }).waitFor();
  await rosterHas(host, "Guest");
  // The head the guest chose in the room reaches the host's screen, on the guest's own row. Scoped to that row: the
  // host wears the default fox itself now, so a page-wide search for one head would find the host's.
  await host
    .locator(".room-rider")
    .filter({ hasText: "Guest" })
    .locator(".avatar-portrait[data-avatar-id=owl]")
    .first()
    .waitFor();
  console.log("Guest roster confirmed");
  // A browser carrying a guest identity under the old host key (previous builds saved every visitor there) must land on the joiner page with that identity kept, not on the host shell.
  {
    const code = new URL(url).searchParams.get("room")!,
      stale = "ab".repeat(32);
    const c = await browser.newContext(phone);
    c.setDefaultTimeout(smokeTimeout(30000));
    await c.addInitScript(
      ([code, stale]) => {
        if (!localStorage.getItem(`fuse-peer-${code}`))
          localStorage.setItem(`fuse-room-${code}`, stale);
      },
      [code, stale] as const,
    );
    const page = await c.newPage();
    await page.goto(url);
    // It arrives as an ordinary joiner and seats itself; the migration is what this checks, not the screen.
    await page.locator(".room-riders:visible").waitFor();
    assert.deepEqual(
      await page.evaluate(
        (code) => [
          localStorage.getItem(`fuse-room-${code}`),
          localStorage.getItem(`fuse-peer-${code}`),
        ],
        code,
      ),
      [null, stale],
      "stale host key migrates to the peer identity",
    );
    await c.close();
    console.log("Stale host key migrated");
  }
  // Six WebKit views overload a CI runner (the host's frame time triples); SMOKE_RIDERS trims the roster there.
  const riderCount = Number(process.env.SMOKE_RIDERS ?? 5);
  const riders: Page[] = [];
  for (let i = 2; i < riderCount; i++) {
    const context = await browser.newContext(phone);
    context.setDefaultTimeout(smokeTimeout(30000));
    const page = await context.newPage();
    watch(page, `rider ${i}`);
    await joinAs(page, `Rider ${i}`, url);
    await rosterHas(host, `Rider ${i}`);
    riders.push(page);
  }
  console.log(`${riderCount} riders joined`);
  await readyRoom(host);
  await guest.waitForFunction(() =>
    document.querySelector(".online-notice")?.textContent?.includes("READY"),
  );
  await guest.locator(".mobile-play").waitFor({ state: "visible" });
  if (process.env.ROOM_RENDERER === "phaser-canvas")
    await host
      .locator('.online-arena[data-renderer="phaser-canvas"]')
      .waitFor();
  await host.screenshot({ path: "artifacts/online-host.png" });
  await guest.screenshot({ path: "artifacts/online-phone.png" });
  assert.equal(
    await guest
      .getByRole("button", { name: "ROOM SETTINGS", exact: true })
      .isVisible(),
    false,
  );
  // #68 flattened every visual style to one thin rim in both renderers, so the two modes became
  // indistinguishable and the room had no way to switch. Both must stay reachable and distinct.
  {
    await openTopMenu(host);
    await host.getByRole("button", { name: "SETTINGS", exact: true }).click();
    const styles = host.getByRole("button", { name: /^Visual style: / });
    assert.equal(
      await styles.count(),
      2,
      "both visual styles are offered under SETTINGS",
    );
    const applied = () =>
      host.evaluate(() => document.documentElement.dataset.theme);
    const themeBefore = await applied();
    assert.ok(themeBefore, "the room applies a visual style");
    const current = styles.and(host.locator('[aria-pressed="true"]')),
      other = styles.and(host.locator('[aria-pressed="false"]'));
    const before = await current.getAttribute("aria-label"),
      after = await other.getAttribute("aria-label");
    await other.click();
    await host.waitForFunction(
      (id) => document.documentElement.dataset.theme !== id,
      themeBefore,
    );
    assert.equal(
      await current.getAttribute("aria-label"),
      after,
      "the pressed option follows the style now showing",
    );
    await other.click();
    await host.waitForFunction(
      (id) => document.documentElement.dataset.theme === id,
      themeBefore,
    );
    assert.equal(
      await current.getAttribute("aria-label"),
      before,
      "switching back restores the first style",
    );
    await host.getByRole("button", { name: "CLOSE", exact: true }).click();
    console.log(
      `Visual style switched and switched back (${before} -> ${after})`,
    );
  }
  // Idle riders drive into the walls, so rounds end on their own: three rounds of the same match on every device.
  await waitPhase(host, ["playing"]);
  await waitRound(host, 3);
  await waitRound(guest, 3);
  const hostRound = await latest(host),
    guestRound = await latest(guest);
  assert.ok(
    hostRound && guestRound && hostRound.matchId === guestRound.matchId,
    "one match on every device",
  );
  assert.ok(
    roundReports.some((r) => r.round === 1 && r.length === 1),
    "round one reported before the full game recap",
  );
  assert.ok(
    roundReports.some((r) => r.round === 2 && r.length === 1),
    "round two reported independently",
  );
  console.log(
    "Three rounds played on the shared log; completed rounds reported independently",
  );
  // Every rider readies in the results; starting closes the report on every device.
  await waitPhase(host, ["matchOver"], 90000);
  const matchPages = [host, guest, ...riders];
  await Promise.all(
    matchPages.map((page) =>
      page
        .getByRole("dialog", { name: "Match results", exact: true })
        .waitFor(),
    ),
  );
  await readyRoom(host);
  for (const page of matchPages) {
    await waitPhase(page, ["countdown", "playing"]);
    await page.locator("dialog.game-dialog[open]").waitFor({ state: "hidden" });
    assert.notEqual((await latest(page))!.matchId, hostRound.matchId);
  }
  console.log("Rematch dismissed the results on every device");
  // The first match may have ended by now: the results dialog opens on its own and must be closed before the room actions.
  const closeRecap = async (page: Page) => {
    if (await page.locator("dialog[open]").count())
      await page.getByRole("button", { name: "CLOSE", exact: true }).click();
  };
  // A rematch keeps the refresh checks inside a running match whichever rider won three rounds first.
  const ensurePlaying = async () => {
    if ((await latest(host))!.phase === "matchOver") {
      await host
        .getByRole("button", { name: "READY FOR REMATCH", exact: true })
        .first()
        .waitFor();
      await readyRoom(host);
    }
    await waitPhase(host, ["playing"], 60000);
  };
  await ensurePlaying();
  let running = await latest(host);
  // Guest refresh mid-round: a reload comes back into the running match with the seat it held, without the join card.
  // The seat is read from the runtime's own snapshots and from the roster text the page keeps current whether or not
  // the layout shows it: the phone play layout hides the roster, so a wait on visible roster text only ended when the
  // match did. Back means listed in the recovered world and no longer marked offline. A recovered world that does not
  // list this rider, with the join card up, is the rider pruned at a round boundary that fell inside the reload.
  const landed = (cardCounts: boolean) =>
    guest.waitForFunction(
      (cardCounts) => {
        const list = Reflect.get(window, "__snapshots") as
          Snapshot[] | undefined;
        const state = list?.at(-1);
        if (!state || state.phase === "lobby") return false;
        if (state.players.some((player) => player.id === state.playerId))
          return [
            ...document.querySelectorAll(".online-roster .online-score-name"),
          ].some((name) => /^Guest(?! · offline)/.test(name.textContent ?? ""))
            ? "seated"
            : false;
        return cardCounts &&
          document.querySelector(".room-join")?.getClientRects().length
          ? "pruned"
          : false;
      },
      cardCounts,
      { timeout: smokeTimeout(30000) },
    );
  // Absent riders leave at round progression and come back through the join card, so a reload that straddles a round
  // boundary legitimately loses the seat, and idle riders crash often enough that one does. That outcome must not be
  // able to stand in for the proof: after a pruned rejoin the guest reloads again at the start of the next round, with
  // a whole round ahead of it, and only a kept seat passes. A second boundary inside a reload earns one more attempt.
  for (let attempt = 1; ; attempt++) {
    await guest.reload();
    if ((await (await landed(true)).jsonValue()) === "seated") break;
    const pruned = (await latest(guest))!;
    assert.ok(
      pruned.round !== running!.round || pruned.matchId !== running!.matchId,
      "a guest that reloads inside one round keeps its seat without the join card",
    );
    assert.ok(
      attempt < 3,
      "three reloads in a row lost the seat: a reload does not keep it",
    );
    // A pruned seat is taken again by the device itself: a reload is an arrival, so there is nothing to fill in and
    // nothing to press — it only has to land.
    await landed(false);
    console.log(
      `Guest seat pruned at a round boundary (reload ${attempt}); seated itself again, reloading`,
    );
    const rejoined = (await latest(host))!;
    for (const deadline = Date.now() + smokeTimeout(90000); ;) {
      await ensurePlaying();
      running = await latest(host);
      if (
        running!.phase === "playing" &&
        (running!.round !== rejoined.round ||
          running!.matchId !== rejoined.matchId)
      )
        break;
      assert.ok(Date.now() < deadline, "the next round never started");
      await host.waitForTimeout(100);
    }
  }
  // The seat is proven above whatever the layout shows; the phone must also be able to see it. A refreshed phone starts
  // with its tools closed and the roster lives behind MENU during play.
  await waitPhase(guest, ["playing"]);
  await guest.locator(".mobile-tools-toggle").click();
  await guest
    .locator(".online-roster:visible")
    .locator(RIDER_NAME)
    .filter({ hasText: "Guest" })
    .first()
    .waitFor();
  const afterGuest = await latest(guest);
  assert.equal(
    afterGuest!.matchId,
    running!.matchId,
    "the guest rejoined the running match",
  );
  await guest.locator(".mobile-tools-toggle").click();
  console.log("Guest refresh mid-round confirmed");
  // Creator refresh mid-round: the creator recovers the running world from a peer instead of opening a fresh lobby.
  await ensurePlaying();
  const beforeHost = await latest(host);
  await host.reload();
  await host
    .locator(":is(.online-roster,.room-riders):visible")
    .locator(RIDER_NAME)
    .filter({ hasText: "Guest" })
    .first()
    .waitFor();
  await host.waitForFunction(
    () => {
      const list = Reflect.get(window, "__snapshots") as Snapshot[] | undefined;
      const state = list?.at(-1);
      return !!state && state.phase !== "lobby";
    },
    undefined,
    { timeout: smokeTimeout(30000) },
  );
  const afterHost = await latest(host);
  assert.equal(
    afterHost!.matchId,
    beforeHost!.matchId,
    "the creator rejoined the running match",
  );
  assert.ok(afterHost!.tick > beforeHost!.tick);
  await host
    .getByRole("button", { name: "BACK TO LOBBY", exact: true })
    .waitFor({ state: "visible" });
  console.log("Creator refresh mid-round confirmed");
  await closeRecap(host);
  await host
    .getByRole("button", { name: "ROOM SETTINGS", exact: true })
    .click();
  await host.getByLabel("Match length").fill("2");
  await host
    .getByRole("button", { name: "SAVE SETTINGS", exact: true })
    .click();
  await host
    .getByRole("button", { name: "BACK TO LOBBY", exact: true })
    .click();
  // Back in the lobby a joined phone shows the lobby screen with the riders and the wait explained, not the controller (#134).
  await guest.waitForFunction(() =>
    document
      .querySelector(".online-notice")
      ?.textContent?.startsWith("Ready up"),
  );
  await guest.locator(".phone-lobby").waitFor();
  assert.equal(
    await guest.locator(".mobile-play").count(),
    0,
    "a joined phone in the lobby is a lobby screen",
  );
  await guest
    .locator(".room-riders")
    .locator(RIDER_NAME)
    .filter({ hasText: "Guest" })
    .first()
    .waitFor();
  console.log("Settings/reset confirmed");
  await guest.reload();
  // A lobby reload frees the seat, and the reloaded page takes one again by itself under the name it remembers —
  // the reload is an arrival, which is the one case that seats itself (`docs/design/room-is-the-join-screen.md`).
  await guest
    .locator(".phone-lobby .room-riders")
    .locator(RIDER_NAME)
    .filter({ hasText: "Guest" })
    .first()
    .waitFor(); // The reseated phone lands on the lobby screen (#134).
  assert.equal(
    await guest.locator(".room-join").isVisible(),
    false,
    "the remembered name seats it again with no card in the way",
  );
  console.log("Guest lobby reload confirmed");
  await host.reload();
  await host
    .locator(":is(.online-roster,.room-riders):visible")
    .locator(RIDER_NAME)
    .filter({ hasText: "Guest" })
    .first()
    .waitFor();
  await host
    .getByRole("button", { name: "ROOM SETTINGS", exact: true })
    .waitFor({ state: "visible" });
  console.log("Creator lobby reload confirmed");
  // One rider leaves so an AI rider can take the seat; a match with a bot runs on every replica alike.
  const leaver = riders.pop();
  if (leaver) {
    const name = `Rider ${riders.length + 2}`;
    await leaver.context().close();
    await host.waitForFunction(
      (gone) =>
        !document.querySelector(".online-roster")?.textContent?.includes(gone),
      name,
      { timeout: smokeTimeout(20000) },
    );
  }
  await host.getByRole("button", { name: "ADD AI", exact: true }).click();
  await host.getByRole("button", { name: /Remove AI/ }).waitFor();
  assert.match(
    (await host
      .getByRole("button", { name: /Remove AI/ })
      .getAttribute("aria-label"))!,
    /^Remove AI \w+$/,
    "AI roster names omit difficulty",
  );
  await readyRoom(host);
  await waitPhase(host, ["countdown", "playing"]);
  await waitPhase(guest, ["countdown", "playing"]);
  await waitRound(host, 2, 60000);
  const withBot = await latest(guest);
  assert.ok(
    withBot!.players.some((player) => player.id.startsWith("bot:")),
    "the AI rider is in the guest world",
  );
  console.log("AI rider round confirmed");
  await closeRecap(host);
  await host
    .getByRole("button", { name: "BACK TO LOBBY", exact: true })
    .click();
  await guest.waitForFunction(() =>
    document
      .querySelector(".online-notice")
      ?.textContent?.startsWith("Ready up"),
  );
  await host
    .getByRole("button", { name: "ROOM SETTINGS", exact: true })
    .waitFor({ state: "visible" });
  await host
    .getByRole("button", { name: "ROOM SETTINGS", exact: true })
    .click();
  await host
    .getByRole("radio", { name: "Shared TV + phone controls", exact: true })
    .check();
  await host
    .getByRole("button", { name: "SAVE SETTINGS", exact: true })
    .click();
  const phones = [guest, ...riders].slice(0, 2);
  for (const page of phones)
    await page.locator(".online-arena").waitFor({ state: "hidden" });
  const displayContext = await browser.newContext();
  displayContext.setDefaultTimeout(smokeTimeout(30000));
  const display = await displayContext.newPage();
  watch(display, "display");
  await recording(display);
  await display.goto(url + "&display=1&benchmark=1");
  await display
    .locator(":is(.online-roster,.room-riders):visible")
    .locator(RIDER_NAME)
    .filter({ hasText: "Host" })
    .first()
    .waitFor();
  assert.equal(
    await display
      .getByRole("button", { name: "ROOM SETTINGS", exact: true })
      .isVisible(),
    false,
  );
  await display.locator(".shared-lobby").waitFor({ state: "visible" });
  await display.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".shared-lobby img");
    return image?.complete && image.naturalWidth > 0;
  });
  await readyRoom(host);
  await display.locator(".shared-lobby").waitFor({ state: "hidden" });
  await display.locator(".online-arena").waitFor({ state: "visible" });
  // Controller phones steer riders the TV simulates: a held left third turns each rider on the display.
  await waitPhase(display, ["playing"], 40000);
  for (const [index, page] of phones.entries()) {
    const name = index === 0 ? "Guest" : "Rider 2";
    assert.equal(
      await page.locator(".controller-only").count(),
      1,
      `${name} is a controller-only phone`,
    );
    const before = await latest(display),
      phoneState = await latest(page);
    const rider = before!.players.find(
      (player) => player.id === phoneState!.playerId,
    );
    assert.ok(rider, `${name} rider on the display`);
    const box = await page
      .locator(".online-controls>button")
      .first()
      .boundingBox();
    assert.ok(box);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      const left = document.querySelector<HTMLButtonElement>(
        ".online-controls>button",
      );
      left?.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 7,
          pointerType: "touch",
          bubbles: true,
          clientX: 20,
          clientY: 200,
        }),
      );
    });
    await display.waitForFunction(
      ([id, angle]) => {
        const list = Reflect.get(window, "__snapshots") as
          Snapshot[] | undefined;
        const state = list?.at(-1);
        const player = state?.players.find((p) => p.id === id);
        return (
          !!player &&
          (!player.alive || Math.abs(player.angle - (angle as number)) > 0.05)
        );
      },
      [rider.id, rider.angle] as [string, number],
      { timeout: smokeTimeout(15000) },
    );
    await page.evaluate(() => {
      const left = document.querySelector<HTMLButtonElement>(
        ".online-controls>button",
      );
      left?.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 7,
          pointerType: "touch",
          bubbles: true,
          clientX: 20,
          clientY: 200,
        }),
      );
    });
  }
  console.log(`Shared TV with ${phones.length} controller phone(s) confirmed`);
  await host
    .getByRole("button", { name: "BACK TO LOBBY", exact: true })
    .click();
  await display.locator(".shared-lobby").waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
  console.log(
    "Online smoke passed: room creation, joins, start, three rounds, rematch dismisses every recap, guest and creator refresh mid-round, settings, phone lobby, lobby reloads, AI rider, shared TV with controller phones.",
  );
} catch (error) {
  for (const [index, context] of browser.contexts().entries())
    for (const page of context.pages()) {
      console.error(
        `ROOM DIAGNOSTIC ${index}`,
        await page
          .evaluate(() => {
            const canvas =
              document.querySelector<HTMLCanvasElement>(".online-arena");
            const start = [...document.querySelectorAll("button")].find(
              (button) => button.textContent === "ROOM SETTINGS",
            );
            const startBox = start?.getBoundingClientRect();
            let savedMode: unknown;
            try {
              savedMode = JSON.parse(
                localStorage.getItem("fuse-riders-room-settings-v2") ?? "{}",
              ).mode;
            } catch {
              // Failure diagnostics only: unreadable saved settings are reported as an undefined mode.
            }
            return {
              body: document.body.innerText,
              viewport: { width: innerWidth, height: innerHeight },
              startButton: startBox
                ? {
                    bounds: startBox.toJSON(),
                    disabled: start?.disabled,
                    centerTarget: document.elementFromPoint(
                      startBox.x + startBox.width / 2,
                      startBox.y + startBox.height / 2,
                    )?.outerHTML,
                  }
                : undefined,
              metrics:
                document.querySelector<HTMLElement>("#app")?.dataset.metrics,
              linkDiagnostics:
                document.querySelector<HTMLElement>("#app")?.dataset
                  .linkDiagnostics,
              canvas: {
                hidden: canvas?.hidden,
                parentClass: canvas?.parentElement?.className,
                renderer: canvas?.dataset.renderer,
              },
              savedMode,
              latest: (
                Reflect.get(window, "__snapshots") as unknown[] | undefined
              )?.at(-1),
            };
          })
          .catch(() => "<page closed>"),
      );
    }
  throw error;
} finally {
  await browser.close();
}
