export interface EndpointConfig {
  basePath: string;
  apiOrigin?: string;
}
/** Explicit deployment origin; invite URLs never inherit an API capability or backend path. */
export interface Endpoints {
  appUrl(query?: string): string;
  apiUrl(path: string): string;
}
export function createEndpoints(
  config: EndpointConfig,
  pageOrigin: string,
): Endpoints {
  const origin = new URL(pageOrigin).origin;
  const base = new URL(config.basePath, origin);
  if (
    base.origin !== origin ||
    !base.pathname.endsWith("/") ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid frontend base path");
  const api = new URL(config.apiOrigin || origin);
  if (
    !["http:", "https:"].includes(api.protocol) ||
    api.username ||
    api.password ||
    api.pathname !== "/" ||
    api.search ||
    api.hash
  )
    throw new Error("Invalid API origin");
  return {
    appUrl(query = ""): string {
      if (query && !query.startsWith("?"))
        throw new Error("Expected room query");
      const url = new URL(base);
      url.search = query;
      return url.href;
    },
    apiUrl(path: string): string {
      if (!path.startsWith("/api/") || path.includes("\\"))
        throw new Error("Invalid API path");
      const url = new URL(path, api);
      if (url.origin !== api.origin || !url.pathname.startsWith("/api/"))
        throw new Error("Invalid API path");
      return url.href;
    },
  };
}
