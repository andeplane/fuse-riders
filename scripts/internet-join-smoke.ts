import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDevRoomService } from "fuse-network-be";
import { listenFree } from "../service/listen-free.js";
import { launchSelected, browserKind } from "./lib/browser.js";
import { readyRoom } from "./lib/ready-room.js";

// Browser impairment only: duplicate real membership notifications and hold the host's ICE response.
// Does not replace RTC, physics or the service's signalling; this does not qualify cellular reachability.
const logs: Record<string, unknown>[] = [];
const service = createDevRoomService({
  staticDirectory: path.resolve("dist"),
  log: (entry) => logs.push(entry),
});
const port = await listenFree(service.server, 0, "127.0.0.1");
const browser = await launchSelected("chromium", { headless: true });
const kind = browserKind("chromium");
const errors: string[] = [];
try {
  const host = await browser.newPage();
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  for (const [page, name] of [
    [host, "Internet Host"],
    [phone, "Internet Guest"],
  ] as const) {
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    // esbuild annotates nested classes/functions with __name; supply that identity helper in the browser realm.
    await page.addInitScript((name) => {
      Reflect.set(window, "__name", (value: unknown) => value);
      localStorage.setItem("fuse-riders-player-name", name);
      const NativeSocket = window.WebSocket;
      const NativePeer = window.RTCPeerConnection;
      let connections = 0;
      let duplicates = 0;
      const sent: { kind: string; ufrag: string | null }[] = [];
      Reflect.set(window, "joinEvidence", {
        sent,
        get duplicates() {
          return duplicates;
        },
        get connections() {
          return connections;
        },
      });
      class ObservedSocket extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          const seen = new Set<string>();
          this.addEventListener("message", (event) => {
            const frame = JSON.parse(event.data);
            if (
              frame.type !== "peer" ||
              !frame.online ||
              seen.has(frame.connectionId)
            )
              return;
            seen.add(frame.connectionId);
            queueMicrotask(() => {
              duplicates++;
              this.dispatchEvent(
                new MessageEvent("message", { data: event.data }),
              );
            });
          });
        }
        override send(
          data: string | ArrayBufferLike | Blob | ArrayBufferView,
        ): void {
          if (typeof data === "string") {
            const frame = JSON.parse(data);
            if (frame.type === "signal") {
              const d = frame.data;
              sent.push({
                kind: d.description?.type ?? "candidate",
                ufrag:
                  d.candidate?.usernameFragment ??
                  /^a=ice-ufrag:(\S+)/m.exec(d.description?.sdp ?? "")?.[1] ??
                  null,
              });
            }
          }
          super.send(data);
        }
      }
      Reflect.set(window, "WebSocket", ObservedSocket);
      class ObservedPeer extends NativePeer {
        constructor(config?: RTCConfiguration) {
          super(config);
          connections++;
        }
      }
      Reflect.set(window, "RTCPeerConnection", ObservedPeer);
    }, name);
  }
  let releaseIce!: () => void;
  const heldIce = new Promise<void>((resolve) => {
    releaseIce = resolve;
  });
  await host.route("**/api/rooms/*/ice", async (route) => {
    await heldIce;
    await route.continue();
  });
  await host.goto(`http://127.0.0.1:${port}/fuse-riders/?mute&benchmark=1`);
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  await phone.goto(host.url());
  await host.waitForFunction(
    () => Number(Reflect.get(window, "joinEvidence")?.duplicates) > 0,
  );
  releaseIce();
  await host.unrouteAll({ behavior: "wait" });
  for (const page of [host, phone]) {
    await page
      .locator(".room-riders")
      .getByText("Internet Guest", { exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector(".online-app")
        ?.getAttribute("data-link-diagnostics")
        ?.includes("direct link healthy"),
    );
  }
  for (const page of [host, phone])
    assert.equal(
      await page.evaluate(
        () => Reflect.get(window, "joinEvidence").connections,
      ),
      1,
      "duplicate membership keeps the initial negotiation on one connection",
    );
  await readyRoom(host);
  await phone.locator(".mobile-play").waitFor({ state: "visible" });
  await phone.reload();
  await phone.waitForFunction(() =>
    document
      .querySelector(".online-app")
      ?.getAttribute("data-link-diagnostics")
      ?.includes("direct link healthy"),
  );
  await host.waitForFunction(() =>
    document
      .querySelector(".online-app")
      ?.getAttribute("data-link-diagnostics")
      ?.includes("direct link healthy"),
  );
  for (const page of [host, phone]) {
    const evidence = await page.evaluate(
      () =>
        Reflect.get(window, "joinEvidence") as {
          sent: { kind: string; ufrag: string | null }[];
          duplicates: number;
        },
    );
    const described = new Set<string>();
    for (const frame of evidence.sent) {
      if (frame.kind !== "candidate" && frame.ufrag) described.add(frame.ufrag);
      else if (frame.ufrag)
        assert.ok(
          described.has(frame.ufrag),
          "every trickle follows its generation's description",
        );
    }
  }
  // Wait for actual reports from both roles, including a healthy link; do not synthesize telemetry.
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(check);
      reject(new Error("host/client telemetry missing"));
    }, 20000);
    const check = setInterval(() => {
      if (
        ["host", "client"].every((role) =>
          logs.some(
            (entry) =>
              entry.kind === "room-link-report" &&
              entry.role === role &&
              (entry.links as { healthy: boolean }[]).some(
                (link) => link.healthy,
              ),
          ),
        )
      ) {
        clearTimeout(deadline);
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await phone.screenshot({ path: `artifacts/internet-join-${kind}.png` });
  await writeFile(
    `artifacts/internet-join-${kind}.json`,
    JSON.stringify({ kind, logs, errors }, null, 2),
  );
  console.log(
    `PASS ${kind}: delayed ICE, duplicate membership, phone join/refresh, description-first trickle, host/client server reports`,
  );
} finally {
  await browser.close();
  await service.close();
}
