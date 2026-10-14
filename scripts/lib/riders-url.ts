/** Browser smokes receive a site root from CI; Riders now has its own entrance. */
export function ridersPageUrl(siteUrl: string): string {
  const url = new URL(siteUrl);
  url.pathname = `${url.pathname.replace(/\/?$/, "/")}fuse-riders/`;
  return url.href;
}
