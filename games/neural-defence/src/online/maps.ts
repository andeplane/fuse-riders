import closeQuarters from "../../maps/close-quarters.json";
import combatLab from "../../maps/combat-lab-12.json";
import leanResources from "../../maps/lean-resources.json";
import narrowFront from "../../maps/narrow-front.json";
import openFront from "../../maps/open-front.json";
import sandbox from "../../maps/sandbox-12.json";
import skirmish from "../../maps/skirmish-24.json";

/**
 * The bundled maps, by id. Online rooms name a map instead of carrying it:
 * a whole map is several kilobytes and a settings entry must fit one packet.
 * Every peer ships the same bundle, so the id resolves to the same map.
 */
const BUNDLED: Readonly<Record<string, unknown>> = Object.freeze(
  Object.fromEntries(
    [
      closeQuarters,
      combatLab,
      leanResources,
      narrowFront,
      openFront,
      sandbox,
      skirmish,
    ].map((map) => [map.id, map]),
  ),
);

export const BUNDLED_MAP_IDS: readonly string[] = Object.keys(BUNDLED).sort();

/** The raw bundled map for an id; callers validate it with `loadMap`. */
export function bundledMap(id: string): unknown {
  return Object.hasOwn(BUNDLED, id) ? BUNDLED[id] : undefined;
}
