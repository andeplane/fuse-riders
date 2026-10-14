import { FUSETOWN } from "./fusetown.js";
import type { City } from "./city.js";

export type * from "./city.js";
export { FUSETOWN } from "./fusetown.js";

/**
 * The city every match is played in. Only Fusetown exists for now; another city type is another file like
 * `fusetown.ts` (the other concept boards wait in `docs/cities/`).
 */
export const CITY: City = FUSETOWN;
