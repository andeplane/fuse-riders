interface ConstructionVisual {
  cell: number;
  slot: number;
  x: number;
  y: number;
  height: number;
  progress: number;
  active: boolean;
  color: string;
  artwork: string;
}

/** A projected fabrication frame. Progress comes only from authoritative work. */
export function constructionMarkup(v: ConstructionVisual): string {
  const progress = Math.max(0, Math.min(1, v.progress));
  const base = v.y + 25;
  const top = base - v.height;
  const id = `site-reveal-${v.slot}-${v.cell}`;
  const corners = [-1, 1].map((side) => ({ x: v.x + side * 31, y: base - 4 }));
  const frame = corners
    .map((p) => `M${p.x} ${p.y}V${p.y - v.height}L${v.x} ${top - 13}`)
    .join("");
  return `<g class="construction-body" data-cell="${v.cell}" data-x="${v.x}" data-base="${base}" data-height="${v.height}" data-progress="${progress}" data-active="${v.active}" pointer-events="none" style="--team:${v.color}">
    <defs><clipPath id="${id}"><rect x="${v.x - 60}" y="${base - v.height * progress}" width="120" height="${v.height * progress}"/></clipPath></defs>
    <ellipse class="site-ground-light" cx="${v.x}" cy="${base - 8}" rx="40" ry="16" fill="url(#combat-light-${v.color.slice(1)})"/>
    <path class="site-frame-back" d="${frame}"/>
    <ellipse class="site-frame-back" cx="${v.x}" cy="${top - 4}" rx="31" ry="13"/>
    <g class="site-blueprint">${v.artwork}</g>
    <g class="site-material" clip-path="url(#${id})" opacity="${0.65 + progress * 0.3}">${v.artwork}</g>
    <ellipse class="site-foundation" cx="${v.x}" cy="${base - 4}" rx="31" ry="13"/>
    <g class="site-assembly">
      <ellipse class="site-scan" cx="${v.x}" rx="31" ry="13"/>
      ${Array.from({ length: 3 }, () => '<path class="site-beam"/><circle class="site-tool" r="2.2"/>').join("")}
      ${Array.from({ length: 6 }, () => '<path class="site-spark"/>').join("")}
    </g>
  </g>`;
}

/** Bind once per markup update; absolute time makes reconstruction/rollback stable. */
export function constructionAnimation(element: SVGGElement) {
  const x = Number(element.getAttribute("data-x"));
  const base = Number(element.getAttribute("data-base"));
  const height = Number(element.getAttribute("data-height"));
  const progress = Number(element.getAttribute("data-progress"));
  const seed = Number(element.getAttribute("data-cell"));
  const active = element.getAttribute("data-active") === "true";
  const assembly = element.querySelector<SVGGElement>(".site-assembly")!;
  const ring = assembly.querySelector<SVGEllipseElement>(".site-scan")!;
  const beams = [...assembly.querySelectorAll<SVGPathElement>(".site-beam")];
  const tools = [...assembly.querySelectorAll<SVGCircleElement>(".site-tool")];
  const sparks = [...assembly.querySelectorAll<SVGPathElement>(".site-spark")];
  return (now: number, reducedMotion: boolean) => {
    assembly.setAttribute(
      "display",
      active && !reducedMotion ? "inline" : "none",
    );
    if (!active || reducedMotion) return;
    const scan = base - height * progress + Math.sin(now / 210 + seed) * 1.5;
    ring.setAttribute("cy", String(scan - 4));
    for (let i = 0; i < beams.length; i++) {
      const angle = now / 1100 + seed + (i * Math.PI * 2) / 3;
      const px = x + Math.cos(angle) * 31;
      const py = scan - 4 + Math.sin(angle) * 13;
      beams[i]!.setAttribute(
        "d",
        `M${x + Math.cos(angle) * 38} ${base - 4 + Math.sin(angle) * 16}L${px} ${py}`,
      );
      tools[i]!.setAttribute("cx", String(px));
      tools[i]!.setAttribute("cy", String(py));
    }
    for (let i = 0; i < sparks.length; i++) {
      const t = (((now / 760 + i / sparks.length + seed * 0.13) % 1) + 1) % 1;
      const angle = now / 1100 + seed + ((i % 3) * Math.PI * 2) / 3;
      const px = x + Math.cos(angle) * (31 + t * 16);
      const py =
        scan -
        4 +
        Math.sin(angle) * 13 -
        Math.sin(t * Math.PI) * 10 +
        t * t * 15;
      sparks[i]!.setAttribute(
        "d",
        `M${px} ${py}l${Math.cos(angle) * 3} ${2 + t * 3}`,
      );
      sparks[i]!.setAttribute("opacity", String((1 - t) * 0.85));
    }
  };
}
