import { parseFoldParam, withoutFoldParam } from "./demoTrigger";

describe("parseFoldParam", () => {
  it("is no demo without the parameter or with something it does not know", () => {
    expect(parseFoldParam("")).toBeUndefined();
    expect(parseFoldParam("?open=paint")).toBeUndefined();
    expect(parseFoldParam("?fold=")).toBeUndefined();
    expect(parseFoldParam("?fold=later")).toBeUndefined();
    expect(parseFoldParam("?fold=stage:")).toBeUndefined();
    expect(parseFoldParam("?fold=stage:x")).toBeUndefined();
  });

  it("plays the whole sequence on now, lands on a stage, or goes straight to the blue screen", () => {
    expect(parseFoldParam("?fold=now")).toEqual({ kind: "now" });
    expect(parseFoldParam("?fold=NOW")).toEqual({ kind: "now" });
    expect(parseFoldParam("?open=paint&fold=stage:4")).toEqual({
      kind: "stage",
      stage: 4,
    });
    expect(parseFoldParam("?fold=Stage:0")).toEqual({
      kind: "stage",
      stage: 0,
    });
    expect(parseFoldParam("?fold=bsod")).toEqual({ kind: "bsod" });
  });
});

describe("withoutFoldParam", () => {
  it("drops only the fold parameter", () => {
    expect(
      withoutFoldParam("https://fuseos.test/fuse-riders/?fold=now&open=paint"),
    ).toBe("https://fuseos.test/fuse-riders/?open=paint");
    expect(withoutFoldParam("https://fuseos.test/?fold=stage:3")).toBe(
      "https://fuseos.test/",
    );
  });
});
