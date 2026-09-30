import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { weaponFlightMs, weaponTrail } from "../src/render/weapon-trail.js";
import { combatEffect } from "../src/render/combat-effects.js";
import { sporeBurst, SPORE_CLOUD_MS } from "../src/render/spore-burst.js";
import { SPORES } from "../src/render/light-field.js";

test("a spore cloud billows, lifts and fades, as a pure function of age", () => {
  const { document } = parseHTML("<html></html>");
  const cloud = sporeBurst(document, { x: 100, y: 100 }, 7);
  cloud.animate(-10);
  assert.equal(cloud.element.getAttribute("opacity"), "0");
  cloud.animate(SPORE_CLOUD_MS / 2);
  assert.equal(cloud.element.getAttribute("opacity"), "1");
  const mid = cloud.element.outerHTML;
  cloud.animate(SPORE_CLOUD_MS * 0.8);
  cloud.animate(SPORE_CLOUD_MS / 2);
  assert.equal(cloud.element.outerHTML, mid, "seeking back restores the frame");
  const motes = cloud.element.querySelectorAll(".spore-mote");
  assert.ok(motes.length > 4);
  cloud.animate(SPORE_CLOUD_MS * 0.1);
  const low = Number(motes[0]!.getAttribute("cy"));
  cloud.animate(SPORE_CLOUD_MS * 0.9);
  assert.ok(Number(motes[0]!.getAttribute("cy")) < low, "spores drift upward");
  cloud.animate(SPORE_CLOUD_MS);
  assert.equal(cloud.element.getAttribute("opacity"), "0");
});

test("spore pods are lobbed and burst into a cloud on arrival", () => {
  const { document } = parseHTML("<html></html>");
  const from = { x: 0, y: 0 },
    to = { x: 120, y: 0 };
  const pod = weaponTrail(document, from, to, "spore", 1);
  const pulse = weaponTrail(document, from, to, "pulse", 1);
  assert.equal(pod.duration, weaponFlightMs.spore);
  pod.animate(pod.duration / 2);
  pulse.animate(pulse.duration / 2);
  const height = (trail: typeof pod) =>
    Number(trail.element.querySelector(".weapon-head")!.getAttribute("cy"));
  assert.ok(height(pod) < height(pulse) - 5, "the pod arcs above a pulse");
  const effect = combatEffect(document, "damage", to, "#8fe36b", 3, from, {
    weapon: "spore",
  });
  assert.ok(effect.element.querySelector(".spore-burst"));
  assert.ok(effect.element.querySelector(".weapon-spore"));
  assert.equal(effect.duration, SPORE_CLOUD_MS + weaponFlightMs.spore);
  // A splash hit shares the pod: no trail of its own, same arrival.
  const splash = combatEffect(document, "damage", to, "#8fe36b", 4, undefined, {
    weapon: "spore",
    impactDelay: weaponFlightMs.spore,
  });
  assert.equal(splash.element.querySelector(".weapon-spore"), null);
  assert.ok(splash.element.querySelector(".spore-burst"));
  assert.equal(splash.duration, effect.duration);
  // Spore light floats up instead of falling like sparks.
  assert.ok(SPORES.gravity < 0);
});
