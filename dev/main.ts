import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "./styles.css";
import {
  accountReady,
  watchAccount,
  signIn,
  signOut,
  signInFailure,
  signedInToken,
} from "fuse-ui/browser-account";
import { createEndpoints } from "fuse-network-fe";
import { mountWorkspace } from "./workspace.js";

const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}dev/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const root = document.getElementById("app");
if (!root) throw new Error("Workspace root is missing");
mountWorkspace(root, {
  document,
  account: {
    ready: accountReady,
    watch: watchAccount,
    signIn,
    signOut,
    failure: signInFailure,
  },
  transport: {
    request: fetch,
    token: signedInToken,
    origin: new URL(endpoints.apiUrl("/api/dev/me")).origin,
  },
  now: () => new Date(),
  gamesUrl: import.meta.env.BASE_URL,
});
