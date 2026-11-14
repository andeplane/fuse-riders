export class WorkspaceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface WorkspaceTransport {
  token(): Promise<string | undefined>;
  request: typeof fetch;
  origin: string;
}

/** Credentials never enter a URL; responses and browser caches never persist private data. */
export function createWorkspaceApi(transport: WorkspaceTransport) {
  async function response(
    path: string,
    signal: AbortSignal,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(path, transport.origin);
    if (
      url.origin !== new URL(transport.origin).origin ||
      !url.pathname.startsWith("/api/dev/")
    )
      throw new WorkspaceError(
        400,
        "This private attachment cannot be opened.",
      );
    const token = await transport.token();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!token)
      throw new WorkspaceError(401, "Sign in to open the developer workspace.");
    const result = await transport.request(url, {
      ...init,
      signal,
      cache: "no-store",
      credentials: "omit",
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
    if (!result.ok) {
      const message =
        result.status === 401
          ? "Your sign-in expired. Sign in again."
          : result.status === 403
            ? "This Google account does not have developer access."
            : result.status === 400 || result.status === 422
              ? url.pathname === "/api/dev/metrics"
                ? "This date range cannot be loaded. Choose a shorter range or another period."
                : "This request could not be accepted. Check the fields and try again."
              : result.status === 404
                ? "This item is no longer available. It may have expired."
                : result.status === 429
                  ? "Too many requests. Wait a moment, then retry."
                  : "The developer service could not complete this request. Try again.";
      throw new WorkspaceError(result.status, message);
    }
    return result;
  }
  return {
    async json<T>(
      path: string,
      signal: AbortSignal,
      init?: RequestInit,
    ): Promise<T> {
      return (await response(path, signal, init)).json() as Promise<T>;
    },
    async blob(path: string, signal: AbortSignal): Promise<Blob> {
      return (await response(path, signal)).blob();
    },
  };
}
