import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import {
  createDeveloperVerifier,
  DEVELOPER_EMAILS,
} from "../src/developer-access.js";

const NOW = Date.parse("2026-11-14T12:00:00Z"),
  PROJECT = "fuse-project";
test("developer access requires signed Google provider and verified allowlisted email", async () => {
  const keys = await generateKeyPair("RS256"),
    seconds = NOW / 1000;
  const verify = createDeveloperVerifier(
    PROJECT,
    async () => keys.publicKey,
    () => NOW,
  );
  const token = (
    claims: JWTPayload = {},
    audience = PROJECT,
    issuer = `https://securetoken.google.com/${PROJECT}`,
  ) =>
    new SignJWT({
      sub: "google-user",
      email: "andersullnass@gmail.com",
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
      auth_time: seconds - 60,
      exp: seconds + 3600,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .sign(keys.privateKey);
  assert.deepEqual(await verify(await token()), {
    uid: "google-user",
    email: "andersullnass@gmail.com",
  });
  for (const email of DEVELOPER_EMAILS)
    assert.equal((await verify(await token({ email })))?.email, email);
  for (const claims of [
    { email: "outsider@gmail.com" },
    { email_verified: false },
    { email_verified: "true" },
    { firebase: { sign_in_provider: "anonymous" } },
    { firebase: {} },
    { auth_time: seconds + 600 },
    { exp: seconds - 600 },
    { exp: undefined },
    { sub: "bad/user" },
    { sub: "__bad__" },
  ])
    assert.equal(await verify(await token(claims)), undefined);
  assert.equal(await verify(await token({}, "wrong-project")), undefined);
  assert.equal(
    await verify(await token({}, PROJECT, "https://attacker.example")),
    undefined,
  );
  const stranger = await generateKeyPair("RS256");
  const forged = await new SignJWT({
    sub: "x",
    email: "andersullnass@gmail.com",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(stranger.privateKey);
  assert.equal(await verify(forged), undefined);
  assert.equal(await verify("bad-token"), undefined);
  assert.equal(await verify("x".repeat(4097)), undefined);
  assert.throws(() => createDeveloperVerifier("invalid/project"));
});
test("empty allowlist denies all and caller mutation cannot expand authorization", async () => {
  const keys = await generateKeyPair("RS256"),
    emails = new Set<string>();
  const verify = createDeveloperVerifier(
    PROJECT,
    async () => keys.publicKey,
    () => NOW,
    emails,
  );
  emails.add("andersullnass@gmail.com");
  const token = await new SignJWT({
    sub: "u",
    email: "andersullnass@gmail.com",
    email_verified: true,
    firebase: { sign_in_provider: "google.com" },
    auth_time: NOW / 1000 - 60,
  })
    .setExpirationTime(NOW / 1000 + 3600)
    .setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(PROJECT)
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey);
  assert.equal(await verify(token), undefined);
});
