import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Parallel worktrees and stale processes hold the usual ports; walk up rather than die on EADDRINUSE. */
export async function listenFree(
  server: Server,
  port: number,
  hostname: string,
  tries = 20,
): Promise<number> {
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, hostname, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
        --tries <= 0
      )
        throw error;
      port++;
    }
  }
}
