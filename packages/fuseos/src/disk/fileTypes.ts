import type { IconName } from "../ui/icons";

/** How the desktop can open a file: as text in Notepad++, as a picture, or not at all. */
export type FileKind = "text" | "image" | "binary";

/** Syntax highlighting Notepad++ offers; "plain" for everything else. */
export type EditorLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "markdown"
  | "css"
  | "html"
  | "yaml"
  | "plain";

/** Files larger than this never open in Notepad++ ("file too large" instead). */
export const MAX_TEXT_FILE_BYTES = 512 * 1024;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

const BINARY_EXTENSIONS = new Set([
  "zip",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "wasm",
  "exe",
  "dll",
  "bin",
  "dat",
  "mp3",
  "m4a",
  "ogg",
  "wav",
  "mp4",
  "webm",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pdf",
  "jsdos",
  "lock",
  "psd",
  "xcf",
  "aseprite",
  "pyc",
  "class",
  "o",
  "a",
  "so",
  "dylib",
  "node",
]);

const LANGUAGES: Record<string, EditorLanguage> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  html: "html",
  htm: "html",
  yml: "yaml",
  yaml: "yaml",
};

const TYPE_LABELS: Record<string, string> = {
  ts: "TypeScript Source",
  tsx: "TypeScript React Source",
  js: "JavaScript Source",
  mjs: "JavaScript Module",
  cjs: "JavaScript Module",
  jsx: "JavaScript React Source",
  json: "JSON Document",
  md: "Markdown Document",
  css: "Style Sheet",
  html: "HTML Document",
  yml: "YAML Document",
  yaml: "YAML Document",
  txt: "Text Document",
  py: "Python Script",
  sh: "Shell Script",
  svg: "SVG Image",
  png: "PNG Image",
  jpg: "JPEG Image",
  jpeg: "JPEG Image",
  gif: "GIF Image",
  webp: "WebP Image",
  ico: "Icon",
  zip: "WinZip File",
  wasm: "WebAssembly Module",
  mp3: "MP3 Audio",
  m4a: "AAC Audio",
  lock: "Lock File",
  toml: "TOML Document",
};

/** The extension, lower case, without the dot; "" when the name has none (a dotfile has none either). */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function fileKind(name: string): FileKind {
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (BINARY_EXTENSIONS.has(extension)) return "binary";
  return "text";
}

export function editorLanguage(name: string): EditorLanguage {
  return LANGUAGES[extensionOf(name)] ?? "plain";
}

/** Explorer's Type column. */
export function fileTypeLabel(name: string): string {
  const extension = extensionOf(name);
  const known = TYPE_LABELS[extension];
  if (known) return known;
  if (extension === "") return "File";
  return `${extension.toUpperCase()} File`;
}

export function fileIcon(name: string): IconName {
  switch (fileKind(name)) {
    case "image":
      return "image";
    case "binary":
      return extensionOf(name) === "zip" ? "zip" : "unknownFile";
    case "text":
      return editorLanguage(name) === "plain" &&
        extensionOf(name) !== "txt" &&
        extensionOf(name) !== ""
        ? "file"
        : editorLanguage(name) === "plain"
          ? "textFile"
          : "codeFile";
  }
}

/** Explorer's Size column: whole kilobytes like Windows, megabytes with two decimals from 1 MB. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString("en-US")} KB`;
}
