// Bundled URLs: the page never depends on files outside its deployed asset bundle.
const files = import.meta.glob<string>("../assets/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
export const spriteUrls: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [
    path
      .split("/")
      .at(-1)!
      .replace(/\.png$/, ""),
    url,
  ]),
);
