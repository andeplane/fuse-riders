/** Older Riders invites and solo bookmarks used the site root. Keep their query and fragment intact. */
export function legacyRidersLink(search: string): boolean {
  const query = new URLSearchParams(search);
  return ["room", "solo", "display"].some((key) => query.has(key));
}
