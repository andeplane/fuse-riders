/**
 * IRC wire format (RFC 1459 / RFC 2812 framing with IRCv3 message tags), as pure functions.
 *
 *   ['@' tags SPACE] [':' prefix SPACE] command *(SPACE param) [SPACE ':' trailing]
 *
 * Parsing never throws: a line the parser cannot make sense of comes back as `undefined` so a bad
 * server line is dropped rather than taking the client down.
 */

/** A tag without a value (`@draft/bot`) is `true`; a valued one is its unescaped string. */
export type IrcTags = Readonly<Record<string, string | true>>;

export type IrcPrefix = {
  /** The whole prefix as sent (`nick!user@host` or a server name). */
  raw: string;
  /** The nick, or the server name when the prefix has no `!`/`@`. */
  nick: string;
  user?: string;
  host?: string;
};

export type IrcMessage = {
  tags: IrcTags;
  prefix?: IrcPrefix;
  /** Upper-cased command or three-digit numeric. */
  command: string;
  params: readonly string[];
};

/** RFC 1459: 512 bytes including CRLF, so 510 of content. IRCv3 allows 8191 more bytes of tags. */
export const MAX_LINE_BYTES = 510;
/** Lines longer than this (tags included) are refused outright: a bound on what the parser accepts. */
export const MAX_INBOUND_LINE_LENGTH = 8191 + 512;

const TAG_UNESCAPES: Record<string, string> = {
  ":": ";",
  s: " ",
  "\\": "\\",
  r: "\r",
  n: "\n",
};

export function unescapeTagValue(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    // A lone trailing backslash is dropped; an unknown escape keeps the character itself.
    if (next === undefined) break;
    out += TAG_UNESCAPES[next] ?? next;
  }
  return out;
}

export function escapeTagValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\:")
    .replace(/ /g, "\\s")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function parseTags(raw: string): IrcTags {
  const tags: Record<string, string | true> = {};
  for (const part of raw.split(";")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    if (eq === -1) tags[part] = true;
    else {
      const value = unescapeTagValue(part.slice(eq + 1));
      // `key=` is the same as a missing value.
      tags[part.slice(0, eq)] = value.length === 0 ? true : value;
    }
  }
  return tags;
}

export function parsePrefix(raw: string): IrcPrefix {
  const bang = raw.indexOf("!");
  const at = raw.indexOf("@", bang === -1 ? 0 : bang);
  if (bang === -1 && at === -1) return { raw, nick: raw };
  const nickEnd = bang !== -1 ? bang : at;
  const prefix: IrcPrefix = { raw, nick: raw.slice(0, nickEnd) };
  if (bang !== -1)
    prefix.user = raw.slice(bang + 1, at === -1 ? undefined : at);
  if (at !== -1) prefix.host = raw.slice(at + 1);
  return prefix;
}

/** Parses one line (without its CRLF). Returns undefined for an empty, oversized or command-less line. */
export function parseMessage(input: string): IrcMessage | undefined {
  const line = input.replace(/[\r\n]+$/, "");
  if (line.length === 0 || line.length > MAX_INBOUND_LINE_LENGTH)
    return undefined;
  let rest = line;
  let tags: IrcTags = {};
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    if (space === -1) return undefined;
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1).replace(/^ +/, "");
  }
  let prefix: IrcPrefix | undefined;
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    if (space === -1) return undefined;
    prefix = parsePrefix(rest.slice(1, space));
    rest = rest.slice(space + 1).replace(/^ +/, "");
  }
  const params: string[] = [];
  let command = "";
  while (rest.length > 0) {
    if (command.length > 0 && rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const space = rest.indexOf(" ");
    const word = space === -1 ? rest : rest.slice(0, space);
    if (command.length === 0) command = word.toUpperCase();
    else params.push(word);
    rest = space === -1 ? "" : rest.slice(space + 1).replace(/^ +/, "");
  }
  if (command.length === 0) return undefined;
  return prefix ? { tags, prefix, command, params } : { tags, command, params };
}

/** Removes characters that would let a parameter end the line early and smuggle a second command. */
export function sanitizeParam(value: string): string {
  return value.replace(/[\r\n\0]/g, " ");
}

/**
 * Serializes a message for sending. Every parameter but the last must be a single non-empty word; the
 * last is sent as a trailing parameter whenever it needs to be (spaces, a leading colon, empty).
 */
export function serializeMessage(
  message: Pick<IrcMessage, "command" | "params"> & { tags?: IrcTags },
): string {
  const parts: string[] = [];
  const tagEntries = Object.entries(message.tags ?? {});
  if (tagEntries.length > 0)
    parts.push(
      "@" +
        tagEntries
          .map(([key, value]) =>
            value === true ? key : `${key}=${escapeTagValue(value)}`,
          )
          .join(";"),
    );
  parts.push(sanitizeParam(message.command).replace(/ /g, ""));
  message.params.forEach((param, index) => {
    const clean = sanitizeParam(param);
    const last = index === message.params.length - 1;
    if (
      last &&
      (clean.length === 0 || clean.includes(" ") || clean.startsWith(":"))
    )
      parts.push(`:${clean}`);
    else parts.push(clean.replace(/ /g, ""));
  });
  return parts.join(" ");
}

/** Shorthand for the common client case: `line("PRIVMSG", "#chan", "hello there")`. */
export function line(command: string, ...params: string[]): string {
  return serializeMessage({ command, params });
}

const CTCP_DELIM = "\x01";

export type Ctcp = { command: string; args: string };

/** A PRIVMSG/NOTICE body wrapped in \x01 is a CTCP request or reply (`\x01ACTION waves\x01`). */
export function parseCtcp(text: string): Ctcp | undefined {
  if (!text.startsWith(CTCP_DELIM)) return undefined;
  const body = text.slice(1).replace(/\x01$/, "");
  const space = body.indexOf(" ");
  const command = (space === -1 ? body : body.slice(0, space)).toUpperCase();
  if (command.length === 0) return undefined;
  return { command, args: space === -1 ? "" : body.slice(space + 1) };
}

export function formatCtcp(command: string, args = ""): string {
  const body = args.length > 0 ? `${command} ${args}` : command;
  return `${CTCP_DELIM}${body.replace(/\x01/g, "")}${CTCP_DELIM}`;
}

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Splits `text` into pieces whose UTF-8 size is at most `maxBytes`, preferring to break at a space and
 * never inside a character (surrogate pairs included). Used to keep PRIVMSG lines under 512 bytes.
 */
export function splitByBytes(text: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new RangeError("maxBytes must be at least 4");
  const chunks: string[] = [];
  let rest = text;
  while (byteLength(rest) > maxBytes) {
    const chars = Array.from(rest);
    let size = 0;
    let cut = 0;
    let lastSpace = -1;
    for (let index = 0; index < chars.length; index += 1) {
      const charBytes = byteLength(chars[index] as string);
      if (size + charBytes > maxBytes) break;
      size += charBytes;
      cut = index + 1;
      if (chars[index] === " ") lastSpace = index;
    }
    // A space right after the cut is the best break of all; then the last space inside; then a hard cut.
    const end = chars[cut] === " " ? cut : lastSpace > 0 ? lastSpace : cut;
    chunks.push(chars.slice(0, end).join(""));
    rest = chars.slice(chars[end] === " " ? end + 1 : end).join("");
  }
  if (rest.length > 0 || chunks.length === 0) chunks.push(rest);
  return chunks;
}
