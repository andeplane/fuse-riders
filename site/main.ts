import { legacyRidersLink } from "./routes.js";

if (legacyRidersLink(location.search)) {
  location.replace(
    `${import.meta.env.BASE_URL}fuse-riders/${location.search}${location.hash}`,
  );
} else {
  // FuseOS: the Windows 95 desktop that fronts every game (packages/fuseos). It mounts itself into #app.
  await import("../packages/fuseos/src/main.tsx");
}
