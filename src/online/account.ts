import { FIREBASE_WEB_CONFIG } from "../shared/firebase-config.js";
import { safeStorage } from "../client/safe-storage.js";
import { validRiderName } from "../shared/rider-name.js";

/**
 * Optional Google sign-in. A guest never downloads the Firebase SDK: it is imported on the first sign-in, and on later
 * visits only by a browser that remembers having signed in. Nothing here is needed to play.
 *
 * The ID token this hands out is a bearer credential for the player's history. It goes to the room service in a
 * request header and nowhere else: never a URL, a room invite, a peer message, a log line or an analytics property.
 */
export interface Account {
  name: string;
}
type Listener = (account: Account | undefined) => void;

const REMEMBER_KEY = "fuse-riders-signed-in",
  USERNAME_KEY = "fuse-riders-username";
const storage = safeStorage(() => localStorage);
const listeners = new Set<Listener>();
let current: Account | undefined;

async function load() {
  const [{ initializeApp }, auth] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const instance = auth.getAuth(initializeApp(FIREBASE_WEB_CONFIG));
  auth.onAuthStateChanged(instance, (user) => {
    current = user
      ? { name: user.displayName?.trim().slice(0, 40) || "Signed in" }
      : undefined;
    if (user) storage.setItem(REMEMBER_KEY, "1");
    else {
      storage.removeItem(REMEMBER_KEY);
      storage.removeItem(USERNAME_KEY);
    }
    for (const listener of listeners) listener(current);
  });
  await instance.authStateReady();
  return { auth, instance };
}
let loading: ReturnType<typeof load> | undefined;
const firebase = () =>
  (loading ??= load().catch((error) => {
    loading = undefined;
    throw error;
  }));

/** Whether this browser signed in before. Reading it costs nothing; acting on it loads the SDK. */
export const remembersSignIn = (): boolean =>
  storage.getItem(REMEMBER_KEY) === "1";
/**
 * The account's username as this browser last saw it, so a room can seat its rider under it without waiting for the
 * SDK or the network. The room service holds the truth; signing out forgets it.
 */
export const accountUsername = (): string | undefined => {
  const value = remembersSignIn() ? storage.getItem(USERNAME_KEY) : null;
  return validRiderName(value) ? value : undefined;
};
export const rememberUsername = (username: string): void => {
  if (validRiderName(username)) storage.setItem(USERNAME_KEY, username);
};
/** The username from the room service, for a signed-in browser that has not cached one yet. Never throws; undefined is "carry on as you were". */
export async function fetchUsername(
  profileUrl: string,
  request: typeof fetch,
): Promise<string | undefined> {
  try {
    const token = await identityToken();
    if (!token) return undefined;
    const response = await request(profileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const username = response.ok
      ? ((await response.json()) as { profile?: { username?: unknown } | null })
          .profile?.username
      : undefined;
    if (!validRiderName(username)) return undefined;
    rememberUsername(username);
    return username;
  } catch {
    return undefined;
  }
}
/** Starts the SDK download ahead of the click, so the sign-in popup opens inside the tap that asked for it. */
export const warmAccount = (): void => {
  void firebase().catch(() => undefined);
};

/** Resolves once a sign-in can open its popup synchronously inside a tap; rejects if the SDK could not be fetched. */
export const accountReady = async (): Promise<void> => {
  await firebase();
};

export function watchAccount(listener: Listener): () => void {
  listeners.add(listener);
  if (remembersSignIn()) warmAccount();
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/** Call from a tap, after accountReady: browsers only open a popup for a gesture that has not been awaited away. */
export async function signIn(): Promise<void> {
  const { auth, instance } = await firebase(),
    provider = new auth.GoogleAuthProvider();
  // No extra scopes: the game wants to know it is the same person next time, not their contacts or their email.
  provider.setCustomParameters({ prompt: "select_account" });
  await auth.signInWithPopup(instance, provider);
}

export async function signOut(): Promise<void> {
  const { auth, instance } = await firebase();
  await auth.signOut(instance);
}

/** A fresh ID token for the room service, or undefined for a guest. Throws when a signed-in browser cannot get one just now. */
export async function signedInToken(): Promise<string | undefined> {
  if (!remembersSignIn()) return undefined;
  return (await firebase()).instance.currentUser?.getIdToken();
}
/** The same, but never throws: a failed sign-in is a guest. */
export async function identityToken(): Promise<string | undefined> {
  return signedInToken().catch(() => undefined);
}

export function signInFailure(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  )
    return "";
  if (code === "auth/popup-blocked")
    return "Allow pop-ups for this page, then try again.";
  if (code === "auth/operation-not-allowed")
    return "Sign-in is not switched on yet.";
  if (code === "auth/network-request-failed")
    return "No connection to the sign-in service.";
  return "Could not sign in. Try again.";
}
