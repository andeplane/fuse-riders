import { isMediaStreamId, MEDIA_STREAMS } from "./streams";

describe("media streams", () => {
  it("knows the rickroll by id and nothing else", () => {
    expect(isMediaStreamId("rickroll")).toBe(true);
    expect(isMediaStreamId("constructor")).toBe(false);
    expect(isMediaStreamId(42)).toBe(false);
  });

  it("embeds through YouTube's privacy-enhanced domain only", () => {
    for (const stream of Object.values(MEDIA_STREAMS))
      expect(new URL(stream.embedUrl).hostname).toBe(
        "www.youtube-nocookie.com",
      );
    expect(MEDIA_STREAMS.rickroll.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
    expect(new URL(MEDIA_STREAMS.rickroll.watchUrl).searchParams.get("v")).toBe(
      "dQw4w9WgXcQ",
    );
  });
});
