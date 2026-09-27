/** Persistent damage feedback; presentation time never enters authoritative state. */
export function damagePlume(
  x: number,
  y: number,
  health: number,
  seed: number,
): string {
  if (health >= 0.5) return "";
  const severity = Math.max(0, Math.min(1, 1 - health * 2));
  return `<g class="damage-plume" pointer-events="none" data-seed="${seed}" data-severity="${severity}" transform="translate(${x} ${y})"><ellipse cx="0" cy="0" rx="7" ry="3" fill="#ef7e35" opacity="${0.2 + severity * 0.25}"/>${Array.from({ length: 4 }, () => '<circle class="damage-smoke" fill="url(#combat-smoke)"/>').join("")}${Array.from({ length: 3 }, () => '<circle class="damage-ember" r="1" fill="#ffcb75"/>').join("")}</g>`;
}

export function damageAnimation(
  node: SVGGElement,
): (now: number, reduced: boolean) => void {
  const seed = Number(node.getAttribute("data-seed"));
  const severity = Number(node.getAttribute("data-severity"));
  const smoke = [...node.querySelectorAll<SVGCircleElement>(".damage-smoke")];
  const embers = [...node.querySelectorAll<SVGCircleElement>(".damage-ember")];
  return (now, reduced) => {
    const time = reduced ? 0 : now;
    smoke.forEach((puff, i) => {
      const phase =
        (((time / 2200 + i / smoke.length + seed * 0.137) % 1) + 1) % 1;
      puff.setAttribute("cx", String(phase * 12 + Math.sin(phase * 5 + i) * 3));
      puff.setAttribute("cy", String(-phase * (34 + severity * 20)));
      puff.setAttribute("r", String(4 + phase * 12));
      puff.setAttribute(
        "opacity",
        String(Math.sin(phase * Math.PI) * (0.3 + severity * 0.35)),
      );
    });
    embers.forEach((ember, i) => {
      const phase =
        (((time / 1300 + i / embers.length + seed * 0.173) % 1) + 1) % 1;
      ember.setAttribute("cx", String(Math.sin(i * 2 + phase * 4) * 8));
      ember.setAttribute("cy", String(-phase * 30));
      ember.setAttribute(
        "opacity",
        String(reduced ? 0 : (1 - phase) * severity),
      );
    });
  };
}
