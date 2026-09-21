import type { BallView } from "../engine/view.js";

/** The HUD is derived from the latest view, including corrected rollback outcomes. */
export function present(v: BallView) {
  const s = v.arena;
  if (!s) return undefined;
  const you = s.bases.find((b) => !b.bot);
  const seconds = Math.floor(
    Math.max(0, v.rules.limit - Math.max(0, s.tick - v.rules.countdown)) / 20,
  );
  return {
    cards: s.bases.map((b) => ({
      slot: b.slot,
      name: `P${b.slot + 1} ${b.name.toUpperCase()}`,
      alive: b.alive,
      armor: b.alive
        ? `${b.blocks.filter((k) => k.alive).length} / ${b.blocks.length}`
        : "CORE LOST",
      label: b.alive ? "ARMOR BLOCKS" : "SPECTATING",
    })),
    time: `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`,
    toast:
      s.phase === "countdown"
        ? `GET READY · ${Math.ceil((v.rules.countdown - s.tick) / 20)}`
        : s.phase === "over"
          ? ""
          : !you?.alive
            ? "CORE LOST · WATCH THE FINISH"
            : s.balls.some((b) => b.held === you.id)
              ? "W / SPACE TO LAUNCH"
              : "",
    over: s.phase === "over",
    title: s.winner
      ? `${s.bases.find((b) => b.id === s.winner)!.name.toUpperCase()} WINS`
      : "ROUND DRAW",
    result: `Your saves: ${you?.saves ?? 0} · Enemy blocks broken: ${you?.broken ?? 0}`,
  };
}
