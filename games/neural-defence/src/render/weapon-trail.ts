type Point = Readonly<{ x: number; y: number }>;
export type WeaponStyle = "pulse" | "siege" | "relay";
export const weaponFlightMs: Readonly<Record<WeaponStyle, number>> = {
  pulse: 55,
  siege: 180,
  relay: 90,
};
const ns = "http://www.w3.org/2000/svg";

/** A short cosmetic flight following an already-resolved attack outcome. */
export function weaponTrail(
  document: Document,
  from: Point,
  to: Point,
  style: WeaponStyle,
  seed: number,
) {
  const element = document.createElementNS(ns, "g");
  element.setAttribute("class", `combat-tracer weapon-${style}`);
  const halo = document.createElementNS(ns, "path");
  const core = document.createElementNS(ns, "path");
  halo.setAttribute("class", "weapon-halo");
  core.setAttribute("class", "weapon-core");
  const head = document.createElementNS(ns, "circle");
  head.setAttribute("class", "weapon-head");
  head.setAttribute("r", style === "siege" ? "3.5" : "2");
  element.append(halo, core, head);
  const shadow = document.createElementNS(ns, "ellipse");
  shadow.setAttribute("class", "weapon-shadow");
  const duration = weaponFlightMs[style];
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const height = style === "siege" ? Math.min(78, 26 + length * 0.16) : 0;
  const position = (t: number) => ({
    x: from.x + dx * t,
    y: from.y + dy * t - 19 + 9 * t - height * 4 * t * (1 - t),
  });
  return {
    element,
    shadow,
    duration,
    animate(ageMs: number) {
      const t = Math.max(0, Math.min(1, ageMs / duration));
      const end = style === "relay" ? 1 : t;
      const start = style === "relay" ? 0 : Math.max(0, end - 0.3);
      const points = Array.from({ length: 9 }, (_, i) => {
        const u = start + ((end - start) * i) / 8;
        const p = position(u);
        // Endpoints stay anchored. Flicker is a pure function of event and age.
        const offset =
          style === "relay" && i > 0 && i < 8
            ? Math.sin(seed + i * 11 + Math.floor(t * 5) * 7) * 6
            : 0;
        return `${i ? "L" : "M"}${p.x - (dy / length) * offset} ${p.y + (dx / length) * offset}`;
      }).join("");
      halo.setAttribute("d", points);
      core.setAttribute("d", points);
      const p = position(end);
      head.setAttribute("cx", String(p.x));
      head.setAttribute("cy", String(p.y));
      shadow.setAttribute("cx", String(from.x + dx * end));
      shadow.setAttribute("cy", String(from.y + dy * end + 12));
      shadow.setAttribute(
        "rx",
        String(4 + height * 0.04 * Math.sin(Math.PI * end)),
      );
      shadow.setAttribute("ry", "2");
      shadow.setAttribute("opacity", style === "siege" && t < 1 ? "0.3" : "0");
      element.setAttribute(
        "opacity",
        String(t >= 1 ? 0 : style === "relay" ? 1 - t * 0.6 : 1),
      );
    },
  };
}
