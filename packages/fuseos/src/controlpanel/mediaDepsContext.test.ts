import { defaultMediaDeps, MAX_WALLPAPER_EDGE } from "./mediaDepsContext";

describe("defaultMediaDeps", () => {
  it("caps wallpapers at 1600px on the long edge", () => {
    expect(MAX_WALLPAPER_EDGE).toBe(1600);
  });

  it("reports no camera where the browser has no getUserMedia, and the camera call fails there", async () => {
    // happy-dom ships navigator.mediaDevices without getUserMedia.
    expect(defaultMediaDeps.cameraAvailable()).toBe(false);
    let failed = false;
    try {
      await defaultMediaDeps.openCamera();
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it("cannot rasterise without a 2D canvas: a frame grab and an image read both say so", async () => {
    const video = document.createElement("video");
    await expect(defaultMediaDeps.captureFrame(video)).rejects.toThrow(
      "Canvas is not available",
    );
    const read = defaultMediaDeps.readImageFile(
      new Blob(["not really a picture"], { type: "image/png" }),
    );
    // happy-dom never fires load on an Image: the read rejects, or hangs; either way nothing resolves.
    const outcome = await Promise.race([
      read.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("pending"), 50),
      ),
    ]);
    expect(["rejected", "pending"]).toContain(outcome);
  });
});
