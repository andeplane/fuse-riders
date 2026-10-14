import type { Page } from "playwright";
import { writeFile } from "node:fs/promises";
import { SnapshotAssembler, decodeSnapshot, decodePacket } from "fuse-netcode";
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
  const observedPasses = new Set<string>();
  await page.exposeBinding(
    "birdsPassPacketProbe",
    async (_source, channel: string, bytes: number[]) => {
      const decoded = decodePacket(birdsGame, Uint8Array.from(bytes));
      if (!decoded || !("packet" in decoded)) return;
      const packet = decoded.packet;
      for (const entry of packet.entries) {
        if (entry[2] !== 0 || entry[4].type !== "pass") continue;
        const key = `${channel}:${packet.from}:${packet.generation}:${entry[0]}`;
        if (observedPasses.has(key) || observedPasses.size >= 200) continue;
        observedPasses.add(key);
        console.log("PASS packet probe", label, channel, {
          from: packet.from,
          generation: packet.generation,
          seq: entry[0],
          tick: entry[1],
          through: packet.through,
          clockTick: packet.clockTick,
          action: entry[4],
        });
      }
    },
  );
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
        turn: decoded?.state.match?.turn,
        seats:
          decoded &&
          [...decoded.state.seats.values()].map((seat) => ({
            id: seat.id,
            generation: seat.generation,
            connected: seat.connected,
            away: seat.away === true,
          })),
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
    let passPackets = 0;
    const observe = channel => {
      const id = String(next++) + ":" + channel.label;
      const report = (direction, data) => {
        if (typeof data !== "string") {
          // Observe only bounded input datagrams containing MessagePack's encoded "pass" token.
          // This diagnostic never changes the bytes, channel readiness or delivery order.
          const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
            : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
          if (!bytes || bytes.length > 1100 || passPackets >= 200) return;
          for (let at = 0; at < bytes.length - 4; at++) {
            if (bytes[at] === 164 && bytes[at + 1] === 112 && bytes[at + 2] === 97 && bytes[at + 3] === 115 && bytes[at + 4] === 115) {
              passPackets++;
              void window.birdsPassPacketProbe(id + direction, Array.from(bytes)).catch(() => {});
              break;
            }
          }
          return;
        }
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
