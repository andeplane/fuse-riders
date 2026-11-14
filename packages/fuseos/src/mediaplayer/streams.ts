/**
 * The few "videos" the fake Media Player really plays: YouTube's privacy-enhanced embed (no download, no
 * copy of the video here), shown in the player's screen once the buffering theatre is over. A closed set
 * by id, so nothing stored in the browser can point the player at another page.
 */
export type MediaStream = {
  /** The iframe's accessible title. */
  title: string;
  embedUrl: string;
};

export const MEDIA_STREAMS = {
  // A:\porn\definitely_not_porn.avi: Rick Astley, "Never Gonna Give You Up" (official video).
  rickroll: {
    title: "Rick Astley - Never Gonna Give You Up",
    embedUrl:
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0",
  },
} as const satisfies Record<string, MediaStream>;

export type MediaStreamId = keyof typeof MEDIA_STREAMS;

export function isMediaStreamId(value: unknown): value is MediaStreamId {
  return typeof value === "string" && Object.hasOwn(MEDIA_STREAMS, value);
}
