import { encodeArena, type Arena } from "../../src/engine/arena.js";

/**
 * The arena's checkpoint as canonical JSON: keys sorted, because a decoded
 * body lists its fields in the decoder's order. Equal text is equal state.
 */
export const canonArena = (arena: Arena): string =>
  JSON.stringify(encodeArena(arena), (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([p], [q]) => (p < q ? -1 : 1)),
        )
      : v,
  );
