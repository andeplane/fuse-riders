import { createSampleLoader, sampleUrl } from "./samples";
import { SYSTEM_SOUND_EVENTS } from "./soundEvents";

describe(sampleUrl.name, () => {
  it("has a recording for the drive's two sounds and for nothing else", () => {
    expect(sampleUrl("floppy")).toMatch(/floppy-open.*\.mp3$/);
    expect(sampleUrl("seek")).toMatch(/floppy-seek.*\.mp3$/);
    expect(
      SYSTEM_SOUND_EVENTS.filter((event) => sampleUrl(event) !== undefined),
    ).toEqual(["floppy", "seek"]);
  });
});

describe(createSampleLoader.name, () => {
  const clip = new Uint8Array([1, 2, 3]).buffer;

  it("fetches the clip of a recorded sound and nothing for a synthesised one", async () => {
    const fetched: string[] = [];
    const load = createSampleLoader((url) => {
      fetched.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(clip),
      });
    });
    await expect(load("floppy")).resolves.toBe(clip);
    await expect(load("modem")).resolves.toBeUndefined();
    expect(fetched).toEqual([sampleUrl("floppy")]);
  });

  it("rejects when the clip is not there, so the synthesiser can stand in", async () => {
    const load = createSampleLoader(
      () =>
        Promise.resolve({
          ok: false,
          status: 404,
          arrayBuffer: () => Promise.resolve(clip),
        }),
      () => "/sounds/gone.mp3",
    );
    await expect(load("seek")).rejects.toThrow(
      "Sound sample /sounds/gone.mp3 answered 404",
    );
  });
});
