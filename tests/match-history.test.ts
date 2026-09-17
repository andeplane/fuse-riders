import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { WebSocket } from "ws";
import { AVATARS } from "../src/shared/avatars.js";
import { createDevRoomService } from "../src/service/dev.js";
import { createIdentityVerifier } from "../src/service/identity.js";
import {
  GUEST_MATCH_TTL_MS,
  HistoryStore,
  PENDING_TTL_MS,
  matchRecordId,
  parseMatchRecord,
  parseMatchResult,
  type MatchRecord,
  type MatchResult,
  type StoredPlayer,
} from "../src/service/history.js";
import { MemoryRoomDatabase } from "fuse-network-be";
import { MemoryHistoryDatabase } from "../src/service/memory-history.js";
import { RoomStore, digest, peerId } from "fuse-network-be";

const PROJECT = "fuse-test-project";
const COLORS = ["#22d3ee", "#ff4fa3", "#a3e635", "#fb923c", "#a78bfa"];

function player(
  playerId: string,
  slot: number,
  placement: number,
  extra: Partial<StoredPlayer> = {},
): StoredPlayer {
  return {
    playerId,
    name: `Rider ${slot + 1}`,
    slot,
    color: COLORS[slot]!,
    roundsPlayed: 5,
    roundWins: placement === 1 ? 3 : 1,
    matchScoreUnits: 10 - placement,
    roundsDrawn: 0,
    matchPlacement: placement,
    survivalTicks: 900,
    longestSurvivalTicks: 400,
    distanceUnits: 12_000,
    bombsPlaced: 7,
    bombsExploded: 7,
    eliminations: 2,
    deathsByCause: { wall: 1, trail: 1, explosion: 0, rider: 0 },
    pickupsCollected: 4,
    powerPickups: 1,
    starPickups: 0,
    beerPickups: 0,
    inkPickups: 0,
    triplePickups: 1,
    fivePickups: 0,
    targetPickups: 0,
    shieldPickups: 1,
    portalPickups: 1,
    portalTransits: 2,
    invulnerableTicks: 30,
    wallBounces: 0,
    earlyExits: 0,
    ...extra,
  };
}
const resultOf = (ids: string[], matchId = "match-1"): MatchResult => ({
  matchId,
  length: 5,
  finishers: ids.filter((id) => !id.startsWith("bot:")).sort(),
  winnerId: ids[0]!,
  players: ids.map((id, slot) => player(id, slot, slot + 1)),
});
const token = () => randomBytes(32).toString("hex");

