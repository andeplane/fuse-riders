import { PORTAL_GAMES, type PortalGame } from "./portal.js";

export interface GalleryOptions {
  document: Document;
  base: string;
  search?: string;
  games?: readonly PortalGame[];
}

/** Static catalog: no room connection, game engine, account request or timers. */
export function createGameGallery({
  document,
  base,
  search = "",
  games = PORTAL_GAMES,
}: GalleryOptions): HTMLElement {
  const node = (tag: string, className: string, text?: string) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const muted = new URLSearchParams(search).has("mute") ? "?mute" : "";
  const main = node("main", "arcade");
  const header = node("header", "arcade-header");
  const brand = node("a", "arcade-brand", "FUSE");
  brand.setAttribute("href", `${base}${muted}`);
  brand.setAttribute("aria-label", "Fuse Games home");
  header.append(brand, node("span", "arcade-label", "THE BROWSER ARCADE"));
  const intro = node("section", "arcade-intro");
  intro.append(
    node("p", "arcade-eyebrow", "SMALL GAMES. BIG PLANS."),
    node("h1", "arcade-title", "What are we playing?"),
    node(
      "p",
      "arcade-description",
      "One more round. One more adventure. Pick a game and jump in.",
    ),
  );
  const collection = node("section", "arcade-collection");
  collection.setAttribute("aria-labelledby", "collection-title");
  const bar = node("div", "arcade-collection-bar");
  const title = node("h2", "arcade-collection-title", "CHOOSE YOUR GAME");
  title.id = "collection-title";
  bar.append(
    title,
    node(
      "span",
      "arcade-count",
      `${games.length.toString().padStart(2, "0")} GAMES · FREE TO PLAY`,
    ),
  );
  const grid = node("div", "arcade-grid");
  games.forEach((game, index) => {
    const card = node("a", "arcade-game");
    card.setAttribute("href", `${base}${game.path}${muted}`);
    card.style.setProperty("--game-accent", game.accent);
    const media = node("div", "arcade-media");
    if (game.screenshot) {
      const img = document.createElement("img");
      img.src = `${base}${game.screenshot}`;
      img.alt = `${game.name} gameplay`;
      img.width = 1200;
      img.height = 750;
      img.loading = index < 2 ? "eager" : "lazy";
      media.append(img);
    } else {
      media.append(node("span", "arcade-placeholder", game.mark));
    }
    const info = node("div", "arcade-game-info");
    info.append(
      node("h3", "arcade-game-name", game.name),
      node("p", "arcade-game-tagline", game.tagline),
    );
    const play = node("span", "arcade-play", "PLAY ↗");
    play.setAttribute("aria-hidden", "true");
    card.append(media, info, play);
    grid.append(card);
  });
  if (!games.length)
    grid.append(
      node(
        "p",
        "arcade-description",
        "More games are on the way. Check back soon.",
      ),
    );
  collection.append(bar, grid);
  const footer = node("footer", "arcade-footer");
  footer.append(
    node("span", "", "GOOD COMPANY. GREAT GAMES."),
    node("a", "arcade-top", "BACK TO TOP ↑"),
  );
  footer.querySelector("a")!.setAttribute("href", "#app");
  main.append(header, intro, collection, footer);
  return main;
}
