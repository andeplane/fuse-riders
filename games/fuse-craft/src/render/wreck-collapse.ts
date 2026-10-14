/** A cosmetic silhouette settling onto its ground footprint after impact. */
export function wreckCollapse(
  document: Document,
  artwork: SVGElement,
  foot: Readonly<{ x: number; y: number }>,
  seed: number,
) {
  const ns = "http://www.w3.org/2000/svg";
  const element = document.createElementNS(ns, "g");
  element.setAttribute("class", "combat-wreck");
  element.setAttribute("pointer-events", "none");
  element.append(artwork);
  const ground = document.createElementNS(ns, "ellipse");
  ground.setAttribute("class", "combat-wreck-shadow");
  ground.setAttribute("cx", String(foot.x));
  ground.setAttribute("cy", String(foot.y));
  ground.setAttribute("fill", "url(#contact-shadow)");
  ground.setAttribute("pointer-events", "none");
  const direction = seed % 2 ? 1 : -1;
  return {
    element,
    ground,
    animate(ageMs: number) {
      const t = Math.max(0, Math.min(1, ageMs / 850));
      const fall = Math.min(1, (t / 0.7) ** 2);
      const fade = Math.max(0, 1 - Math.max(0, (t - 0.42) / 0.58));
      // Transform around the building's base so it settles on the ground,
      // rather than shrinking toward the center of its airborne silhouette.
      element.setAttribute(
        "transform",
        `translate(${foot.x + direction * fall * 9} ${foot.y}) skewX(${direction * fall * 18}) scale(${1 + fall * 0.12} ${1 - fall * 0.8}) translate(${-foot.x} ${-foot.y})`,
      );
      element.setAttribute("opacity", String(fade));
      ground.setAttribute("rx", String(28 + fall * 8));
      ground.setAttribute("ry", String(9 + fall * 3));
      ground.setAttribute("opacity", String(fade * 0.75));
    },
  };
}
