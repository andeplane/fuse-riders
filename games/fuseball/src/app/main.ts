import { createGameSocial } from "fuse-ui/social";
import "fuse-ui/social.css";
import { startGameAnalytics } from "fuse-ui/play-metrics";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "./fuseball.css";
import { createEndpoints } from "fuse-network-fe";
import { createAppPortal, el } from "fuse-ui";
import { GAME_ID } from "../basics.js";

/**
 * A placeholder page while Fuseball's room, renderer and controls are built on the engine in `../engine/`: the
 * header every game has (portal, brand, account) and a notice. The scaffold's full room shell (landing card, lobby,
 * invite, reports) is in git history at `5934dde:games/fuseball/src/app/main.ts`, for the page that replaces this.
 */
const GAME = GAME_ID;
const analytics = startGameAnalytics(GAME);
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const social = createGameSocial({
  gameId: GAME,
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const app = document.querySelector<HTMLElement>("#app")!;

const bar = el("header", "", "fuseball-top"),
  brand = el("a", "", "fuseball-brand");
brand.href = endpoints.appUrl();
brand.append(el("span", "FUSEBALL"), el("small", "A FUSE GAME"));
// Every game opens the app portal top left; it lists the games that have a portal.json.
const portal = createAppPortal({
  document,
  current: GAME,
  base: import.meta.env.BASE_URL,
  search: location.search,
});
const back = el("a", "← ALL GAMES", "fuseball-back");
back.href = import.meta.env.BASE_URL;
bar.append(portal.element, brand, social.element(), back);
app.replaceChildren(
  bar,
  el("p", "The arena is being built. Check back soon.", "fuseball-status"),
);
