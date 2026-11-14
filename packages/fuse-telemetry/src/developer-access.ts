import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { RoomError } from "fuse-network-be";

export interface DeveloperPrincipal {
  uid: string;
  email: string;
}
export type DeveloperVerifier = (
  idToken: string,
) => Promise<DeveloperPrincipal | undefined>;
/** Server-owned access list: never accept an email sent separately by the browser. */
export const DEVELOPER_EMAILS: ReadonlySet<string> = new Set([
  "andersullnass@gmail.com",
  "andreas@bonito.no",
  "andreassolbra@gmail.com",
  "aasmund.eldhuset@gmail.com",
  "richard.rormark@gmail.com",
  "sindre@scrimba.com",
]);
export function createDeveloperVerifier(
  projectId: string,
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    ),
  ),
  now: () => number = Date.now,
  allowlist: ReadonlySet<string> = DEVELOPER_EMAILS,
): DeveloperVerifier {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId))
    throw new Error("Invalid Firebase project");
  // Snapshot configuration: later mutation cannot grant access to an existing verifier.
  const emails = new Set(allowlist);
  return async (idToken) => {
    if (!idToken || idToken.length > 4096) return undefined;
    try {
      const { payload } = await jwtVerify(idToken, keys, {
        algorithms: ["RS256"],
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        currentDate: new Date(now()),
        clockTolerance: 5,
      });
      const firebase = payload.firebase;
      if (
        !payload.sub ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub) ||
        /^__.*__$/.test(payload.sub) ||
        !firebase ||
        typeof firebase !== "object" ||
        !("sign_in_provider" in firebase) ||
        firebase.sign_in_provider !== "google.com" ||
        payload.email_verified !== true ||
        typeof payload.email !== "string" ||
        !emails.has(payload.email.toLowerCase()) ||
        typeof payload.auth_time !== "number" ||
        !Number.isFinite(payload.auth_time) ||
        payload.auth_time * 1000 > now() + 5000 ||
        typeof payload.exp !== "number"
      )
        return undefined;
      return { uid: payload.sub, email: payload.email.toLowerCase() };
    } catch {
      return undefined;
    }
  };
}
export const developerBearer = (req: IncomingMessage): string =>
  req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
export async function requireDeveloper(
  req: IncomingMessage,
  verifier: DeveloperVerifier,
): Promise<DeveloperPrincipal> {
  const token = developerBearer(req);
  if (!token) throw new RoomError(401, "Sign in to developer tools");
  const developer = await verifier(token);
  if (!developer) throw new RoomError(403, "Developer access required");
  return developer;
}
