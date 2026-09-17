import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google's signing keys for Firebase ID tokens. Public, so the gateway needs no Firebase credential or role. */
export const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
/** The only provider enabled on the project; a token minted any other way is not an account this game recognises. */
const SIGN_IN_PROVIDER = 'google.com';
const MAX_TOKEN_LENGTH = 4096;

/** Resolves a Firebase ID token to its account id, or undefined for anything that is not a valid, current token. */
export type IdentityVerifier = (idToken: string) => Promise<string | undefined>;

// Also a Firestore document id, which may not look like __this__.
export const validUid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value);

/**
 * A failed verification is never an error: the caller treats the request as a guest's. The reason is deliberately
 * not reported or logged, since the token is a bearer credential and its contents are personal data.
 */
export function createIdentityVerifier(projectId: string, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL)), now: () => number = Date.now): IdentityVerifier {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) throw new Error('Invalid Firebase project');
  return async idToken => {
    if (typeof idToken !== 'string' || !idToken || idToken.length > MAX_TOKEN_LENGTH) return undefined;
    try {
      const { payload } = await jwtVerify(idToken, keys, {
        algorithms: ['RS256'], issuer: `https://securetoken.google.com/${projectId}`, audience: projectId,
        currentDate: new Date(now()), clockTolerance: 5,
      });
      const firebase = payload.firebase as { sign_in_provider?: unknown } | undefined;
      if (!validUid(payload.sub) || firebase?.sign_in_provider !== SIGN_IN_PROVIDER) return undefined;
      // Firebase documents auth_time as "must be in the past"; a token claiming a future sign-in is malformed.
      if (typeof payload.auth_time !== 'number' || payload.auth_time * 1000 > now() + 5_000) return undefined;
      return payload.sub;
    } catch { return undefined; }
  };
}
