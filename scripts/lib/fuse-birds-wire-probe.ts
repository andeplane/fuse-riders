import type { Page } from "playwright";
import { writeFile } from "node:fs/promises";
import { SnapshotAssembler, decodeSnapshot } from "fuse-netcode";
import {
  birdsGame,
  type BirdsRoom,
} from "../../games/fuse-birds/src/online/game.js";

/** Diagnostic-only observation of this smoke's isolated WebRTC pages; it never changes a packet. */
export async function wireProbe(
  page: Page,
  output: string,
  label: string,
  observe?: (state: BirdsRoom) => void,
): Promise<void> {
  let count = 0;
  const assemblers = new Map<string, SnapshotAssembler>();
  await page.exposeBinding(
    "birdsWireProbe",
    async (_source, channel: string, raw: unknown) => {
      if (
        raw &&
        typeof raw === "object" &&
        "type" in raw &&
        ["snapshotRequest", "noWorld"].includes(String(raw.type))
      )
        console.log("Snapshot control", label, channel, raw.type);
      if (
        raw &&
        typeof raw === "object" &&
        "type" in raw &&
        raw.type === "snapshot" &&
        "chunk" in raw &&
        "total" in raw &&
        (raw.chunk === 0 || Number(raw.chunk) === Number(raw.total) - 1)
      )
        console.log("Snapshot boundary", label, channel, raw.chunk, raw.total);
      if (
        !raw ||
        typeof raw !== "object" ||
        !("type" in raw) ||
        raw.type !== "snapshot" ||
        !("room" in raw) ||
        typeof raw.room !== "number" ||
        !("rules" in raw) ||
        typeof raw.rules !== "string"
      )
        return;
      const key = `${channel}:${raw.room}:${raw.rules}`;
      let assembler = assemblers.get(key);
      if (!assembler) {
        assembler = new SnapshotAssembler({ rules: raw.rules }, raw.room);
        assemblers.set(key, assembler);
      }
      const complete = assembler.accept(raw);
      if (!complete || count++ >= 30) return;
      const decoded = decodeSnapshot(birdsGame, complete.bytes, raw.room);
      if (decoded) observe?.(decoded.state);
      console.log("Snapshot probe", label, channel, {
        rules: raw.rules,
        tick: complete.tick,
        bytes: complete.bytes.length,
        decoded: !!decoded,
        phase: decoded?.state.match?.phase,
      });
      if (!decoded)
        await writeFile(
          `${output}/${label}-rejected-${count}.bin`,
          complete.bytes,
        );
    },
  );
  await page.addInitScript({
    content: `(() => {
    let next = 0;
    const observe = channel => {
      const id = String(next++) + ":" + channel.label;
      const report = (direction, data) => {
        if (typeof data !== "string") return;
        try { void window.birdsWireProbe(id + direction, JSON.parse(data).data).catch(() => {}); } catch {}
      };
      const send = channel.send.bind(channel);
      channel.send = data => { report(" out", data); return send(data); };
      channel.addEventListener("message", event => {
        report(" in", event.data);
      });
    };
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config) { super(config); this.addEventListener("datachannel", e => observe(e.channel)); }
      createDataChannel(label, options) { const channel = super.createDataChannel(label, options); observe(channel); return channel; }
    };
  })();`,
  });
}
