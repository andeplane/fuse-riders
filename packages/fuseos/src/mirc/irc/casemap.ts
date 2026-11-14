/**
 * RFC 1459 case mapping: IRC was written in Scandinavia, so `[]\~` are the upper case of `{}|^`.
 * Nicks and channel names compare equal under this mapping.
 */
export function ircLower(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[/g, "{")
    .replace(/\]/g, "}")
    .replace(/\\/g, "|")
    .replace(/~/g, "^");
}

export function ircEquals(a: string, b: string): boolean {
  return ircLower(a) === ircLower(b);
}
