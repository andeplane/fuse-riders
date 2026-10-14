import { createGameSocial } from "fuse-ui/social";
import "fuse-ui/social.css";
import { analytics } from "./analytics.js";
export const social = createGameSocial({
  gameId: "hook-havok",
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
