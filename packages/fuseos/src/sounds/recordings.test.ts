import { createRecordingLoader, RECORDING_URLS } from "./recordings";

describe(createRecordingLoader.name, () => {
  it("has a recorded clip for the drive's spin-up and its seek, and none for the rest", () => {
    expect(Object.keys(RECORDING_URLS).sort()).toEqual(["floppy", "seek"]);
    expect(RECORDING_URLS.floppy).toMatch(/floppy-open\.mp3/);
    expect(RECORDING_URLS.seek).toMatch(/floppy-seek\.mp3/);
  });

  it("fetches an event's clip, and gives nothing for an event without one or a failed response", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const asked: string[] = [];
    const load = createRecordingLoader(
      (url) => {
        asked.push(url);
        return Promise.resolve(
          url === "/a.mp3"
            ? new Response(bytes)
            : new Response(null, { status: 404 }),
        );
      },
      { floppy: "/a.mp3", seek: "/missing.mp3" },
    );
    const clip = await load("floppy");
    expect(clip && new Uint8Array(clip)).toEqual(bytes);
    expect(await load("seek")).toBeUndefined();
    expect(await load("ding")).toBeUndefined();
    expect(asked).toEqual(["/a.mp3", "/missing.mp3"]);
  });
});
