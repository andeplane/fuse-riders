import { DEMO_BUDDIES, DEMO_ME } from "./demoPresenceService";
import { presenceEvents } from "./presenceEvents";
import type { Buddy, PresenceSnapshot } from "./presenceService";
import { EMPTY_SNAPSHOT } from "./presenceService";

const loaded = (
  buddies: readonly Buddy[],
  patch: Partial<PresenceSnapshot> = {},
): PresenceSnapshot => ({
  ...EMPTY_SNAPSHOT,
  account: { kind: "signed-in", name: "Me" },
  me: DEMO_ME,
  loaded: true,
  buddies: [...buddies],
  ...patch,
});
const rocket = DEMO_BUDDIES[4]!;

describe(presenceEvents.name, () => {
  it("announces a buddy signing in, starting a game, an invite and a request", () => {
    const before = loaded(DEMO_BUDDIES);
    const after = loaded(
      DEMO_BUDDIES.map((b) =>
        b.publicId === rocket.publicId
          ? {
              ...b,
              status: "playing" as const,
              room: { code: "VB77", gameId: "fuse-volley" },
            }
          : b,
      ),
      {
        invites: [
          {
            id: "i1",
            from: rocket,
            code: "VB77",
            gameId: "fuse-volley",
            at: 1,
          },
        ],
        incoming: [{ publicId: "p".repeat(20), name: "PigChampion" }],
      },
    );
    expect(presenceEvents(before, after).map((e) => e.type)).toEqual([
      "signed-in",
      "playing",
      "invite",
      "request",
    ]);
  });

  it("says nothing on a first load, across a mode switch, or while signed out", () => {
    const after = loaded(DEMO_BUDDIES);
    expect(presenceEvents(EMPTY_SNAPSHOT, after)).toEqual([]);
    expect(
      presenceEvents(loaded([{ ...rocket }]), { ...after, mode: "demo" }),
    ).toEqual([]);
    expect(
      presenceEvents(loaded([{ ...rocket }]), {
        ...after,
        account: { kind: "signed-out" },
      }),
    ).toEqual([]);
  });

  it("does not repeat an unchanged state, a seen invite or a known request", () => {
    const snapshot = loaded(DEMO_BUDDIES, {
      invites: [
        { id: "i1", from: rocket, code: "VB77", gameId: "fuse-volley", at: 1 },
      ],
      incoming: [{ publicId: "p".repeat(20), name: "PigChampion" }],
    });
    expect(presenceEvents(snapshot, { ...snapshot })).toEqual([]);
  });

  it("announces a game again when the buddy moves to another room, and a refreshed invite", () => {
    const playing = DEMO_BUDDIES[0]!;
    const moved = loaded(
      DEMO_BUDDIES.map((b) =>
        b === playing
          ? { ...b, room: { code: "ZZ99", gameId: "fuseball" } }
          : b,
      ),
      {
        invites: [
          {
            id: "i1",
            from: rocket,
            code: "VB77",
            gameId: "fuse-volley",
            at: 2,
          },
        ],
      },
    );
    const before = loaded(DEMO_BUDDIES, {
      invites: [
        { id: "i1", from: rocket, code: "VB77", gameId: "fuse-volley", at: 1 },
      ],
    });
    expect(presenceEvents(before, moved).map((e) => e.type)).toEqual([
      "playing",
      "invite",
    ]);
  });

  it("ignores a buddy that was not in the previous list (a new friend is not news)", () => {
    const before = loaded([]);
    expect(presenceEvents(before, loaded(DEMO_BUDDIES))).toEqual([]);
  });

  it("treats going from offline to away as signing in", () => {
    const before = loaded([{ ...rocket, status: "offline" }]);
    const after = loaded([{ ...rocket, status: "away" }]);
    expect(presenceEvents(before, after)).toEqual([
      { type: "signed-in", buddy: after.buddies[0] },
    ]);
  });
});
