import type Phaser from "phaser";
import { config } from "../../game/sim/config.js";
import { trackDirectionAt } from "../../game/sim/race.js";
import type { Point, Segment, Track } from "../../game/sim/track.js";
import { lerp } from "../../game/sim/truck.js";
import { DECOR } from "./assets.js";

/**
 * The static picture of a track: one baked ground canvas (dirt, hazards, stadium) under everything and two
 * baked overlays (kerbs and the finish line, then bridge decks and their railings) over it. Ported from the
 * game's `RaceScene.drawTrack` / `drawGround` / `paintHazards`; nothing here reads the race state, so it is
 * built once per track and never touched again.
 */

/** Tiny seeded LCG so a track's decor lays out the same way every race. Presentation only. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Stroke wall polylines as round-jointed pieces, colouring by distance along the polyline so stripes
 * continue across the short Tiled segments. Consecutive segments that share an endpoint carry the distance.
 */
function strokeWalls(
  g: Phaser.GameObjects.Graphics,
  walls: Segment[],
  width: number,
  color: (dist: number) => number,
): void {
  const step = 2;
  let run = 0;
  let prev: Segment | undefined;
  for (const w of walls) {
    if (!prev || prev.b.x !== w.a.x || prev.b.y !== w.a.y) run = 0;
    prev = w;
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    for (let d = 0; d < len; d += step) {
      const t0 = d / len,
        t1 = Math.min(len, d + step) / len;
      g.lineStyle(width, color(run + d));
      g.lineBetween(
        lerp(w.a.x, w.b.x, t0),
        lerp(w.a.y, w.b.y, t0),
        lerp(w.a.x, w.b.x, t1),
        lerp(w.a.y, w.b.y, t1),
      );
    }
    g.fillStyle(color(run + len)).fillCircle(w.b.x, w.b.y, width / 2);
    run += len;
  }
}

interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/**
 * Hazards painted as shapes over their tiles, never as squares: pools with a dark rim and a shine, an oil
 * slick with a sheen, mogul humps, wooden ramps, glowing boost chevrons pointing along the track, tarmac.
 */
