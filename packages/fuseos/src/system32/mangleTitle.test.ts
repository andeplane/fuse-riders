import { mangleTitle } from "./mangleTitle";

describe("mangleTitle", () => {
  it("misspells the titles the desktop uses, keeping case for shouted words", () => {
    expect(mangleTitle("Paint")).toBe("Pinat");
    expect(mangleTitle("Control Panel")).toBe("Cntorl Panle");
    expect(mangleTitle("Display Properties")).toBe("Dsiplay Proprties");
    expect(mangleTitle("About FuseOS")).toBe("Abuot FsueOS");
    expect(mangleTitle("WINAMP")).toBe("WIMANP");
  });

  it("swaps two inner letters of unknown words and leaves short ones and punctuation alone", () => {
    expect(mangleTitle("Fuseball")).not.toBe("Fuseball");
    expect(mangleTitle("Fuseball")).toHaveLength("Fuseball".length);
    expect([...mangleTitle("Fuseball")].sort()).toEqual([..."Fuseball"].sort());
    expect(mangleTitle("Fuseball").charAt(0)).toBe("F");
    expect(mangleTitle("Fuseball")).toBe("Fuseabll");
    // The two inner letters are the same, so the swap shows nothing: still a valid misspelling.
    expect(mangleTitle("DOOM")).toBe("DOOM");
    expect(mangleTitle("Pig - 3D")).toBe("Pig - 3D");
    expect(mangleTitle("Untitled - Paint")).toBe("Untiteld - Pinat");
  });

  it("is deterministic", () => {
    expect(mangleTitle("Fuse Riders")).toBe(mangleTitle("Fuse Riders"));
  });
});