// ---- sign-in verification ----

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256"),
    jwk = {
      ...(await exportJWK(publicKey)),
      kid: "key-1",
      alg: "RS256",
      use: "sig",
    };
  const now = 1_800_000_000_000,
    seconds = Math.floor(now / 1000);
  const verify = createIdentityVerifier(
    PROJECT,
    createLocalJWKSet({ keys: [jwk] }),
    () => now,
  );
  // Every token is signed with the published key unless a case says otherwise, so each case fails on the one claim it names.
  const sign = (claims: Record<string, unknown> = {}, key = privateKey) => {
    const text = (name: string, fallback: string) =>
      typeof claims[name] === "string" ? (claims[name] as string) : fallback;
    return new SignJWT({
      firebase: { sign_in_provider: "google.com" },
      auth_time: seconds - 60,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer(text("iss", `https://securetoken.google.com/${PROJECT}`))
      .setAudience(text("aud", PROJECT))
      .setSubject(text("sub", "uid123"))
      .setIssuedAt(seconds - 60)
      .setExpirationTime(
        typeof claims.exp === "number" ? claims.exp : seconds + 3000,
      )
      .sign(key);
  };
  return { verify, sign, seconds };
}

test("a Firebase ID token for this project resolves to its account", async () => {
  const { verify, sign } = await signer();
  assert.equal(await verify(await sign()), "uid123");
});

test("anything else is a guest: wrong project, issuer, provider, key, algorithm, time or shape", async () => {
  const { verify, sign, seconds } = await signer(),
    other = await generateKeyPair("RS256");
  const cases: Record<string, string> = {
    "another project audience": await sign({ aud: "someone-else" }),
    "another issuer": await sign({
      iss: "https://securetoken.google.com/someone-else",
    }),
    "a Google account token rather than a Firebase one": await sign({
      iss: "https://accounts.google.com",
    }),
    "a key Google did not publish": await sign({}, other.privateKey),
    "an expired token": await sign({ exp: seconds - 3600 }),
    "a password account": await sign({
      firebase: { sign_in_provider: "password" },
    }),
    "an anonymous account": await sign({
      firebase: { sign_in_provider: "anonymous" },
    }),
    "no provider claim": await sign({ firebase: undefined }),
    "a sign-in from the future": await sign({ auth_time: seconds + 3600 }),
    "no sign-in time": await sign({ auth_time: undefined }),
    "an unsigned token": `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "uid123", aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` })).toString("base64url")}.`,
    garbage: "not-a-token",
    nothing: "",
    "an oversized token": "a".repeat(5000),
  };
  for (const [label, value] of Object.entries(cases))
    assert.equal(await verify(value), undefined, label);
  assert.equal(
    await verify(await sign({ sub: "has/slash" })),
    undefined,
    "a subject that could not be a document id",
  );
  assert.equal(
    await verify(await sign({ sub: "__reserved__" })),
    undefined,
    "a subject Firestore reserves",
  );
  assert.throws(() => createIdentityVerifier("Not A Project"));
});

// ---- results: parsing ----

test("a result is normalised, and anything outside the schema is refused", () => {
  const a = peerId(token()),
    b = peerId(token()),
    good = resultOf([a, b, "bot:1"]);
  const parsed = parseMatchResult(structuredClone(good))!;
  assert.deepEqual(parsed, good);
  const shuffled = {
    players: [...good.players]
      .reverse()
      .map((entry) => Object.fromEntries(Object.entries(entry).reverse())),
    finishers: [...good.finishers].reverse(),
    winnerId: a,
    length: 5,
    matchId: "match-1",
  };
  assert.equal(
    JSON.stringify(parseMatchResult(shuffled)),
    JSON.stringify(parsed),
    "key and player order do not change the stored bytes",
  );
  const broken: Record<string, (value: MatchResult) => unknown> = {
    "an extra field": (value) => ({ ...value, uid: "someone" }),
    "an extra player field": (value) => ({
      ...value,
      players: [{ ...value.players[0], uid: "someone" }, value.players[1]],
    }),
    "a script in a name": (value) => ({
      ...value,
      players: [
        { ...value.players[0], name: `a${String.fromCharCode(7)}b` },
        value.players[1],
      ],
    }),
    "half a surrogate pair in a name": (value) => ({
      ...value,
      players: [
        { ...value.players[0], name: `a${String.fromCharCode(0xd800)}` },
        value.players[1],
      ],
    }),
    "a name the room would have trimmed": (value) => ({
      ...value,
      players: [{ ...value.players[0], name: " pad " }, value.players[1]],
    }),
    "more round wins than rounds": (value) => ({
      ...value,
      players: [{ ...value.players[0], roundWins: 6 }, value.players[1]],
    }),
    "a placement below first": (value) => ({
      ...value,
      players: [{ ...value.players[0], matchPlacement: 0 }, value.players[1]],
    }),
    "a placement past last": (value) => ({
      ...value,
      players: [{ ...value.players[0], matchPlacement: 4 }, value.players[1]],
    }),
    "a slot the arena does not have": (value) => ({
      ...value,
      players: [{ ...value.players[0], slot: 5 }, value.players[1]],
    }),
    "an implausible kill count": (value) => ({
      ...value,
      players: [
        { ...value.players[0], eliminations: 20_001 },
        value.players[1],
      ],
    }),
    "a long name": (value) => ({
      ...value,
      players: [
        { ...value.players[0], name: "x".repeat(19) },
        value.players[1],
      ],
    }),
    "a style in a colour": (value) => ({
      ...value,
      players: [
        { ...value.players[0], color: "red;background:url(x)" },
        value.players[1],
      ],
    }),
    "a negative stat": (value) => ({
      ...value,
      players: [{ ...value.players[0], eliminations: -1 }, value.players[1]],
    }),
    "a fractional stat": (value) => ({
      ...value,
      players: [{ ...value.players[0], eliminations: 1.5 }, value.players[1]],
    }),
    "an absurd stat": (value) => ({
      ...value,
      players: [{ ...value.players[0], eliminations: 1e12 }, value.players[1]],
    }),
    "a missing death cause": (value) => ({
      ...value,
      players: [
        { ...value.players[0], deathsByCause: { wall: 0 } },
        value.players[1],
      ],
    }),
    "an avatar inside the agreed result": (value) => ({
      ...value,
      players: [{ ...value.players[0], avatarId: "nope" }, value.players[1]],
    }),
    "an id that is neither a peer nor a bot": (value) => ({
      ...value,
      players: [{ ...value.players[0], playerId: "admin" }, value.players[1]],
    }),
    "a repeated rider": (value) => ({
      ...value,
      players: [value.players[0], { ...value.players[0], slot: 1 }],
    }),
    "an invalid seat slot": (value) => ({
      ...value,
      players: [0, 1, 2, 3, 4, 5].map((slot) =>
        player(`bot:${slot}`, slot, slot + 1),
      ),
    }),
    "no riders": (value) => ({ ...value, players: [] }),
    "a winner who did not play": (value) => ({ ...value, winnerId: "bot:9" }),
    "a room setting inside the agreed result": (value) => ({
      ...value,
      mode: "devices",
    }),
    "a zero length": (value) => ({ ...value, length: 0 }),
    "a match id with spaces": (value) => ({ ...value, matchId: "a b" }),
    "an array": () => [],
    null: () => null,
  };
  for (const [label, change] of Object.entries(broken))
    assert.equal(
      parseMatchResult(change(structuredClone(good))),
      undefined,
      label,
    );
  assert.ok(
    parseMatchResult({ ...good, winnerId: undefined, players: good.players }),
    "a drawn match has no winner",
  );
});

test("a stored record is re-validated and sheds storage-only fields", () => {
  const a = peerId(token()),
    result = resultOf([a, "bot:1"]),
    id = matchRecordId("room-1", result);
  const record: MatchRecord = {
    version: 1,
    id,
    roomCode: "AB42",
    status: "confirmed",
    result,
    attesters: [a],
    uidByPlayer: { [a]: "uid1" },
    avatars: {},
    participantUids: ["uid1"],
    createdAt: 5,
    endedAt: 6,
  };
  assert.deepEqual(
    parseMatchRecord({ ...record, cleanupAt: { seconds: 1 } }),
    record,
  );
  for (const [label, change] of Object.entries<
    Partial<Record<keyof MatchRecord, unknown>>
  >({
    "confirmed without an end": { endedAt: undefined },
    "an attester who did not ride": { attesters: ["bot:1", a, "x"] },
    "an account on a bot": { uidByPlayer: { "bot:1": "uid1" } },
    "a bad account id": { uidByPlayer: { [a]: "a/b" } },
    "an unknown avatar": { avatars: { [a]: "nope" } },
    "an avatar on a bot": { avatars: { "bot:1": "nope" } },
    "too many accounts": { participantUids: ["u1", "u2"] },
    "another version": { version: 2 },
    "a bad id": { id: "x" },
    "a bad status": { status: "void" },
  }))
    assert.equal(parseMatchRecord({ ...record, ...change }), undefined, label);
  assert.notEqual(
    matchRecordId("room-2", result),
    id,
    "a reused room code is a different match",
  );
});

// ---- results: the store ----

async function room(riders: number) {
  let now = 1_000_000;
  const rooms = new RoomStore(new MemoryRoomDatabase(), {
      now: () => now,
      id: () => randomBytes(8).toString("hex"),
    }),
    matches = new MemoryHistoryDatabase();
  const history = new HistoryStore(matches, rooms, () => now),
    tokens = Array.from({ length: riders }, token),
    code = await rooms.createAvailable(tokens[0]!);
  for (const entry of tokens) await rooms.admit(code, entry, "gateway");
  let address = 0;
  // A fresh address per report, so only the limit a test is about can trip.
  const report = async (
    value: string,
    body: unknown,
    uid: string | undefined,
  ) =>
    history.submit(
      await history.admit(code, value, `address-${address++}`),
      body,
      uid,
    );
  return {
    rooms,
    matches,
    history,
    report,
    tokens,
    ids: tokens.map(peerId),
    code,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

test("a match is kept once a majority of its riders report the same result, and credits each signed-in rider once", async () => {
  const f = await room(3),
    result = resultOf([...f.ids, "bot:1"]);
  assert.deepEqual(await f.report(f.tokens[0]!, { result }, "alice"), {
    status: "pending",
    attestations: 1,
    needed: 2,
    linked: true,
  });
  assert.deepEqual(
    (await f.history.history("alice", undefined)).matches,
    [],
    "a pending match is nobody's history",
  );
  assert.deepEqual(
    await f.report(f.tokens[0]!, { result }, "alice"),
    { status: "pending", attestations: 1, needed: 2, linked: true },
    "a repeated report is not a second vote",
  );
  assert.equal(
    (await f.report(f.tokens[1]!, { result }, undefined)).status,
    "confirmed",
  );
  const alice = await f.history.history("alice", undefined);
  assert.equal(alice.matches.length, 1);
  assert.equal(alice.matches[0]!.you, f.ids[0]);
  assert.deepEqual(alice.matches[0]!.result, result);
  assert.equal(
    JSON.stringify(alice).includes("uidByPlayer"),
    false,
    "accounts of other riders are not exposed",
  );
  assert.deepEqual(
    { ...alice.profile!.totals },
    {
      matches: 1,
      wins: 1,
      roundWins: 3,
      eliminations: 2,
      bombsPlaced: 7,
      pickupsCollected: 4,
      survivalTicks: 900,
      distanceUnits: 12_000,
    },
  );
  // The third rider signs in late: linked to the confirmed match and credited, without re-crediting anyone.
  assert.deepEqual(await f.report(f.tokens[2]!, { result }, "carol"), {
    status: "confirmed",
    attestations: 3,
    needed: 2,
    linked: true,
  });
  await f.report(f.tokens[2]!, { result }, "carol");
  await f.report(f.tokens[0]!, { result }, "alice");
  assert.equal(
    (await f.history.history("carol", undefined)).profile!.totals.matches,
    1,
  );
  assert.equal(
    (await f.history.history("carol", undefined)).profile!.totals.wins,
    0,
  );
  assert.equal(
    (await f.history.history("alice", undefined)).profile!.totals.matches,
    1,
  );
});

test("a rider can only ever speak for their own seat and their own account", async () => {
  const f = await room(3),
    result = resultOf(f.ids),
    outsider = token();
  await assert.rejects(
    f.report(outsider, { result }, "mallory"),
    { status: 403 },
    "not in the room",
  );
  await assert.rejects(f.history.admit(f.code, "short", "ip"), { status: 401 });
  await assert.rejects(f.history.admit("nope", f.tokens[0]!, "ip"), {
    status: 401,
  });
  await assert.rejects(
    f.report(f.tokens[0]!, { result: { ...result, uid: "alice" } }, undefined),
    { status: 400 },
  );
  await assert.rejects(
    f.report(
      f.tokens[0]!,
      { result: resultOf([f.ids[1]!, f.ids[2]!]) },
      "mallory",
    ),
    { status: 403 },
    "a match the reporter did not ride in",
  );
  // One account on two seats is reported by both and credited once.
  await f.report(f.tokens[0]!, { result }, "alice");
  assert.deepEqual(await f.report(f.tokens[1]!, { result }, "alice"), {
    status: "confirmed",
    attestations: 2,
    needed: 2,
    linked: false,
  });
  assert.equal(
    (await f.history.history("alice", undefined)).profile!.totals.matches,
    1,
  );
  // A seat that is already someone's cannot be re-pointed at another account.
  assert.equal(
    (await f.report(f.tokens[0]!, { result }, "mallory")).linked,
    false,
  );
  assert.deepEqual((await f.history.history("mallory", undefined)).matches, []);
});

test("a forged result cannot displace or block the honest one", async () => {
  const f = await room(3),
    honest = resultOf(f.ids),
    forged = {
      ...resultOf([f.ids[2]!, f.ids[0]!, f.ids[1]!]),
      matchId: honest.matchId,
    };
  assert.equal(
    (await f.report(f.tokens[2]!, { result: forged }, "mallory")).status,
    "pending",
  );
  await f.report(f.tokens[0]!, { result: honest }, "alice");
  assert.equal(
    (await f.report(f.tokens[1]!, { result: honest }, "bob")).status,
    "confirmed",
  );
  assert.equal(
    (await f.report(f.tokens[2]!, { result: forged }, "mallory")).status,
    "pending",
    "one vote of three never confirms",
  );
  assert.deepEqual((await f.history.history("mallory", undefined)).matches, []);
  assert.equal(
    (await f.history.history("alice", undefined)).matches[0]!.result.winnerId,
    f.ids[0],
  );
});

test("a rider who quit mid-match is not waited for, and an address is limited as well as a seat", async () => {
  const f = await room(2),
    result = resultOf(f.ids);
  result.finishers = [f.ids[0]!];
  assert.deepEqual(await f.report(f.tokens[0]!, { result }, "alice"), {
    status: "confirmed",
    attestations: 1,
    needed: 1,
    linked: true,
  });
  assert.deepEqual(
    await f.report(f.tokens[1]!, { result }, "bob"),
    { status: "confirmed", attestations: 2, needed: 1, linked: true },
    "a leaver who came back may still report",
  );
  // Room tokens are free to mint, so one address cannot report without limit by rotating them.
  for (let index = 0; index < 240; index++)
    await f.rooms.database.allowance(
      digest("results-address:one-address"),
      f.now(),
      240,
    );
  await assert.rejects(f.history.admit(f.code, f.tokens[0]!, "one-address"), {
    status: 429,
  });
  assert.ok(await f.history.admit(f.code, f.tokens[0]!, "another-address"));
});

test("pending and guest-only matches expire; a match an account owns does not", async () => {
  const f = await room(2),
    result = resultOf(f.ids),
    id = matchRecordId(
      (await f.rooms.get(f.code)).incarnation,
      parseMatchResult(result)!,
    );
  const stored = () =>
    f.matches.transactMatch(id, (current) => ({ result: current }));
  await f.report(f.tokens[0]!, { result }, undefined);
  assert.equal((await stored())!.expiresAt, f.now() + PENDING_TTL_MS);
  await f.report(f.tokens[1]!, { result }, undefined);
  assert.equal((await stored())!.expiresAt, f.now() + GUEST_MATCH_TTL_MS);
  await f.report(f.tokens[1]!, { result }, "bob");
  assert.equal((await stored())!.expiresAt, undefined);
  assert.equal((await stored())!.status, "confirmed");
});

test("a solo rider with bots confirms alone, history pages newest first, and reporting is rate limited", async () => {
  const f = await room(1);
  for (let index = 0; index < 25; index++) {
    f.advance(1000);
    assert.equal(
      (
        await f.report(
          f.tokens[0]!,
          { result: resultOf([f.ids[0]!, "bot:1"], `match-${index}`) },
          "alice",
        )
      ).status,
      "confirmed",
    );
  }
  const first = await f.history.history("alice", undefined);
  assert.equal(first.matches.length, 20);
  assert.equal(first.matches[0]!.result.matchId, "match-24");
  const second = await f.history.history(
    "alice",
    first.matches.at(-1)!.endedAt,
  );
  assert.deepEqual(
    second.matches.map((entry) => entry.result.matchId),
    ["match-4", "match-3", "match-2", "match-1", "match-0"],
  );
  assert.equal(second.profile!.totals.matches, 25);
  for (let index = 25; index < 29; index++)
    await f.report(
      f.tokens[0]!,
      { result: resultOf([f.ids[0]!, "bot:1"], `match-${index}`) },
      "alice",
    );
  assert.equal(
    (
      await f.report(
        f.tokens[0]!,
        { result: resultOf([f.ids[0]!, "bot:1"], "match-29") },
        "alice",
      )
    ).linked,
    true,
  );
  // Past thirty links an hour a report still counts, as a guest's: the record it creates is one that expires.
  assert.deepEqual(
    await f.report(
      f.tokens[0]!,
      { result: resultOf([f.ids[0]!, "bot:1"], "match-30") },
      "alice",
    ),
    { status: "confirmed", attestations: 1, needed: 1, linked: false },
  );
  for (let index = 31; index < 40; index++)
    await f.report(
      f.tokens[0]!,
      { result: resultOf([f.ids[0]!, "bot:1"], `match-${index}`) },
      "alice",
    );
  await assert.rejects(
    f.report(
      f.tokens[0]!,
      { result: resultOf([f.ids[0]!, "bot:1"], "one-too-many") },
      "alice",
    ),
    { status: 429 },
  );
  f.advance(31_000);
  await assert.rejects(
    f.report(
      f.tokens[0]!,
      { result: resultOf([f.ids[0]!, "bot:1"], "later") },
      "alice",
    ),
    { status: 403 },
    "a lapsed connection is no longer in the room",
  );
});

test("an account chooses its username; it is not unique, and totals survive a rename", async () => {
  const f = await room(1);
  assert.equal(
    await f.history.profile("alice"),
    undefined,
    "no account document until something is stored",
  );
  assert.deepEqual(await f.history.rename("alice", { username: "Ace" }), {
    username: "Ace",
  });
  assert.equal((await f.history.profile("alice"))!.username, "Ace");
  assert.equal((await f.history.profile("alice"))!.totals.matches, 0);
  await f.report(
    f.tokens[0]!,
    { result: resultOf([f.ids[0]!, "bot:1"]) },
    "alice",
  );
  await f.history.rename("alice", { username: "Ace 2" });
  const renamed = (await f.history.history("alice", undefined)).profile!;
  assert.equal(renamed.username, "Ace 2");
  assert.equal(renamed.totals.matches, 1, "a rename keeps the totals");
  assert.equal(
    renamed.name,
    "Rider 1",
    "the name a match was played under is its own record",
  );
  assert.deepEqual(
    await f.history.rename("bob", { username: "Ace 2" }),
    { username: "Ace 2" },
    "friends may share a name; the account is the identity",
  );
  for (const body of [
    {},
    { username: "" },
    { username: " pad " },
    { username: "x".repeat(19) },
    { username: "ok", uid: "bob" },
    { username: 7 },
    null,
    "Ace",
  ])
    await assert.rejects(
      f.history.rename("alice", body),
      { status: 400 },
      JSON.stringify(body),
    );
  for (let index = 0; index < 18; index++)
    await f.history.rename("alice", { username: `Ace ${index}` });
  await assert.rejects(f.history.rename("alice", { username: "Again" }), {
    status: 429,
  });
});

// ---- results: over HTTP ----

test("the HTTP surface: a report needs a seat, history needs a sign-in, and a bad sign-in is only a guest", async () => {
  const service = createDevRoomService({
    identity: async (value) =>
      value.startsWith("id:") ? value.slice(3) : undefined,
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`,
    sockets: WebSocket[] = [];
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      headers: { origin, ...init.headers },
    });
  const join = (code: string, value: string) =>
    new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/api/rooms/${code}/ws?token=${value}`,
        { origin },
      );
      sockets.push(socket);
      socket.once("message", () => resolve());
      socket.once("error", reject);
    });
  try {
    const created = (await (
        await call("/api/rooms", { method: "POST" })
      ).json()) as { code: string; token: string },
      guest = token();
    await join(created.code, created.token);
    await join(created.code, guest);
    const result = resultOf([peerId(created.token), peerId(guest)]);
    const report = (
      value: string,
      payload: unknown,
      identity?: string,
      body: unknown = typeof payload === "string"
        ? payload
        : { result: payload, avatarId: AVATARS[0]!.id },
    ) =>
      call(`/api/rooms/${created.code}/results`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: {
          authorization: `Bearer ${value}`,
          ...(identity ? { "x-fuse-identity": identity } : {}),
        },
      });

    const preflight = await call(`/api/rooms/${created.code}/results`, {
      method: "OPTIONS",
    });
    assert.match(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /X-Fuse-Identity/,
    );
    assert.equal((await report(token(), result)).status, 403);
    assert.equal(
      (await report(token(), "x".repeat(257_000))).status,
      403,
      "a stranger is refused before their body is read",
    );
    assert.equal((await report(created.token, "{not json")).status, 400);
    assert.equal(
      (await report(created.token, "x".repeat(257_000))).status,
      413,
    );
    assert.equal(
      (await report(created.token, { ...result, extra: 1 })).status,
      400,
    );
    assert.equal(
      (
        await report(created.token, result, undefined, {
          result,
          avatarId: "nope",
        })
      ).status,
      400,
      "an avatar the game does not have",
    );
    assert.equal(
      (await report(created.token, result, "id:alice", { result, uid: "bob" }))
        .status,
      400,
      "an account can never be named in the body",
    );
    assert.deepEqual(
      await (await report(created.token, result, "id:alice")).json(),
      { status: "pending", attestations: 1, needed: 2, linked: true },
    );
    assert.deepEqual(
      await (await report(guest, result, "forged-token")).json(),
      { status: "confirmed", attestations: 2, needed: 2, linked: false },
      "an identity that does not verify still reports as a guest",
    );

    const me = (init: RequestInit = {}, identity = "id:alice") =>
      call("/api/me", {
        ...init,
        headers: { authorization: `Bearer ${identity}`, ...init.headers },
      });
    assert.equal((await call("/api/me")).status, 401);
    assert.equal(
      (
        await me(
          { method: "PUT", body: JSON.stringify({ username: "Mallory" }) },
          "forged",
        )
      ).status,
      401,
    );
    assert.deepEqual(await (await me({}, "id:nobody")).json(), {
      profile: null,
    });
    assert.equal(
      (await me({ method: "PUT", body: JSON.stringify({ username: " bad " }) }))
        .status,
      400,
    );
    assert.deepEqual(
      await (
        await me({ method: "PUT", body: JSON.stringify({ username: "Ace" }) })
      ).json(),
      { username: "Ace" },
    );
    assert.equal(
      ((await (await me()).json()) as { profile: { username: string } }).profile
        .username,
      "Ace",
    );
    assert.match(
      (await call("/api/me", { method: "OPTIONS" })).headers.get(
        "access-control-allow-methods",
      ) ?? "",
      /PUT/,
    );
    assert.equal((await call("/api/me/matches")).status, 401);
    assert.equal(
      (
        await call("/api/me/matches", {
          headers: { authorization: "Bearer forged" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/api/me/matches?before=abc", {
          headers: { authorization: "Bearer id:alice" },
        })
      ).status,
      400,
    );
    const mine = (await (
      await call("/api/me/matches", {
        headers: { authorization: "Bearer id:alice" },
      })
    ).json()) as {
      profile: { totals: { wins: number } };
      matches: { you: string; avatars: Record<string, string> }[];
    };
    assert.equal(mine.matches.length, 1);
    assert.equal(mine.matches[0]!.you, peerId(created.token));
    assert.deepEqual(mine.matches[0]!.avatars, {
      [peerId(created.token)]: AVATARS[0]!.id,
      [peerId(guest)]: AVATARS[0]!.id,
    });
    assert.equal(mine.profile.totals.wins, 1);
    assert.deepEqual(
      await (await call("/api/leaderboard")).json(),
      { players: [] },
      "one signed-in human and a guest do not rate",
    );
    assert.equal((await report(guest, result, "id:bob")).status, 200);
    const roundResult = {
      ...result,
      round: 1,
      length: 1,
      players: result.players.map((p) => ({
        ...p,
        roundsPlayed: 1,
        roundWins: 0,
        roundsDrawn: 0,
      })),
    };
    const roundReport = (seat: string, identity: string) =>
      call(`/api/rooms/${created.code}/round-results`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${seat}`,
          "x-fuse-identity": identity,
        },
        body: JSON.stringify({ result: roundResult }),
      });
    assert.equal(
      (await report(created.token, roundResult, "id:alice")).status,
      400,
      "rounds cannot use the career endpoint",
    );
    assert.equal((await roundReport(created.token, "id:alice")).status, 200);
    assert.equal(
      (await roundReport(guest, "forged-token")).status,
      503,
      "a failed identity does not attest as a guest",
    );
    assert.equal((await roundReport(guest, "id:bob")).status, 200);

    const board = (await (
      await call("/api/leaderboard", {
        headers: { authorization: "Bearer id:alice" },
      })
    ).json()) as {
      players: { rank: number; elo: number; you?: boolean; name: string }[];
    };
    assert.equal(board.players.length, 2);
    assert.deepEqual(
      board.players.map((p) => [p.rank, p.elo]),
      [
        [1, 1016],
        [2, 984],
      ],
    );
    assert.equal(board.players[0]!.you, true);
    assert.equal(board.players[0]!.name, "Ace");
    assert.equal(JSON.stringify(board).includes("uidByPlayer"), false);
    assert.equal(
      (
        await fetch(`${origin}/api/leaderboard`, {
          headers: { origin: "https://evil.example" },
        })
      ).status,
      403,
    );

    assert.equal(
      (
        (await (
          await call("/api/me/matches?before=1", {
            headers: { authorization: "Bearer id:alice" },
          })
        ).json()) as { matches: unknown[] }
      ).matches.length,
      0,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/me/matches`, {
          headers: {
            origin: "https://evil.example",
            authorization: "Bearer id:alice",
          },
        })
      ).status,
      403,
      "a foreign origin is refused before any sign-in is looked at",
    );
  } finally {
    for (const socket of sockets) socket.terminate();
    await service.close();
  }
});
