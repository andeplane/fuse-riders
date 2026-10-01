import { contourPath, creepContours, palette } from "./creep.js";

const ns = "http://www.w3.org/2000/svg";

export interface CreepSource {
  /** Stable identity, so growth and recession continue across re-renders. */
  key: string;
  slot: number;
  x: number;
  y: number;
  /** Visible radius this source settles at; zero recedes it. */
  radius: number;
}
interface Blob {
  slot: number;
  x: number;
  y: number;
  /** Radius when the current target was set, at presentation time `start`. */
  from: number;
  start: number;
  target: number;
  /** Radius at the last draw. */
  drawn: number;
}
interface Team {
  slot: number;
  shapes: SVGPathElement[];
  details: SVGGElement;
  ripples: SVGEllipseElement[];
  drawnAt: number;
}
/** Heartbeat ripples spread from each brain through its creep, ms. */
const HEARTBEAT_MS = 3200;

/** Growth and recession time constants, ms. */
const GROW_TAU = 650;
const RECEDE_TAU = 1300;
/** Contours redraw at most this often while creep is moving, ms. */
const REDRAW_MS = 45;
/** Radius a brand-new source starts from. */
const SEED_RADIUS = 6;

/** Eased radius at absolute presentation time; independent of frame rate. */
function radiusAt(blob: Blob, now: number, reducedMotion: boolean): number {
  const gap = blob.from - blob.target;
  if (reducedMotion || gap === 0) return blob.target;
  const tau = gap < 0 ? GROW_TAU : RECEDE_TAU;
  const r = blob.target + gap * Math.exp(-Math.max(0, now - blob.start) / tau);
  return Math.abs(r - blob.target) < 0.4 ? blob.target : r;
}

/**
 * Owns the creep DOM. Sources set targets; animate eases each blob toward its
 * target by absolute time and redraws the affected team's contour. Never
 * touches world state.
 */
export class CreepLayer {
  private readonly blobs = new Map<string, Blob>();
  private readonly teams = new Map<number, Team>();

  constructor(
    private readonly host: SVGGElement,
    private readonly size: { width: number; height: number },
  ) {}

  update(
    sources: readonly CreepSource[],
    details: ReadonlyMap<number, string>,
    initial: boolean,
    now: number,
  ): void {
    const seen = new Set<string>();
    const retarget = (blob: Blob, target: number) => {
      if (blob.target === target) return;
      blob.from = radiusAt(blob, now, false);
      blob.start = now;
      blob.target = target;
    };
    for (const s of sources) {
      seen.add(s.key);
      const blob = this.blobs.get(s.key);
      if (blob) {
        blob.x = s.x;
        blob.y = s.y;
        retarget(blob, s.radius);
        continue;
      }
      // A finished site hands its creep to the new structure without a dip.
      const inherited = Math.max(
        SEED_RADIUS,
        ...[...this.blobs.values()]
          .filter(
            (b) =>
              b.slot === s.slot &&
              Math.abs(b.x - s.x) < 1 &&
              Math.abs(b.y - s.y) < 1,
          )
          .map((b) => radiusAt(b, now, false)),
      );
      const from = initial ? s.radius : Math.min(s.radius, inherited);
      this.blobs.set(s.key, {
        slot: s.slot,
        x: s.x,
        y: s.y,
        from,
        start: now,
        target: s.radius,
        drawn: Number.NaN,
      });
      this.team(s.slot);
    }
    for (const [key, blob] of this.blobs) if (!seen.has(key)) retarget(blob, 0);
    for (const [slot, markup] of details) {
      const team = this.team(slot);
      if (team.details.getAttribute("data-markup") !== markup) {
        team.details.innerHTML = markup;
        team.details.setAttribute("data-markup", markup);
        team.ripples = [
          ...team.details.querySelectorAll<SVGEllipseElement>(".creep-ripple"),
        ];
      }
    }
  }

  animate(now: number, reducedMotion: boolean): void {
    for (const team of this.teams.values())
      for (const ripple of team.ripples) {
        const reach = Number(ripple.getAttribute("data-reach"));
        const t = reducedMotion
          ? 1
          : (now / HEARTBEAT_MS + team.slot * 0.37) % 1;
        const r = reach * (0.15 + t * 0.85);
        ripple.setAttribute("rx", r.toFixed(1));
        ripple.setAttribute("ry", (r * 0.72).toFixed(1));
        ripple.setAttribute("stroke-width", (5 * (1 - t) + 0.5).toFixed(2));
        ripple.setAttribute("opacity", (0.55 * (1 - t) * (1 - t)).toFixed(3));
      }
    const changed = new Set<number>();
    const moving = new Set<number>();
    for (const [key, blob] of this.blobs) {
      const r = radiusAt(blob, now, reducedMotion);
      if (r !== blob.target) moving.add(blob.slot);
      if (r !== blob.drawn) changed.add(blob.slot);
      if (blob.target === 0 && r === 0) {
        this.blobs.delete(key);
        changed.add(blob.slot);
      }
    }
    for (const slot of changed) {
      const team = this.team(slot);
      // Throttle mid-growth redraws; always draw the settled shape.
      if (moving.has(slot) && now - team.drawnAt < REDRAW_MS) continue;
      const blobs = [...this.blobs.values()].filter((b) => b.slot === slot);
      for (const b of blobs) b.drawn = radiusAt(b, now, reducedMotion);
      const d = contourPath(
        creepContours(
          blobs.map((b) => ({ x: b.x, y: b.y, radius: b.drawn })),
          { ...this.size, seed: 0x5eed + slot * 977 },
        ),
      );
      for (const shape of team.shapes) shape.setAttribute("d", d);
      team.drawnAt = now;
    }
  }

  /** Current visible radius per source, for inspection. */
  radius(key: string, now: number): number | undefined {
    const blob = this.blobs.get(key);
    return blob && radiusAt(blob, now, false);
  }

  private team(slot: number): Team {
    const existing = this.teams.get(slot);
    if (existing) return existing;
    const p = palette(slot);
    const document = this.host.ownerDocument;
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", "creep");
    group.setAttribute("data-slot", String(slot));
    group.setAttribute("style", `--vein:${p.glow}`);
    group.innerHTML =
      `<clipPath id="nd-creep-clip-${slot}"><path class="creep-clip"/></clipPath>` +
      `<path class="creep-shadow" transform="translate(4 8)"/>` +
      `<path class="creep-side" fill="${p.fleshDark}" transform="translate(0 5)"/>` +
      `<path class="creep-top" fill="url(#nd-creep-${slot})"/>` +
      `<g class="creep-details" clip-path="url(#nd-creep-clip-${slot})"></g>` +
      `<path class="creep-rim" stroke="${p.glow}"/>`;
    this.host.append(group);
    const team: Team = {
      slot,
      ripples: [],
      shapes: [
        ...group.querySelectorAll<SVGPathElement>(
          ".creep-clip, .creep-shadow, .creep-side, .creep-top, .creep-rim",
        ),
      ],
      details: group.querySelector<SVGGElement>(".creep-details")!,
      drawnAt: Number.NEGATIVE_INFINITY,
    };
    this.teams.set(slot, team);
    return team;
  }
}
