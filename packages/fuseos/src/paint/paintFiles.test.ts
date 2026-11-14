import { fireEvent } from "@testing-library/react";

import { isWindowState } from "../state/appState";

import type { BrowserPaintFileOptions } from "./paintFiles";
import {
  createBrowserPaintFileDeps,
  fileNameFromUrl,
  imageFromUrl,
  openImageFromUrl,
} from "./paintFiles";

describe(createBrowserPaintFileDeps.name, () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("picks one image through a hidden file input that is removed again afterwards", async () => {
    const deps = createBrowserPaintFileDeps();
    const picked = deps.pickImage();
    const input = fileInput();
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(false);
    expect(input).toHaveAttribute("aria-label", "Open image file");

    const file = new File(["pixels"], "cat.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await picked).toBe(file);
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("resolves undefined when the picker is cancelled or closes with nothing chosen", async () => {
    const deps = createBrowserPaintFileDeps();
    const cancelled = deps.pickImage();
    fireEvent(fileInput(), new Event("cancel"));
    expect(await cancelled).toBeUndefined();

    const empty = deps.pickImage();
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(await empty).toBeUndefined();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("downloads through a temporary anchor and revokes the object URL once the browser has it", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const revoked: string[] = [];
    let later: (() => void) | undefined;
    const options: BrowserPaintFileOptions = {
      createObjectURL: (blob) => `blob:${blob.type}`,
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
      schedule: (callback) => {
        later = callback;
      },
    };
    const deps = createBrowserPaintFileDeps(options);

    deps.download(new Blob(["png"], { type: "image/png" }), "sketch.png");
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0];
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error("No anchor");
    expect(anchor.download).toBe("sketch.png");
    expect(anchor.href).toBe("blob:image/png");
    expect(document.body.contains(anchor)).toBe(false);
    expect(revoked).toEqual([]);
    later?.();
    expect(revoked).toEqual(["blob:image/png"]);
  });

  it("revokes a download's URL after a delay by default", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const revoked: string[] = [];
    const deps = createBrowserPaintFileDeps({
      createObjectURL: () => "blob:one",
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
    });
    deps.download(new Blob(["png"]), "one.png");
    expect(revoked).toEqual([]);
    vi.runAllTimers();
    expect(revoked).toEqual(["blob:one"]);
    vi.useRealTimers();
  });

  it("fetches an image as a blob and reports a failed response by status", async () => {
    const requested: string[] = [];
    const deps = createBrowserPaintFileDeps({
      fetch: async (url) => {
        requested.push(url);
        return url.endsWith("missing.png")
          ? new Response(null, { status: 404 })
          : new Response(new Blob(["png"], { type: "image/png" }), {
              status: 200,
            });
      },
    });
    const blob = await deps.fetchImage("https://raw.example.test/logo.png");
    expect(blob.type).toBe("image/png");
    await expect(
      deps.fetchImage("https://raw.example.test/missing.png"),
    ).rejects.toThrow("The server answered 404");
    expect(requested).toEqual([
      "https://raw.example.test/logo.png",
      "https://raw.example.test/missing.png",
    ]);
  });

  it("uses the browser's object URLs and fetch by default", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:default");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
      }),
    );
    let later: (() => void) | undefined;
    const deps = createBrowserPaintFileDeps({
      schedule: (callback) => {
        later = callback;
      },
    });

    const blob = new Blob(["png"], { type: "image/png" });
    deps.download(blob, "default.png");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    later?.();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:default");

    expect((await deps.fetchImage("https://raw.example.test/a.png")).type).toBe(
      "image/png",
    );
    expect(fetchSpy).toHaveBeenCalledWith("https://raw.example.test/a.png");
  });
});

describe(fileNameFromUrl.name, () => {
  it("takes the last path segment, decoded, ignoring query and fragment", () => {
    expect(
      fileNameFromUrl("https://raw.example.test/repo/sha/art/logo.png"),
    ).toBe("logo.png");
    expect(fileNameFromUrl("/fuseos/retro/doom%20cover.jpg?v=2#top")).toBe(
      "doom cover.jpg",
    );
    expect(fileNameFromUrl("logo.png")).toBe("logo.png");
  });

  it("falls back to untitled for an empty path and keeps a name it cannot decode", () => {
    expect(fileNameFromUrl("https://raw.example.test/")).toBe("untitled");
    expect(fileNameFromUrl("")).toBe("untitled");
    expect(fileNameFromUrl("https://raw.example.test/bad%E0%A4%A.png")).toBe(
      "bad%E0%A4%A.png",
    );
  });
});

describe(imageFromUrl.name, () => {
  it("is a Paint window on the URL, named as given or after the URL, that the state guard accepts", () => {
    const url = "https://raw.example.test/repo/sha/art/logo.png";
    expect(imageFromUrl(url, "Logo.png")).toEqual({
      kind: "paint",
      sourceUrl: url,
      fileName: "Logo.png",
    });
    expect(imageFromUrl(url)).toEqual({
      kind: "paint",
      sourceUrl: url,
      fileName: "logo.png",
    });
    expect(
      isWindowState({
        id: "w1",
        minimized: false,
        maximized: false,
        ...imageFromUrl(url),
      }),
    ).toBe(true);
    expect(
      isWindowState({
        id: "w1",
        minimized: false,
        maximized: false,
        kind: "paint",
        sourceUrl: 42,
      }),
    ).toBe(false);
  });

  it("openImageFromUrl opens that window through the window commands", () => {
    const open = vi.fn<(content: unknown) => void>();
    openImageFromUrl({ open }, "https://raw.example.test/a/b.png", "b.png");
    expect(open).toHaveBeenCalledWith({
      kind: "paint",
      sourceUrl: "https://raw.example.test/a/b.png",
      fileName: "b.png",
    });
  });
});

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type=file]");
  if (!(input instanceof HTMLInputElement)) throw new Error("No file input");
  return input;
}
