import {
  editorLanguage,
  extensionOf,
  fileIcon,
  fileKind,
  fileTypeLabel,
  formatSize,
  MAX_TEXT_FILE_BYTES,
} from "./fileTypes";

describe("file types", () => {
  it("reads the extension, ignoring folders and dotfiles", () => {
    expect(extensionOf("App.tsx")).toBe("tsx");
    expect(extensionOf("packages/fuseos/src/App.TSX")).toBe("tsx");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("a.b/README")).toBe("");
  });

  it("sorts files into text, image and binary", () => {
    expect(fileKind("README.md")).toBe("text");
    expect(fileKind(".gitignore")).toBe("text");
    expect(fileKind("logo.png")).toBe("image");
    expect(fileKind("art.svg")).toBe("image");
    expect(fileKind("theme.mp3")).toBe("binary");
    expect(fileKind("pnpm-lock.yaml")).toBe("text");
    expect(fileKind("doom.jsdos")).toBe("binary");
    expect(fileKind("archive.zip")).toBe("binary");
  });

  it("picks the editor language by extension", () => {
    expect(editorLanguage("a.ts")).toBe("typescript");
    expect(editorLanguage("a.mts")).toBe("typescript");
    expect(editorLanguage("a.tsx")).toBe("tsx");
    expect(editorLanguage("a.js")).toBe("javascript");
    expect(editorLanguage("a.jsx")).toBe("jsx");
    expect(editorLanguage("a.json")).toBe("json");
    expect(editorLanguage("a.md")).toBe("markdown");
    expect(editorLanguage("a.css")).toBe("css");
    expect(editorLanguage("a.html")).toBe("html");
    expect(editorLanguage("a.yml")).toBe("yaml");
    expect(editorLanguage("a.yaml")).toBe("yaml");
    expect(editorLanguage("a.py")).toBe("plain");
    expect(editorLanguage("LICENSE")).toBe("plain");
  });

  it("labels the Type column", () => {
    expect(fileTypeLabel("App.tsx")).toBe("TypeScript React Source");
    expect(fileTypeLabel("notes.txt")).toBe("Text Document");
    expect(fileTypeLabel("slackbacup.zip")).toBe("WinZip File");
    expect(fileTypeLabel("Makefile")).toBe("File");
    expect(fileTypeLabel("x.weird")).toBe("WEIRD File");
  });

  it("chooses icons: pictures, archives, code, plain text and unknown binaries", () => {
    expect(fileIcon("logo.png")).toBe("image");
    expect(fileIcon("slackbacup.zip")).toBe("zip");
    expect(fileIcon("theme.mp3")).toBe("unknownFile");
    expect(fileIcon("App.tsx")).toBe("codeFile");
    expect(fileIcon("notes.txt")).toBe("textFile");
    expect(fileIcon("LICENSE")).toBe("textFile");
    expect(fileIcon("script.py")).toBe("file");
  });

  it("formats sizes like Explorer: whole KB, MB from a megabyte", () => {
    expect(formatSize(0)).toBe("1 KB");
    expect(formatSize(1)).toBe("1 KB");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1025)).toBe("2 KB");
    expect(formatSize(900 * 1024)).toBe("900 KB");
    expect(formatSize(1_415_577)).toBe("1.35 MB");
    expect(MAX_TEXT_FILE_BYTES).toBe(512 * 1024);
  });
});
