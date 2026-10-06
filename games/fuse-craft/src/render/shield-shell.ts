type Point = Readonly<{ x: number; y: number }>;
const ns = "http://www.w3.org/2000/svg";

/** A projected hemisphere around the protected structure, not a range preview. */
export function shieldShell(
  document: Document,
  at: Point,
  color: string,
  incoming?: Point,
) {
  const element = document.createElementNS(ns, "g");
  element.setAttribute("class", "shield-shell");
  const radius = 34,
    depth = 14,
    height = 48,
    base = at.y + 12;
  const skin = document.createElementNS(ns, "path");
  skin.setAttribute("class", "shield-skin");
  skin.setAttribute(
    "d",
    `M${at.x - radius} ${base}A${radius} ${height} 0 0 1 ${at.x + radius} ${base}A${radius} ${depth} 0 0 1 ${at.x - radius} ${base}Z`,
  );
  skin.setAttribute("fill", `url(#combat-light-${color.slice(1)})`);
  element.append(skin);
  const point = (latitude: number, longitude: number) => ({
    x: at.x + radius * Math.sin(latitude) * Math.cos(longitude),
    y:
      base +
      depth * Math.sin(latitude) * Math.sin(longitude) -
      height * Math.cos(latitude),
  });
  for (let i = 0; i < 6; i++) {
    const meridian = document.createElementNS(ns, "path");
    meridian.setAttribute("class", "shield-grid");
    meridian.setAttribute(
      "d",
      Array.from({ length: 13 }, (_, j) => {
        const p = point(((j / 12) * Math.PI) / 2, (i * Math.PI) / 3);
        return `${j ? "L" : "M"}${p.x} ${p.y}`;
      }).join(""),
    );
    element.append(meridian);
  }
  const ring = (latitude: number, className: string) => {
    const ellipse = document.createElementNS(ns, "ellipse");
    ellipse.setAttribute("class", className);
    ellipse.setAttribute("cx", String(at.x));
    ellipse.setAttribute("cy", String(base - height * Math.cos(latitude)));
    ellipse.setAttribute("rx", String(radius * Math.sin(latitude)));
    ellipse.setAttribute("ry", String(depth * Math.sin(latitude)));
    element.append(ellipse);
    return ellipse;
  };
  ring(Math.PI / 6, "shield-grid");
  ring(Math.PI / 3, "shield-grid");
  ring(Math.PI / 2, "shield-rim");
  const ripple = ring(0, "shield-ripple");
  const contact = document.createElementNS(ns, "circle");
  contact.setAttribute("class", "shield-contact");
  const angle = incoming
    ? Math.atan2((incoming.y - at.y) * 2, incoming.x - at.x)
    : -Math.PI / 2;
  const hit = point(Math.PI / 3, angle);
  contact.setAttribute("cx", String(hit.x));
  contact.setAttribute("cy", String(hit.y));
  contact.setAttribute("fill", `url(#combat-light-${color.slice(1)})`);
  element.append(contact);
  return {
    element,
    animate(age: number) {
      const t = Math.max(0, Math.min(1, age));
      const latitude = ((0.15 + 0.85 * t) * Math.PI) / 2;
      ripple.setAttribute("cy", String(base - height * Math.cos(latitude)));
      ripple.setAttribute("rx", String(radius * Math.sin(latitude)));
      ripple.setAttribute("ry", String(depth * Math.sin(latitude)));
      ripple.setAttribute("opacity", String(1 - t));
      contact.setAttribute("r", String(13 + t * 12));
      contact.setAttribute("opacity", String((1 - t) ** 2));
    },
  };
}
