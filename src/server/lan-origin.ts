/** Same-origin browser pages only, restricted to the server's own advertised/local hosts. */
export function allowLanOrigin(
  origin: string | undefined,
  host: string | undefined,
  localHosts: readonly string[],
): boolean {
  if (!origin || !host) return false;
  try {
    const target = new URL(`http://${host}`);
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/^\[|\]$/g, "")
        .replace(/^::ffff:/, "");
    return (
      origin === target.origin &&
      localHosts.some(
        (value) => normalize(value) === normalize(target.hostname),
      )
    );
  } catch {
    return false;
  }
}
