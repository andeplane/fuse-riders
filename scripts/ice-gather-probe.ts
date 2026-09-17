import { chromium, webkit } from "playwright";
import { DEFAULT_ICE_SERVERS } from "fuse-network-be";
/** Redacted ICE gathering evidence: candidate types per STUN config, never addresses. Issue #12. */
const browser = await (
  process.env.BROWSER === "webkit" ? webkit : chromium
).launch({ headless: true });
const page = await browser.newPage();
await page.goto(
  process.env.PROBE_URL ??
    "https://andeplane.github.io/fuse-riders/?analytics=0",
);
const servers: RTCIceServer[] = process.env.ICE_SERVERS
  ? process.env.ICE_SERVERS.split(",").map((urls) => ({ urls }))
  : [...DEFAULT_ICE_SERVERS];
const result = await page.evaluate(async (servers) => {
  const pc = new RTCPeerConnection({ iceServers: servers });
  pc.createDataChannel("probe");
  const types: Record<string, number> = {};
  const startedAt = performance.now();
  let firstSrflxMs: number | undefined;
  pc.onicecandidate = (event) => {
    const c = event.candidate;
    if (!c) return;
    const type =
      c.candidate === ""
        ? "end-of-candidates"
        : `${c.type ?? "unknown"}/${c.protocol ?? "?"}`;
    types[type] = (types[type] ?? 0) + 1;
    if (c.type === "srflx" && firstSrflxMs === undefined)
      firstSrflxMs = Math.round(performance.now() - startedAt);
  };
  await pc.setLocalDescription(await pc.createOffer());
  // tsx keepNames injects __name for const-assigned arrows, which does not exist inside page.evaluate.
  await new Promise<void>((resolve) => {
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") resolve();
    };
    setTimeout(resolve, 8000);
    if (pc.iceGatheringState === "complete") resolve();
  });
  const out = {
    gatheringState: pc.iceGatheringState,
    gatherMs: Math.round(performance.now() - startedAt),
    firstSrflxMs,
    types,
  };
  pc.close();
  return out;
}, servers);
console.log(
  JSON.stringify({
    browser: process.env.BROWSER === "webkit" ? "webkit" : "chromium",
    servers: servers.map((s) => s.urls),
    ...result,
  }),
);
await browser.close();
if (!Object.keys(result.types).some((type) => type.startsWith("srflx"))) {
  console.error(
    "No server-reflexive candidate gathered: STUN unreachable or UDP blocked",
  );
  process.exit(1);
}
