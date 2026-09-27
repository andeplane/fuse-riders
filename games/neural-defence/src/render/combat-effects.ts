/** Cosmetic 3D trajectories projected onto the battlefield; never advances rules. */
import { weaponTrail, type WeaponStyle } from "./weapon-trail.js";
import { shieldShell } from "./shield-shell.js";
import { siegeImpact } from "./siege-impact.js";
export interface CombatEffect {
  element: SVGGElement;
  ground: SVGGElement;
  duration: number;
  animate(age: number): void;
}
const ns = "http://www.w3.org/2000/svg";
type Point = Readonly<{ x: number; y: number }>;
export function combatEffect(
  document: Document,
  type: "damage" | "shielded" | "destroyed" | "constructed",
  at: Point,
  color: string,
  seed: number,
  from?: Point,
  options: {
    weapon?: WeaponStyle;
    impactDelay?: number;
    incoming?: Point;
  } = {},
): CombatEffect {
  const { weapon = "pulse", impactDelay, incoming } = options;
  const element = document.createElementNS(ns, "g");
  const ground = document.createElementNS(ns, "g");
  element.setAttribute("class", `combat-effect combat-${type}`);
  ground.setAttribute("class", "combat-ground-light");
  for (const group of [element, ground]) {
    group.setAttribute("pointer-events", "none");
    group.style.setProperty("--effect-color", color);
  }
  const destroyed = type === "destroyed";
  const shielded = type === "shielded";
  const glow = `url(#combat-light-${color.slice(1)})`;
  const trail = from
    ? weaponTrail(document, from, at, weapon, seed)
    : undefined;
  const flight = impactDelay ?? trail?.duration ?? 0;
  const artillery = type === "damage" && weapon === "siege";
  if (trail) ground.append(trail.shadow);
  const duration =
    (destroyed ? 1050 : type === "constructed" ? 850 : artillery ? 680 : 420) +
    (weapon === "siege" || destroyed || shielded ? flight : 0);
  const count = destroyed ? 10 : type === "constructed" ? 8 : 5;
  const light = document.createElementNS(ns, "ellipse");
  light.setAttribute("cx", String(at.x));
  light.setAttribute("cy", String(at.y + 12));
  light.setAttribute("fill", glow);
  ground.append(light);
  const ring = document.createElementNS(ns, "ellipse");
  ring.setAttribute("class", "combat-shockwave");
  ring.setAttribute("cx", String(at.x));
  ring.setAttribute("cy", String(at.y + 12));
  ground.append(ring);
  const core = document.createElementNS(ns, "circle");
  core.setAttribute("class", "combat-core");
  core.setAttribute("cx", String(at.x));
  core.setAttribute("cy", String(at.y - 10));
  core.setAttribute("fill", glow);
  element.append(core);
  const shell = shielded
    ? shieldShell(document, at, color, incoming)
    : undefined;
  if (shell) element.append(shell.element);
  const plume = artillery ? siegeImpact(document, at, seed) : undefined;
  if (plume) {
    element.prepend(plume.element);
    ground.prepend(plume.ground);
  }
  let muzzle: SVGCircleElement | undefined;
  if (from) {
    element.prepend(trail!.element);
    muzzle = document.createElementNS(ns, "circle");
    muzzle.setAttribute("class", "combat-muzzle");
    muzzle.setAttribute("cx", String(from.x));
    muzzle.setAttribute("cy", String(from.y - 19));
    muzzle.setAttribute("fill", glow);
    element.append(muzzle);
  }
  const fragments = Array.from({ length: count }, (_, i) => {
    // Stable cosmetic variation; no mutable RNG and no world references.
    const phase = ((Math.imul(seed + i * 97, 16807) >>> 0) % 997) / 997;
    const angle = (i * Math.PI * 2) / count + phase;
    const speed = (destroyed ? 44 : 24) * (0.6 + phase);
    const shape = document.createElementNS(ns, "path");
    shape.setAttribute("class", destroyed ? "combat-debris" : "combat-spark");
    shape.setAttribute(
      "d",
      destroyed ? "M-3 -2L2 -3L4 1L-1 3Z" : "M-3 0L2 -1L4 0L2 1Z",
    );
    element.append(shape);
    const shadow = document.createElementNS(ns, "ellipse");
    shadow.setAttribute("class", "combat-debris-shadow");
    shadow.setAttribute("rx", "3");
    shadow.setAttribute("ry", "1.3");
    ground.append(shadow);
    return {
      shape,
      shadow,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      vz: 38 + phase * 42,
      phase,
    };
  });
  const smoke = destroyed
    ? Array.from({ length: 3 }, (_, i) => {
        const puff = document.createElementNS(ns, "circle");
        puff.setAttribute("class", "combat-smoke");
        puff.setAttribute("fill", "url(#combat-smoke)");
        element.prepend(puff);
        return { puff, i };
      })
    : [];
  return {
    element,
    ground,
    duration,
    animate(age) {
      const elapsed = Math.max(0, Math.min(1, age)) * duration;
      trail?.animate(elapsed);
      plume?.animate(elapsed - flight);
      const t = Math.max(
        0,
        Math.min(1, (elapsed - flight) / (duration - flight)),
      );
      const visible = elapsed >= flight ? 1 : 0;
      shell?.animate(t);
      shell?.element.setAttribute("opacity", String(visible * (1 - t) ** 1.6));
      light.setAttribute("rx", String(25 + t * 35));
      light.setAttribute("ry", String(13 + t * 17));
      light.setAttribute("opacity", String(visible * 0.65 * (1 - t) ** 2));
      ring.setAttribute("rx", String(8 + t * 43));
      ring.setAttribute("ry", String(4 + t * 21));
      ring.setAttribute("opacity", String(visible * 0.65 * (1 - t) ** 3));
      core.setAttribute("r", String((destroyed ? 32 : 19) * (1 - t) + 2));
      core.setAttribute("opacity", String(visible * (1 - t) ** 3));
      muzzle?.setAttribute("r", String(16 * Math.max(0, 1 - elapsed / 140)));
      muzzle?.setAttribute("opacity", String(Math.max(0, 1 - elapsed / 100)));
      for (const { shape, shadow, vx, vy, vz, phase } of fragments) {
        const x = at.x + vx * t;
        const y = at.y + vy * t * 0.5;
        const z = Math.max(0, 8 + vz * t - 80 * t * t);
        shape.setAttribute(
          "transform",
          `translate(${x} ${y - z}) rotate(${phase * 360 + t * 180})`,
        );
        shape.setAttribute("opacity", String(visible * (1 - t) ** 1.2));
        shadow.setAttribute("cx", String(x));
        shadow.setAttribute("cy", String(y + 12));
        shadow.setAttribute("opacity", String(visible * (1 - t) * 0.3));
      }
      for (const { puff, i } of smoke) {
        puff.setAttribute("cx", String(at.x + (i - 1) * (7 + t * 10)));
        puff.setAttribute("cy", String(at.y - 10 - t * (26 + i * 6)));
        puff.setAttribute("r", String(7 + t * (19 + i * 3)));
        puff.setAttribute("opacity", String(Math.sin(Math.PI * t) * 0.65));
      }
    },
  };
}
