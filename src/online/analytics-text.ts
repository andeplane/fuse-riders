/**
 * The only path free text takes into an analytics event.
 *
 * An event property is read by a third party, so a string the game did not write itself — an error message, a
 * transport status line — is bounded and scrubbed before it leaves: a browser's "Failed to fetch dynamically
 * imported module: https://…?room=AB42" names a live invite, and a room or peer token is 64 hex characters that
 * can turn up in any URL-shaped error. `track` runs every string property through `sanitizeText`, so a new
 * call site cannot forget to.
 */

/** Long enough for "TypeError: x is not a function at y", short enough that a stack or a payload cannot ride along. */
export const MAX_TEXT_LENGTH = 200;
/** Work is bounded too: a multi-kilobyte message is cut before the patterns below ever scan it. */
const MAX_SCANNED = 4096;

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Whole URLs first, so the query string, path and host all go at once. `blob:https://…` leaves `blob:[url]`.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, "[url]"],
  // A query string on a bare path ("/index.html?room=AB42").
  [/\?[\w.%~-]+=[^\s"'<>)\]]*/g, "[query]"],
  // Credential-shaped pairs outside any URL ("room=AB42", "token: abc", "Authorization: Bearer abc" — the scheme
  // word is not the secret, what follows it is). Deliberately not `code` or `key`: "error code: 1006" is the useful
  // half of a message, and the room code is covered by `room=` and by `secrets`.
  [
    /\b(room|token|secret|auth|authorization|password)\s*[=:]\s*(?:(?:bearer|basic)\s+)?[^\s"'<>&,;)\]]+/gi,
    "$1=[redacted]",
  ],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  // JWTs (a Firebase ID token), UUIDs, then any long hex or base64url run: `fuse-peer-*` and `fuse-room-*` are 64 hex.
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]"],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "[token]",
  ],
  [/\b[0-9a-f]{24,}\b/gi, "[token]"],
  [/[\w-]{40,}/g, "[token]"],
];

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return "[unprintable]";
  }
};

export interface SanitizeOptions {
  /** Defaults to `MAX_TEXT_LENGTH`. */
  max?: number;
  /**
   * Values known to be sensitive on this page, removed wherever they appear and however they are cased. A room
   * code is four ordinary characters — no pattern can tell "Room AB42 is full" from prose — so the caller that
   * knows the code names it. Entries shorter than three characters are ignored: they would shred the message.
   */
  secrets?: readonly (string | null | undefined)[];
}

/** Bounded, single-line text with URLs, query strings, credentials, e-mail addresses and token-shaped runs removed. */
export function sanitizeText(
  value: unknown,
  { max = MAX_TEXT_LENGTH, secrets = [] }: SanitizeOptions = {},
): string {
  let text = stringify(value);
  const cut = text.length > MAX_SCANNED;
  if (cut)
    // The cut can land inside a token, and half a token matches no pattern: drop the run the cut went through.
    text = text.slice(0, MAX_SCANNED).replace(/\S*$/, "");
  text = text
    // Zero-width and other format characters (U+200B, U+FEFF, soft hyphen…) can split a token so no pattern sees it.
    .replace(/\p{Cf}+/gu, "")
    // `room%3DAB42`: the separators a credential hides behind when a URL fragment is quoted percent-encoded.
    .replace(/%(?:3[ADF]|26|2F)/gi, (encoded) => decodeURIComponent(encoded));
  for (const [pattern, replacement] of PATTERNS)
    text = text.replace(pattern, replacement);
  for (const secret of secrets)
    if (secret && secret.length >= 3)
      text = text.replace(
        // Whole words only, so the code `AB42` never eats the middle of an unrelated longer word.
        new RegExp(
          `(?<![A-Za-z0-9])${escapeRegExp(secret)}(?![A-Za-z0-9])`,
          "gi",
        ),
        "[redacted]",
      );
  // One line: a stack trace's newlines and any control characters collapse to single spaces.
  text = text.replace(/[\s\p{Cc}]+/gu, " ").trim();
  // A multi-kilobyte input with no whitespace at all is dropped whole by the cut above; say so rather than send "".
  if (cut) text = `${text} [truncated]`.trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/**
 * Every string in a property bag, sanitised; arrays of strings too. Numbers, booleans and `null` pass through.
 * `undefined` is dropped as Mixpanel would drop it. Anything else (an object, a function) is a bug at the call
 * site — no event sends one today — and is reported as its type rather than serialised unbounded.
 */
export function sanitizeProperties(
  properties: Record<string, unknown>,
  options?: SanitizeOptions,
): Record<string, unknown> {
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return sanitizeText(value, options);
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    )
      return value;
    if (Array.isArray(value)) return value.slice(0, 32).map(clean);
    return `[${typeof value}]`;
  };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties))
    if (value !== undefined) result[key] = clean(value);
  return result;
}

/** Stable, low-cardinality reasons a page failed to boot. The message is for reading; this is for counting. */
export type BootFailureCode =
  "module-load" | "storage" | "webgl" | "network" | "unknown";

const errorName = (error: unknown): string => {
  if (error instanceof Error) return error.name || "Error";
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
  )
    return error.name; // A DOMException from another realm is not `instanceof Error`.
  return typeof error;
};

const errorMessage = (error: unknown): string => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return stringify(error);
};

export function bootFailureCode(error: unknown): BootFailureCode {
  const name = errorName(error),
    message = errorMessage(error);
  if (
    /dynamically imported module|module script|loading (?:css )?chunk|preload css/i.test(
      message,
    )
  )
    return "module-load";
  if (
    name === "SecurityError" ||
    name === "QuotaExceededError" ||
    /\b(?:local|session)storage\b|operation is insecure/i.test(message)
  )
    return "storage";
  if (/webgl|rendering context/i.test(message)) return "webgl";
  if (/failed to fetch|networkerror|load failed/i.test(message))
    return "network";
  return "unknown";
}

/** `Boot Failed`'s properties: the error's class and a stable code to count by, and a bounded, scrubbed message to read. */
export function bootFailedProps(
  error: unknown,
  options?: SanitizeOptions,
): { name: string; code: BootFailureCode; message: string } {
  return {
    name: sanitizeText(errorName(error), { ...options, max: 40 }),
    code: bootFailureCode(error),
    message: sanitizeText(errorMessage(error), options),
  };
}

/**
 * `Connect Failed`'s `status` is the runtime's status line, and two of its wordings name a rider: "Waiting for
 * <name>" and "Connected · <name> lagging". Both are all but unreachable before the first snapshot — which is
 * when `Connect Failed` fires — but the notice in SETTINGS says "No names", so the name never leaves. The fixed
 * wordings ("Waiting for the game…", "Waiting for a display") pass through. `null` when there is no status yet.
 */
export function connectStatus(status: string): string | null {
  if (!status) return null;
  if (/^Connected · .* lagging$/.test(status))
    return "Connected · [rider] lagging";
  if (/^Waiting for (?!the game\b|a display$)/.test(status))
    return "Waiting for [rider]";
  return status;
}