function paintHazards(
  ctx: CanvasRenderingContext2D,
  track: Track,
  rand: () => number,
): void {
  const { tile } = config;
  const { cols, surface } = track;
  const cells = (kind: string): Point[] =>
    surface.flatMap((s, i) =>
      s === kind
        ? [
            {
              x: (i % cols) * tile + tile / 2,
              y: Math.floor(i / cols) * tile + tile / 2,
            },
          ]
        : [],
    );
  /** Connected groups of tiles of one kind, each as one smooth ellipse around them. */
  const ellipses = (kind: string): Ellipse[] => {
    const pts = cells(kind),
      seen = new Set<number>(),
      out: Ellipse[] = [];
    pts.forEach((_, start) => {
      if (seen.has(start)) return;
      const group = [start];
      seen.add(start);
      for (let g = 0; g < group.length; g++) {
        const at = pts[group[g]!]!;
        pts.forEach((q, j) => {
          if (
            !seen.has(j) &&
            Math.hypot(q.x - at.x, q.y - at.y) <= tile * 1.5
          ) {
            seen.add(j);
            group.push(j);
          }
        });
      }
      const xs = group.map((j) => pts[j]!.x),
        ys = group.map((j) => pts[j]!.y);
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys);
      out.push({
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        rx: (x1 - x0) / 2 + tile * 0.6,
        ry: (y1 - y0) / 2 + tile * 0.6,
      });
    });
    return out;
  };
  const oval = (
    e: Ellipse,
    grow: number,
    fill: string,
    dx = 0,
    dy = 0,
  ): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(
      e.x + dx,
      e.y + dy,
      Math.max(1, e.rx + grow),
      Math.max(1, e.ry + grow),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  const pool = (
    kind: string,
    rim: string,
    body: string,
    deep: string,
    shine: string,
  ): Ellipse[] => {
    const list = ellipses(kind);
    for (const e of list) {
      oval(e, 5, "rgba(0,0,0,0.45)", 3, 4);
      oval(e, 3, "#1a1008");
      oval(e, 0, rim);
      oval(e, -5, body);
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.ellipse(
        e.x + e.rx * 0.12,
        e.y + e.ry * 0.15,
        e.rx * 0.55,
        e.ry * 0.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.ellipse(
        e.x - e.rx * 0.4,
        e.y - e.ry * 0.45,
        e.rx * 0.28,
        e.ry * 0.12,
        -0.3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    return list;
  };
  /** A raised red/white barrier ring around a pool, its front half showing a face like the tilted concept. */
  const ring = (e: Ellipse): void => {
    const rx = e.rx + 6,
      ry = e.ry + 6,
      steps = Math.ceil((Math.PI * (rx + ry)) / 3);
    const at = (i: number, dy = 0): readonly [number, number] => {
      const a = (i / steps) * Math.PI * 2;
      return [e.x + Math.cos(a) * rx, e.y + Math.sin(a) * ry + dy] as const;
    };
    const stroke = (
      width: number,
      color: (i: number) => string,
      dy = 0,
      only?: (i: number) => boolean,
    ): void => {
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      for (let i = 0; i < steps; i++) {
        if (only && !only(i)) continue;
        ctx.strokeStyle = color(i);
        ctx.beginPath();
        ctx.moveTo(...at(i, dy));
        ctx.lineTo(...at(i + 1, dy));
        ctx.stroke();
      }
    };
    const stripe = (i: number): boolean => Math.floor((i * 3) / 14) % 2 === 0;
    const front = (i: number): boolean =>
      Math.sin(((i + 0.5) / steps) * Math.PI * 2) > -0.2;
    stroke(11, () => "#000", 5, front);
    stroke(8, (i) => (stripe(i) ? "#6a1010" : "#6e6e78"), 4, front);
    stroke(11, () => "#000");
    stroke(8, (i) => (stripe(i) ? "#f03a3a" : "#ffffff"));
  };
  for (const e of pool(
    "toxic",
    "#3c5a18",
    "#6ee030",
    "#3fa51e",
    "rgba(235,255,180,0.8)",
  )) {
    ring(e);
    ctx.strokeStyle = "rgba(210,255,140,0.85)";
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.arc(
        e.x + (rand() - 0.5) * e.rx,
        e.y + (rand() - 0.5) * e.ry,
        1.5 + rand() * 3,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  /** Stones around a puddle's rim, lit from the top left, like the concept's rocky mud hole. */
  const stones = (e: Ellipse): void => {
    const n = Math.round((e.rx + e.ry) / 5);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.2,
        r = 3 + rand() * 3;
      const x = e.x + Math.cos(a) * (e.rx + 1),
        y = e.y + Math.sin(a) * (e.ry + 1);
      ctx.fillStyle = "#1a1008";
      ctx.beginPath();
      ctx.ellipse(x + 1, y + 1.5, r + 1, r * 0.8 + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = k % 3 ? "#7a6a58" : "#9a8a74";
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(
        x - r * 0.3,
        y - r * 0.3,
        r * 0.35,
        r * 0.25,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  };
  /** Ripple arcs across a wet surface. */
  const ripples = (e: Ellipse, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (const f of [0.35, 0.6, 0.82]) {
      ctx.beginPath();
      ctx.ellipse(
        e.x + e.rx * 0.08,
        e.y + e.ry * 0.1,
        e.rx * f,
        e.ry * f,
        0,
        0.3,
        2.6,
      );
      ctx.stroke();
    }
  };
  for (const e of pool(
    "water",
    "#5a4020",
    "#3f94e6",
    "#2464b4",
    "rgba(225,245,255,0.85)",
  )) {
    ripples(e, "rgba(200,235,255,0.55)");
    stones(e);
  }
  for (const e of pool(
    "mud",
    "#4a2e14",
    "#6a4422",
    "#4e3016",
    "rgba(170,125,80,0.5)",
  )) {
    // Tyre ruts through the mud, then wet ripples and the stone rim.
    ctx.strokeStyle = "rgba(30,18,8,0.55)";
    ctx.lineWidth = 3;
    for (const off of [-10, 10]) {
      ctx.beginPath();
      ctx.moveTo(e.x - e.rx * 0.85, e.y + off);
      ctx.quadraticCurveTo(
        e.x,
        e.y + off - e.ry * 0.25,
        e.x + e.rx * 0.85,
        e.y + off,
      );
      ctx.stroke();
    }
    ripples(e, "rgba(160,120,80,0.45)");
    stones(e);
  }

  // Oil: one flat glossy slick per patch with an irregular edge, a rainbow sheen and a white glint.
  for (const e of ellipses("oil")) {
    const edge = (growX: number, growY: number): void => {
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const a = (k / 24) * Math.PI * 2,
          wob = 1 + 0.12 * Math.sin(a * 3 + e.x) + 0.08 * Math.sin(a * 5 + e.y);
        ctx.lineTo(
          e.x + Math.cos(a) * (e.rx + growX) * wob,
          e.y + Math.sin(a) * (e.ry + growY) * wob,
        );
      }
    };
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    edge(3, 2);
    ctx.fill();
    const g = ctx.createRadialGradient(
      e.x - e.rx * 0.3,
      e.y - e.ry * 0.3,
      2,
      e.x,
      e.y,
      Math.max(e.rx, e.ry),
    );
    g.addColorStop(0, "#3a3a48");
    g.addColorStop(1, "#0a0a10");
    ctx.fillStyle = g;
    edge(0, 0);
    ctx.fill();
    ctx.lineWidth = 2.5;
    for (const [c, f] of [
      ["rgba(255,70,200,0.55)", 0.55],
      ["rgba(70,220,255,0.55)", 0.68],
      ["rgba(255,230,70,0.45)", 0.8],
    ] as const) {
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.ellipse(e.x + e.rx * 0.1, e.y, e.rx * f, e.ry * f, 0, 3.4, 5.6);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(
      e.x - e.rx * 0.35,
      e.y - e.ry * 0.35,
      e.rx * 0.18,
      e.ry * 0.08,
      -0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Tarmac: dark speckled asphalt, a yellow dashed centre line along the racing line, and a few skid marks.
  const tarmac = cells("tarmac");
  for (const p of tarmac) {
    ctx.fillStyle = "#3a3a42";
    ctx.fillRect(p.x - tile / 2, p.y - tile / 2, tile, tile);
    for (let k = 0; k < 22; k++) {
      ctx.fillStyle =
        rand() < 0.5 ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.1)";
      ctx.fillRect(
        p.x - tile / 2 + rand() * tile,
        p.y - tile / 2 + rand() * tile,
        2,
        2,
      );
    }
  }
  if (tarmac.length) {
    const wp = track.waypoints;
    const onTarmac = (x: number, y: number): boolean =>
      surface[Math.floor(y / tile) * cols + Math.floor(x / tile)] === "tarmac";
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 4;
    for (let k = 0; k < 6; k++) {
      const p = tarmac[Math.floor(rand() * tarmac.length)]!;
      ctx.beginPath();
      ctx.moveTo(p.x - 30, p.y + (rand() - 0.5) * 30);
      ctx.quadraticCurveTo(
        p.x,
        p.y + (rand() - 0.5) * 40,
        p.x + 30,
        p.y + (rand() - 0.5) * 30,
      );
      ctx.stroke();
    }
    ctx.strokeStyle = "#f2d23a";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    wp.forEach((a, i) => {
      const b = wp[(i + 1) % wp.length]!;
      if (onTarmac((a.x + b.x) / 2, (a.y + b.y) / 2)) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Moguls: a row of raised dirt humps with a hard shadow and a sunlit top, like hay-bale mounds.
  for (const e of ellipses("mogul")) {
    const w = 26,
      h = e.ry * 2 - 10,
      x = e.x - w / 2,
      y = e.y - h / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 7, w, h, 12);
    ctx.fill();
    ctx.fillStyle = "#3a2410";
    ctx.beginPath();
    ctx.roundRect(x - 1, y + 2, w + 2, h + 2, 13);
    ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#e6b468");
    g.addColorStop(0.55, "#b07636");
    g.addColorStop(1, "#7a4c22");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h - 2, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(90,55,20,0.6)";
    ctx.lineWidth = 1.5;
    for (let yy = y + 8; yy < y + h - 8; yy += 7) {
      ctx.beginPath();
      ctx.moveTo(x + 4, yy);
      ctx.lineTo(x + w - 4, yy + 2);
      ctx.stroke();
    }
  }

  for (const p of cells("ramp")) {
    const dir = trackDirectionAt(track, p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(dir.y, dir.x));
    // A wooden jump wedge rising toward its lip, planks across the direction of travel.
    const h = tile / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(h, -h, 12, tile);
    ctx.fillStyle = "#000";
    ctx.fillRect(-h - 2, -h - 2, tile + 4, tile + 4);
    for (let s = -h, k = 0; s < h; s += 6, k++) {
      const lit = 0.55 + 0.45 * ((s + h) / tile);
      ctx.fillStyle = `rgb(${Math.round(150 * lit)},${Math.round(98 * lit)},${Math.round(50 * lit)})`;
      ctx.fillRect(s, -h, 5, tile);
      if (k % 2) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(s, -h + 4, 5, 2);
      }
    }
    ctx.fillStyle = "#5a3818";
    ctx.fillRect(h - 5, -h, 5, tile);
    ctx.fillStyle = "#d9d9e0";
    for (const y of [-h + 3, h - 6]) ctx.fillRect(-h, y, tile, 3);
    ctx.restore();
  }

  for (const p of cells("boost")) {
    const dir = trackDirectionAt(track, p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(dir.y, dir.x));
    ctx.fillStyle = "#000";
    ctx.fillRect(-tile / 2, -tile / 2, tile, tile);
    ctx.fillStyle = "#0c2a6a";
    ctx.fillRect(-tile / 2 + 2, -tile / 2 + 2, tile - 4, tile - 4);
    ctx.strokeStyle = "#4fe3ff";
    ctx.shadowColor = "#4fe3ff";
    ctx.shadowBlur = 6;
    ctx.lineWidth = 4;
    ctx.lineJoin = "miter";
    for (const off of [-7, 5]) {
      ctx.beginPath();
      ctx.moveTo(off - 5, -9);
      ctx.lineTo(off + 5, 0);
      ctx.lineTo(off - 5, 9);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Bake the floor detail and the stadium into one canvas under everything else: tyre grooves and grit on
 * plain dirt, then crowd, fence and industrial props in the area outside the outer barrier.
 */
function paintGround(
  scene: Phaser.Scene,
  track: Track,
  ctx: CanvasRenderingContext2D,
): void {
  const { tile } = config;
  const { cols, rows, surface, walls, waypoints } = track;
  const w = cols * tile,
    h = rows * tile;
  const rand = rng(
    [...track.name].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7),
  );

  // Stadium dirt under everything; there is no tile layer.
  ctx.fillStyle = "#8f5d2f";
  ctx.fillRect(0, 0, w, h);

  // Floor detail, clipped to dirt tiles so hazards keep their own look.
  ctx.save();
  ctx.beginPath();
  surface.forEach((s, i) => {
    if (!s || s === "dirt")
      ctx.rect((i % cols) * tile, Math.floor(i / cols) * tile, tile, tile);
  });
  ctx.clip();
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = i % 3 ? "rgba(60,30,10,0.12)" : "rgba(240,190,120,0.08)";
    ctx.beginPath();
    ctx.ellipse(
      rand() * w,
      rand() * h,
      20 + rand() * 50,
      12 + rand() * 30,
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (let i = 0; i < (w * h) / 60; i++) {
    ctx.fillStyle =
      rand() < 0.6 ? "rgba(50,25,8,0.35)" : "rgba(235,185,120,0.3)";
    ctx.fillRect(
      Math.floor((rand() * w) / 2) * 2,
      Math.floor((rand() * h) / 2) * 2,
      2,
      2,
    );
  }
  // Tyre grooves: parallel strokes along the racing line.
  const last = waypoints[waypoints.length - 1]!,
    first = waypoints[0]!;
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < 200;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  for (let k = -3; k <= 3; k++) {
    ctx.strokeStyle = k % 2 ? "rgba(45,22,6,0.22)" : "rgba(230,180,110,0.12)";
    ctx.beginPath();
    waypoints.forEach((p, i) => {
      const a =
        waypoints[
          closed
            ? (i - 1 + waypoints.length) % waypoints.length
            : Math.max(0, i - 1)
        ]!;
      const b =
        waypoints[
          closed
            ? (i + 1) % waypoints.length
            : Math.min(waypoints.length - 1, i + 1)
        ]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1,
        off = k * 9 + Math.sin(i * 1.7 + k) * 2;
      const x = p.x - ((b.y - a.y) / l) * off,
        y = p.y + ((b.x - a.x) / l) * off;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  paintHazards(ctx, track, rand);

  // Outside = cells reachable from the world border without coming within 30 u of any wall.
  const G = 4,
    gw = Math.ceil(w / G),
    gh = Math.ceil(h / G),
    R = Math.ceil(30 / G);
  const blocked = new Uint8Array(gw * gh),
    out = new Uint8Array(gw * gh);
  for (const s of walls) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    for (let d = 0; d <= len; d += G) {
      const cx = Math.floor(lerp(s.a.x, s.b.x, d / (len || 1)) / G),
        cy = Math.floor(lerp(s.a.y, s.b.y, d / (len || 1)) / G);
      for (let y = Math.max(0, cy - R); y <= Math.min(gh - 1, cy + R); y++) {
        for (let x = Math.max(0, cx - R); x <= Math.min(gw - 1, cx + R); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) blocked[y * gw + x] = 1;
      }
    }
  }
  const stack: number[] = [];
  const push = (i: number): void => {
    if (!blocked[i] && !out[i]) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < gw; x++) {
    push(x);
    push((gh - 1) * gw + x);
  }
  for (let y = 0; y < gh; y++) {
    push(y * gw);
    push(y * gw + gw - 1);
  }
  let count = 0;
  while (stack.length) {
    const i = stack.pop()!,
      x = i % gw;
    count++;
    if (x > 0) push(i - 1);
    if (x < gw - 1) push(i + 1);
    if (i >= gw) push(i - gw);
    if (i < gw * (gh - 1)) push(i + gw);
  }
  // A gap in the outer barrier would flood the lanes; draw no stadium rather than cover the track.
  if (count > out.length / 2) return;

  // Stands only along the world edges; open infield between lane loops stays dirt.
  const band = out.map((v, i) =>
    v &&
    Math.min(
      i % gw,
      gw - 1 - (i % gw),
      Math.floor(i / gw),
      gh - 1 - Math.floor(i / gw),
    ) *
      G <
      80
      ? 1
      : 0,
  );
  const mask = (rgb: string): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = gw;
    c.height = gh;
    const m = c.getContext("2d")!;
    m.fillStyle = rgb;
    band.forEach((v, i) => {
      if (v) m.fillRect(i % gw, Math.floor(i / gw), 1, 1);
    });
    return c;
  };

  const decor = scene.textures.get("decor");
  const sprite = (
    c: CanvasRenderingContext2D,
    index: number,
    x: number,
    y: number,
    size: number,
    angle = 0,
  ): void => {
    const f = decor.get(index);
    const image = f.source.image;
    if (!image) return;
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.drawImage(
      image,
      f.cutX,
      f.cutY,
      f.cutWidth,
      f.cutHeight,
      -size / 2,
      -size / 2,
      size,
      size,
    );
    c.restore();
  };

  // Grandstand: crowd tiles with steel pipes down both side edges, cut to the outside area.
  const stands = document.createElement("canvas");
  stands.width = w;
  stands.height = h;
  const sc = stands.getContext("2d")!;
  sc.fillStyle = "#2e2e34";
  sc.fillRect(0, 0, w, h);
  const source = scene.textures.exists("grandstand")
    ? scene.textures.get("grandstand").getSourceImage()
    : undefined;
  const crowd =
    source instanceof HTMLImageElement || source instanceof HTMLCanvasElement
      ? source
      : undefined;
  if (crowd) {
    // Rows of spectators from the generated grandstand strip, tiled 240 u wide.
    const tw = 240,
      th = (tw * crowd.height) / crowd.width;
    sc.imageSmoothingEnabled = true;
    for (let y = 0; y < h; y += th)
      for (let x = ((Math.round(y / th) % 2) * -tw) / 2; x < w; x += tw)
        sc.drawImage(crowd, x, y, tw, th);
  } else {
    for (let y = 0, r = 0; y < h + 36; y += 34, r++) {
      for (let x = r % 2 ? 0 : 18; x < w + 36; x += 36)
        sprite(sc, DECOR.crowd[Math.floor(rand() * 3)]!, x, y, 46);
    }
  }
  for (let y = 0; y < h + 40; y += 40) {
    sprite(sc, DECOR.pipe, 14, y, 64, Math.PI / 2);
    sprite(sc, DECOR.pipe, w - 14, y, 64, Math.PI / 2);
  }
  sc.globalCompositeOperation = "destination-in";
  sc.imageSmoothingEnabled = false;
  sc.drawImage(mask("#000"), 0, 0, w, h);

  // Fence: black outline then a steel rail around the stands, both from the upscaled mask.
  ctx.imageSmoothingEnabled = false;
  for (const [img, o] of [
    [mask("#000"), 7],
    [mask("#a4a6ae"), 4],
  ] as const) {
    for (const [dx, dy] of [
      [-o, 0],
      [o, 0],
      [0, -o],
      [0, o],
      [-o, -o],
      [o, o],
      [-o, o],
      [o, -o],
    ])
      ctx.drawImage(img, dx!, dy!, w, h);
  }
  ctx.drawImage(stands, 0, 0);

  // Props where they fit entirely inside the outside area, never overlapping each other.
  const used = new Uint8Array(out.length);
  const place = (
    pw: number,
    ph: number,
    cells: Uint8Array,
  ): { x: number; y: number } | undefined => {
    for (let tries = 0; tries < 300; tries++) {
      const x = Math.floor(rand() * (w - pw)),
        y = Math.floor(rand() * (h - ph));
      let ok = true;
      for (
        let gy = Math.floor(y / G);
        ok && gy <= Math.floor((y + ph) / G);
        gy++
      ) {
        for (let gx = Math.floor(x / G); gx <= Math.floor((x + pw) / G); gx++)
          if (!cells[gy * gw + gx] || used[gy * gw + gx]) {
            ok = false;
            break;
          }
      }
      if (!ok) continue;
      for (let gy = Math.floor(y / G); gy <= Math.floor((y + ph) / G); gy++)
        used.fill(
          1,
          gy * gw + Math.floor(x / G),
          gy * gw + Math.floor((x + pw) / G) + 1,
        );
      return { x, y };
    }
    return undefined;
  };
  // Tanks, lights and signs read as blobs next to the generated stadium frame; only tyres and drums are kept.
  for (const [frame, size, n] of [
    [DECOR.tyres, 40, 10],
    [DECOR.drum, 32, 8],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const at = place(size, size, out);
      if (at) sprite(ctx, frame, at.x + size / 2, at.y + size / 2, size);
    }
  }
}

/** The kerbs, the finish line, the bridge decks and their railings, as two baked overlay textures. */
function paintOverlays(
  scene: Phaser.Scene,
  track: Track,
): { key: string; depth: number }[] {
  const g = scene.make.graphics({}, false);
  const barriers = track.walls.filter((w) => !w.deck);
  // Chunky blocks: black outline, a shaded side, a bright top face, black seams between blocks.
  // 14 u wide against a 90 u lane: a kerb the dirt dominates, not a wall as wide as a truck.
  const block = 16,
    seam = (d: number): boolean => d % block < 2;
  // Raised blocks seen from the arcade's elevated camera: a dark front face extruded below the lit top.
  const RISE = 5;
  const lift = (dy: number): Segment[] =>
    barriers.map((w) => ({
      ...w,
      a: { x: w.a.x, y: w.a.y + dy },
      b: { x: w.b.x, y: w.b.y + dy },
    }));
  strokeWalls(g, lift(RISE), 14, () => 0x000000);
  for (let dy = RISE; dy > 0; dy -= 2)
    strokeWalls(g, lift(dy), 10, (d) =>
      seam(d) ? 0x1a0a0a : Math.floor(d / block) % 2 ? 0x6e6e78 : 0x6a1010,
    );
  strokeWalls(g, barriers, 14, () => 0x000000);
  strokeWalls(g, barriers, 10, (d) =>
    seam(d) ? 0x000000 : Math.floor(d / block) % 2 ? 0xb4b4be : 0xb41c1c,
  );
  strokeWalls(g, barriers, 6, (d) =>
    seam(d) ? 0x000000 : Math.floor(d / block) % 2 ? 0xffffff : 0xf03a3a,
  );
  const finish = track.checkpoints[track.checkpoints.length - 1]!;
  const fl = Math.hypot(finish.b.x - finish.a.x, finish.b.y - finish.a.y),
    fx = (finish.b.x - finish.a.x) / fl,
    fy = (finish.b.y - finish.a.y) / fl;
  for (let d = 0, i = 0; d < fl; d += 8, i++) {
    for (const side of [-1, 1]) {
      g.fillStyle((i + (side > 0 ? 1 : 0)) % 2 ? 0x111111 : 0xffffff);
      g.fillRect(
        finish.a.x + fx * d - fy * (side > 0 ? 0 : 8),
        finish.a.y + fy * d + fx * (side > 0 ? 0 : 8),
        8,
        8,
      );
    }
  }

  const decks = scene.make.graphics({}, false);
  for (const b of track.bridges) {
    const w = b.x1 - b.x0,
      h = b.y1 - b.y0;
    const vertical = b.entry === "top" || b.entry === "bottom";
    decks.fillStyle(0x000000, 0.35).fillRect(b.x0 + 10, b.y0 + 12, w, h);
    decks.fillStyle(0x000000).fillRect(b.x0 - 3, b.y0 - 3, w + 6, h + 6);
    // Planks run across the direction of travel, with a dark gap between each.
    const plank = 10;
    for (let o = 0, i = 0; o < (vertical ? h : w); o += plank, i++) {
      decks.fillStyle(i % 2 ? 0x8a5a2b : 0x7a4e24);
      if (vertical) decks.fillRect(b.x0, b.y0 + o, w, plank - 2);
      else decks.fillRect(b.x0 + o, b.y0, plank - 2, h);
    }
    // Steel edge beams with rivets along the two sides parallel to travel.
    decks.fillStyle(0x6e7078);
    const beam = 12;
    if (vertical)
      decks.fillRect(b.x0, b.y0, beam, h).fillRect(b.x1 - beam, b.y0, beam, h);
    else
      decks.fillRect(b.x0, b.y0, w, beam).fillRect(b.x0, b.y1 - beam, w, beam);
    decks.fillStyle(0xc8cad2);
    for (let o = 8; o < (vertical ? h : w); o += 20) {
      if (vertical)
        decks
          .fillRect(b.x0 + 4, b.y0 + o, 4, 4)
          .fillRect(b.x1 - 8, b.y0 + o, 4, 4);
      else
        decks
          .fillRect(b.x0 + o, b.y0 + 4, 4, 4)
          .fillRect(b.x0 + o, b.y1 - 8, 4, 4);
    }
  }
  // Deck railings: steel rails with dark posts, drawn on the deck so they stay above the trucks underneath.
  const rails = track.walls.filter((w) => w.deck);
  strokeWalls(decks, rails, 12, () => 0x000000);
  strokeWalls(decks, rails, 6, (d) => (d % 16 < 4 ? 0x2a2a30 : 0xd8dae2));

  // Bake both into static textures once instead of re-running ~1000 strokes every frame.
  const w = track.cols * config.tile,
    h = track.rows * config.tile;
  const layers: { key: string; depth: number }[] = [];
  for (const [suffix, gfx, depth] of [
    ["overlay", g, 5],
    ["decks", decks, 12],
  ] as const) {
    const key = `fd:${track.name}:${suffix}`;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    gfx.generateTexture(key, w, h).destroy();
    layers.push({ key, depth });
  }
  return layers;
}

/** Every texture key and game object one track's picture owns, so a track change can drop them all. */
export interface TrackArt {
  destroy(): void;
}

/** Build a track's static picture. Call once per track; call `destroy` before building another. */
export function createTrackArt(scene: Phaser.Scene, track: Track): TrackArt {
  const w = track.cols * config.tile,
    h = track.rows * config.tile;
  const groundKey = `fd:${track.name}:ground`;
  if (scene.textures.exists(groundKey)) scene.textures.remove(groundKey);
  const texture = scene.textures.createCanvas(groundKey, w, h);
  const images: Phaser.GameObjects.Image[] = [];
  const keys = [groundKey];
  if (texture) {
    paintGround(scene, track, texture.getContext());
    texture.refresh();
    images.push(scene.add.image(0, 0, groundKey).setOrigin(0).setDepth(1));
  }
  for (const layer of paintOverlays(scene, track)) {
    keys.push(layer.key);
    images.push(
      scene.add.image(0, 0, layer.key).setOrigin(0).setDepth(layer.depth),
    );
  }
  return {
    destroy() {
      for (const image of images) image.destroy();
      for (const key of keys)
        if (scene.textures.exists(key)) scene.textures.remove(key);
    },
  };
}

/** Dropped oil reuses the glossy slick of the track's own oil patches rather than a flat top-down splat. */
export function ensureOilSlickTexture(scene: Phaser.Scene): void {
  const key = "fd:oil-slick";
  if (scene.textures.exists(key)) return;
  const size = 128,
    tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const c = tex.getContext(),
    m = size / 2,
    r = size * 0.44;
  const edge = (scale: number): void => {
    c.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2,
        wob = 1 + 0.12 * Math.sin(a * 3) + 0.08 * Math.sin(a * 5 + 1);
      c.lineTo(
        m + Math.cos(a) * r * scale * wob,
        m + Math.sin(a) * r * 0.8 * scale * wob,
      );
    }
  };
  edge(1.06);
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.fill();
  const g = c.createRadialGradient(m - r * 0.3, m - r * 0.3, 2, m, m, r);
  g.addColorStop(0, "#3a3a48");
  g.addColorStop(1, "#0a0a10");
  edge(1);
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 5;
  for (const [col, f] of [
    ["rgba(255,70,200,0.55)", 0.55],
    ["rgba(70,220,255,0.55)", 0.68],
    ["rgba(255,230,70,0.45)", 0.8],
  ] as const) {
    c.strokeStyle = col;
    c.beginPath();
    c.ellipse(m + r * 0.1, m, r * f, r * 0.8 * f, 0, 3.4, 5.6);
    c.stroke();
  }
  c.fillStyle = "rgba(255,255,255,0.7)";
  c.beginPath();
  c.ellipse(
    m - r * 0.35,
    m - r * 0.3,
    r * 0.18,
    r * 0.07,
    -0.4,
    0,
    Math.PI * 2,
  );
  c.fill();
  tex.refresh();
}
