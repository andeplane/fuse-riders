import {
  DEFRAG_COMPACT_SIZE,
  DEFRAG_DETAILS_SIZE,
  DEFRAG_SELECT_SIZE,
  DEFRAG_SETTINGS_SIZE,
  defragWindowMeta,
  isDefragWindowContent,
} from "./defragWindowContent";

describe("isDefragWindowContent", () => {
  it("accepts a bare window and one mid-run", () => {
    expect(isDefragWindowContent({ kind: "defrag" })).toBe(true);
    expect(
      isDefragWindowContent({
        kind: "defrag",
        drive: "A",
        stage: "running",
        details: true,
        percent: 42,
      }),
    ).toBe(true);
    expect(isDefragWindowContent({ drive: "C", stage: "select" })).toBe(true);
    expect(isDefragWindowContent({ stage: "settings" })).toBe(true);
  });

  it.each([
    { drive: "D" },
    { stage: "finished" },
    { details: "yes" },
    { percent: "12" },
    { percent: Number.NaN },
  ])("rejects %o", (value) => {
    expect(isDefragWindowContent({ kind: "defrag", ...value })).toBe(false);
  });
});

describe("defragWindowMeta", () => {
  it("titles and sizes each dialog the program shows", () => {
    expect(defragWindowMeta({})).toEqual({
      title: "Select Drive",
      size: DEFRAG_SELECT_SIZE,
    });
    expect(defragWindowMeta({ stage: "select", drive: "A" }).title).toBe(
      "Select Drive",
    );
    expect(defragWindowMeta({ stage: "settings" })).toEqual({
      title: "Disk Defragmenter Settings",
      size: DEFRAG_SETTINGS_SIZE,
    });
  });

  it("puts the percent first while running, so a truncated taskbar button still shows it", () => {
    expect(
      defragWindowMeta({ stage: "running", drive: "C", percent: 37 }),
    ).toEqual({
      title: "37% - Defragmenting Drive C",
      size: DEFRAG_COMPACT_SIZE,
    });
    expect(
      defragWindowMeta({ stage: "running", drive: "A", details: true }),
    ).toEqual({
      title: "0% - Defragmenting Drive A",
      size: DEFRAG_DETAILS_SIZE,
    });
    expect(defragWindowMeta({ stage: "running" }).title).toBe(
      "0% - Defragmenting Drive C",
    );
  });
});
