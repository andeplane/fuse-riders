import type { BallView } from "../engine/view.js";

/** The HUD is derived from the latest view, including corrected rollback outcomes. */
export function present(v: BallView, playerId?: string) {
  const s = v.arena;
  if (!s) return undefined;
  const you = s.bases.find((b) =>
    playerId === undefined ? !b.bot : b.id === playerId,
  );
  const effects = (b: (typeof s.bases)[number]) => {
    if (!b.alive) return "";
    const seconds = (until: number) => `${Math.ceil((until - s.tick) / 20)}s`;
    return [
      b.stunUntil > s.tick ? `STUN ${seconds(b.stunUntil)}` : "",
      b.shrink.length
        ? `SHRINK ×${b.shrink.length} ${seconds(b.shrink[0]!)}`
        : "",
      b.stickyUntil > s.tick ? `STICKY ${seconds(b.stickyUntil)}` : "",
      b.thiefUntil > s.tick ? `THIEF ${seconds(b.thiefUntil)}` : "",
      s.balls.some((ball) => ball.owner === b.id && ball.bomb)
        ? "BOMB BALL"
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const seconds = Math.floor(
    Math.max(0, v.rules.limit - Math.max(0, s.tick - v.rules.countdown)) / 20,
  );
  return {
    effects: you ? effects(you) : "",
    cards: s.bases.map((b) => ({
      slot: b.slot,
      name: `P${b.slot + 1} ${b.name.toUpperCase()}`,
      alive: b.alive,
      armor: b.alive
        ? `${b.blocks.filter((k) => k.alive).length} / ${b.blocks.length}`
        : "CORE LOST",
      label: b.alive ? effects(b) || "ARMOR BLOCKS" : "SPECTATING",
    })),
    time: `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`,
    toast:
      s.phase === "countdown"
        ? `GET READY · ${Math.ceil((v.rules.countdown - s.tick) / 20)}`
        : s.phase === "over"
          ? ""
          : you && !you.alive
            ? "CORE LOST · WATCH THE FINISH"
            : you && s.balls.some((b) => b.held === you.id)
              ? "SPACE TO LAUNCH"
              : "",
    over: s.phase === "over",
    title: s.winner
      ? `${s.bases.find((b) => b.id === s.winner)!.name.toUpperCase()} WINS`
      : "ROUND DRAW",
    result: you
      ? `Your saves: ${you.saves} · Enemy blocks broken: ${you.broken}`
      : "Last core standing wins",
  };
}
