/** Browser-smoke account adapter. Vite substitutes this module only in solo-history-smoke.ts; no real OAuth. */
import type * as Production from "../../games/fuse-riders/src/online/account.js";

const signedIn = () =>
  localStorage.getItem("solo-history-smoke-account") === "1";
const adapter: typeof Production = {
  remembersSignIn: signedIn,
  accountUsername: () => (signedIn() ? "Smoke Rider" : undefined),
  rememberUsername: () => {},
  fetchUsername: async () => (signedIn() ? "Smoke Rider" : undefined),
  warmAccount: () => {},
  accountReady: async () => {},
  watchAccount: (listener) => {
    listener(signedIn() ? { name: "Smoke Rider" } : undefined);
    return () => {};
  },
  signIn: async () => {},
  signOut: async () => {},
  signedInToken: async () => (signedIn() ? "smoke:solo-player" : undefined),
  identityToken: async () => (signedIn() ? "smoke:solo-player" : undefined),
  signInFailure: () => "Test sign-in failed",
};
export const {
  remembersSignIn,
  accountUsername,
  rememberUsername,
  fetchUsername,
  warmAccount,
  accountReady,
  watchAccount,
  signIn,
  signOut,
  signedInToken,
  identityToken,
  signInFailure,
} = adapter;
