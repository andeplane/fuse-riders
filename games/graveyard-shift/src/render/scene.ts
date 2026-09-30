import type { WorldView } from "../engine/view.js";
export const COLORS = ["#64e4ef", "#ff927c", "#edc75b", "#b39aff", "#a2e482"];
export type Paint = Pick<
  CanvasRenderingContext2D,
  | "clearRect"
  | "createLinearGradient"
  | "fillStyle"
  | "fillRect"
  | "beginPath"
  | "ellipse"
  | "fill"
  | "font"
  | "textAlign"
  | "fillText"
  | "shadowColor"
  | "shadowBlur"
  | "moveTo"
  | "lineTo"
  | "roundRect"
  | "save"
  | "translate"
  | "rotate"
  | "restore"
  | "strokeStyle"
  | "lineWidth"
  | "stroke"
  | "quadraticCurveTo"
  | "bezierCurveTo"
  | "closePath"
  | "arc"
  | "globalAlpha"
>;
/** Cosmetic drawing only. Every position, resistance and tank is supplied by the simulation. */
export function draw(ctx: Paint, w: WorldView, me: string): void {
  const c = ctx;
  const { graves: GRAVES, shrines: SHRINES, walls: WALLS } = w.arena;
  c.clearRect(0, 0, 1000, 620);
  const sky = c.createLinearGradient(0, 0, 0, 620);
  sky.addColorStop(0, "#111729");
  sky.addColorStop(0.5, "#213a40");
  sky.addColorStop(1, "#121f2b");
  c.fillStyle = sky;
  c.fillRect(0, 0, 1000, 620);
  const ellipse = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: string,
  ) => {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  };
  const rect = (x: number, y: number, a: number, b: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, y, a, b);
  };
  const text = (
    s: string,
    x: number,
    y: number,
    size = 12,
    color = "#c2dcd5",
  ) => {
    c.font = `bold ${size}px monospace`;
    c.fillStyle = color;
    c.textAlign = "center";
    c.fillText(s, x, y);
  };
  c.shadowColor = "#b7e8d1";
  c.shadowBlur = 40;
  ellipse(820, 44, 30, 30, "#c1d9ce");
  c.shadowBlur = 0;
  // Ruined chapel, arched windows and crooked iron boundary.
  c.fillStyle = "#1b2638";
  c.beginPath();
  c.moveTo(376, 100);
  c.lineTo(380, 30);
  c.lineTo(418, 30);
  c.lineTo(436, 8);
  c.lineTo(456, 30);
  c.lineTo(469, 25);
  c.lineTo(492, 42);
  c.lineTo(550, 30);
  c.lineTo(568, 45);
  c.lineTo(625, 44);
  c.lineTo(637, 100);
  c.fill();
  for (const x of [411, 458, 532, 578]) {
    c.fillStyle = "#080f1c";
    c.beginPath();
    c.roundRect(x, 49, 20, 45, [10, 10, 0, 0]);
    c.fill();
    rect(x + 8, 53, 3, 34, "#446d68");
  }
  text("ST. HOLLOW", 502, 88, 11, "#819f9b");
  for (let x = 20; x < 1000; x += 23) {
    rect(x, 76, 3, 37, "#111723");
    c.beginPath();
    c.moveTo(x - 4, 80);
    c.lineTo(x + 1, 69);
    c.lineTo(x + 6, 80);
    c.fillStyle = "#111723";
    c.fill();
  }
  rect(10, 91, 980, 3, "#0e1722");
  // Stone floor, broad central paths, grass and candles.
  for (let y = 112; y < 600; y += 30)
    for (let x = 25; x < 980; x += 48) {
      const n = (x * 13 + y * 7) % 23;
      rect(
        x + (y % 60 ? 20 : 0),
        y,
        44,
        26,
        `rgba(112,150,146,${0.025 + n * 0.002})`,
      );
    }
  for (let i = 0; i < 75; i++) {
    const x = 28 + ((i * 139) % 940),
      y = 116 + ((i * 97) % 470);
    c.strokeStyle = "#34594b";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - 3, y - 8);
    c.moveTo(x, y);
    c.lineTo(x + 4, y - 5);
    c.stroke();
  }
  for (const g of GRAVES) {
    ellipse(g.x + 2, g.y + 10, 36, 12, "#101b24");
    c.save();
    c.translate(g.x, g.y);
    c.rotate(((g.x % 3) - 1) * 0.08);
    c.fillStyle = "#50626a";
    c.beginPath();
    c.roundRect(-15, -32, 30, 40, [13, 13, 2, 2]);
    c.fill();
    rect(-2, -23, 4, 20, "#263a44");
    rect(-8, -17, 16, 3, "#263a44");
    c.restore();
  }
  for (const r of WALLS) {
    ellipse(r.x + r.w / 2, r.y + r.h, 65, 14, "#111a24");
    rect(r.x, r.y, r.w, r.h, "#263843");
    rect(r.x, r.y, r.w, 9, "#718086");
    for (let x = r.x + 4; x < r.x + r.w; x += 27)
      rect(x, r.y + 17, 23, 2, "#445962");
  }
  for (const s of SHRINES) {
    c.shadowColor = "#e3c077";
    c.shadowBlur = 25;
    ellipse(s.x, s.y, 49, 27, "#b18b4240");
    c.shadowBlur = 0;
    ellipse(s.x, s.y, 46, 23, "#46514f");
    ellipse(s.x, s.y - 3, 37, 18, "#101d29");
    c.strokeStyle = "#e5c581";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(s.x, s.y - 3, 37, 18, 0, 0, Math.PI * 2);
    c.stroke();
    rect(s.x - 25, s.y - 66, 50, 37, "#384c50");
    c.fillStyle = "#9affd3";
    c.shadowColor = "#87ffc7";
    c.shadowBlur = 22;
    c.beginPath();
    c.moveTo(s.x, s.y - 66);
    c.lineTo(s.x + 15, s.y - 47);
    c.lineTo(s.x, s.y - 31);
    c.lineTo(s.x - 15, s.y - 47);
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    text("CONTAIN", s.x, s.y + 43, 12, "#e6d294");
    text("HOLD STILL", s.x, s.y + 58, 9, "#a3b6af");
  }
  for (const x of [60, 210, 410, 590, 790, 940])
    for (const y of [117, 564]) {
      rect(x, y, 5, 12, "#c9b692");
      c.shadowColor = "#ffb95c";
      c.shadowBlur = 17;
      ellipse(x + 2, y - 3, 3, 6, "#ffe8ab");
      c.shadowBlur = 0;
    }
  // Telegraphs, suction ribbons, ghosts.
  for (const g of w.ghosts) {
    if (g.carrier) continue;
    if (g.emerge) {
      c.strokeStyle = "#88ffc68c";
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(g.x, g.y + 8, 30 - g.emerge / 2, 12, 0, 0, Math.PI * 2);
      c.stroke();
      text("✦", g.x, g.y - 12, 18, "#8af5c8");
    }
  }
  for (const h of w.hunters) {
    const g = w.ghosts.find((g) => g.id === h.beam && !g.carrier);
    if (!g) continue;
    c.strokeStyle = COLORS[h.slot] + "55";
    c.lineWidth = 18;
    c.beginPath();
    c.moveTo(h.x + h.dx * 17, h.y + h.dy * 17 - 9);
    c.lineTo(g.x, g.y - 8);
    c.stroke();
    c.strokeStyle = COLORS[h.slot]!;
    c.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.moveTo(h.x, h.y - 9);
      c.quadraticCurveTo(
        (g.x + h.x) / 2 + Math.sin(w.tick * 0.6 + k) * 12,
        (g.y + h.y) / 2 - 18 + k * 9,
        g.x,
        g.y - 8,
      );
      c.stroke();
    }
  }
  for (const g of w.ghosts) {
    if (g.carrier || g.emerge) continue;
    const size = g.kind === 4 ? 24 : 15;
    const color = g.kind === 4 ? "#ffbb9a" : "#9df3cf";
    const bob = Math.sin(w.tick * 0.16 + g.id) * 3;
    ellipse(g.x, g.y + 16, size, 6, "#0c182a88");
    c.save();
    c.translate(g.x, g.y + bob);
    c.shadowColor = color;
    c.shadowBlur = 18;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(-size, size);
    c.bezierCurveTo(
      -size * 1.5,
      -size * 1.4,
      size * 1.5,
      -size * 1.4,
      size,
      size,
    );
    c.lineTo(size * 0.4, size * 0.7);
    c.lineTo(0, size * 1.1);
    c.lineTo(-size * 0.4, size * 0.7);
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    ellipse(-size * 0.3, -2, 3, 5, "#153644");
    ellipse(size * 0.3, -2, 3, 5, "#153644");
    ellipse(0, 8, 4, 5, "#153644");
    c.strokeStyle = g.tug ? "#fff3bb" : color;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(
      0,
      0,
      size + 7,
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * g.resistance) / (g.kind === 4 ? 100 : 36),
    );
    c.stroke();
    c.restore();
    text(g.tug ? "TUG!" : `+${g.kind}`, g.x, g.y - size - 15, 11, color);
  }
  for (const h of [...w.hunters].sort((a, b) => a.y - b.y)) {
    const color = COLORS[h.slot]!;
    ellipse(h.x, h.y + 15, 24, 9, "#09152199");
    if (h.id === me) {
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(h.x, h.y + 15, 29, 12, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.save();
    c.translate(h.x, h.y);
    if (h.protection && w.tick % 4 < 2) c.globalAlpha = 0.65;
    // Oversized containment tank, flexible hose and compact hunter.
    rect(-23, -25, 24, 37, "#111e2d");
    rect(-20, -23, 19, 30, "#4a7081");
    rect(-17, -20, 13, 24, "#8ae7d033");
    for (let i = 0; i < h.tank.length; i++) {
      ellipse(-11, -15 + i * 4, 5, 4, "#adffdd");
      rect(-13, -17 + i * 4, 1, 2, "#1a4352");
      rect(-10, -17 + i * 4, 1, 2, "#1a4352");
    }
    rect(-21, -26, 21, 4, "#b8b08b");
    rect(-21, 6, 21, 4, "#b8b08b");
    rect(-9, -6, 25, 23, color);
    rect(-8, 14, 9, 9, "#142335");
    rect(8, 14, 9, 9, "#142335");
    ellipse(6, -14, 12, 13, "#d3af8c");
    ellipse(6, -22, 15, 7, color);
    rect(-9, -21, 30, 4, "#152c3d");
    rect(3, -19, 15, 8, "#223b48");
    rect(7, -18, 8, 3, "#9cece5");
    c.strokeStyle = "#182534";
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(-20, 5);
    c.bezierCurveTo(-36, 28, 28, 33, 22, -1);
    c.stroke();
    c.strokeStyle = "#778c8a";
    c.lineWidth = 2;
    c.stroke();
    const angle = Math.atan2(h.dy, h.dx);
    c.save();
    c.rotate(angle);
    rect(8, -6, 25, 9, "#9daaad");
    rect(29, -9, 9, 15, "#253d4c");
    c.restore();
    c.restore();
    text(h.id === me ? "YOU" : `P${h.slot + 1}`, h.x, h.y - 43, 11, color);
    text(`${h.tank.length}/5`, h.x, h.y + 36, 10, "#d1eae1");
    if (h.deposit) {
      c.strokeStyle = "#f1d691";
      c.lineWidth = 5;
      c.beginPath();
      c.arc(
        h.x,
        h.y,
        34,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * h.deposit) / 25,
      );
      c.stroke();
    }
    if (h.pulse) {
      c.strokeStyle = color + "aa";
      c.lineWidth = 3;
      c.beginPath();
      const a = Math.atan2(h.dy, h.dx);
      c.arc(h.x, h.y, 105 - h.pulse * 8, a - 0.8, a + 0.8);
      c.stroke();
    }
  }
  // Low mist stays beneath labels and never masks targets.
  for (let i = 0; i < 4; i++)
    ellipse(
      160 + i * 250 + Math.sin(w.tick * 0.008 + i) * 24,
      570 - i * 135,
      170,
      12,
      "#b2eee007",
    );
}
