import test from "node:test";
import assert from "node:assert/strict";
import { createFriendsClient } from "../src/friends-client.js";

test("an old account's in-flight sync cannot restore its friend list after switching accounts", async () => {
  const pending: (() => void)[] = [];
  let resolve: ((response: Response) => void) | undefined;
  const client = createFriendsClient({
    token: async () => "token",
    apiUrl: (path) => path,
    identity: () => ({}),
    clock: {
      now: () => 100_000,
      schedule(run) {
        pending.push(run);
        return () => {};
      },
    },
    fetch: async () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  });
  client.setSignedIn(true);
  pending.shift()!();
  await new Promise((done) => setImmediate(done));
  client.setSignedIn(false);
  client.setSignedIn(true);
  resolve!(
    Response.json({
      me: { publicId: "old-account", name: "Old" },
      friends: [],
      incoming: [],
      outgoing: [],
      invites: [],
      roomPlayers: [],
    }),
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(client.state().view, undefined);
  assert.equal(
    pending.length,
    1,
    "old poll does not schedule another timer for the new account",
  );
  client.dispose();
});
