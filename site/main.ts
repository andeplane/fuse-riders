import { legacyRidersLink } from "./routes.js";

if (legacyRidersLink(location.search)) {
  location.replace(
    `${import.meta.env.BASE_URL}fuse-riders/${location.search}${location.hash}`,
  );
} else {
  const { createGameGallery } =
    await import("../packages/fuse-ui/src/gallery.js");
  await import("./gallery.css");
  document.querySelector("#app")!.append(
    createGameGallery({
      document,
      base: import.meta.env.BASE_URL,
      search: location.search,
    }),
  );
}
