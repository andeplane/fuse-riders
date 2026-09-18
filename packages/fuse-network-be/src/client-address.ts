import { isIP } from "node:net";

/**
 * The identity a rate limit is kept under. An IPv4 address stands for itself. An IPv6 address stands for its /64:
 * a subscriber is routinely handed a whole /64 (or more), so a limit per full address is no limit at all — one
 * host can present 2^64 of them. A v4-mapped IPv6 address (`::ffff:a.b.c.d`) is the IPv4 address it wraps, so a
 * dual-stack listener cannot be used to get a second budget. Anything that is not an address shares one key:
 * unparsable input must not mint fresh budgets either.
 */
export function rateLimitAddress(raw: string): string {
  const address = raw.trim().replace(/%.*$/, "");
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return "unknown";
  // A dotted IPv4 tail is the last two groups.
  const text = address.replace(
    /(\d+)\.(\d+)\.(\d+)\.(\d+)$/,
    (_, a: string, b: string, c: string, d: string) =>
      `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`,
  );
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [],
    right = tail ? tail.split(":") : [];
  const groups = (
    tail === undefined
      ? left
      : [
          ...left,
          ...new Array<string>(8 - left.length - right.length).fill("0"),
          ...right,
        ]
  ).map((group) => Number.parseInt(group, 16));
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}
