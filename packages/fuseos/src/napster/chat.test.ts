import { scriptedRandom, seededRandom } from "../__mocks__/seededRandom";

import type { ChatRoom } from "./chat";
import {
  appendLine,
  comingAndGoing,
  introduce,
  joinRoom,
  MAX_CHAT_LINES,
  replyTo,
  roomTopic,
  strangerLine,
  userFacts,
} from "./chat";
import { FAKE_USERS } from "./napsterCatalog";

function counter() {
  let id = 0;
  return () => (id += 1);
}

const ME = "fuse_rider98";

describe(joinRoom.name, () => {
  it("joins with the regulars already there and announces the topic", () => {
    const room = joinRoom("#metal", ME, seededRandom(1), counter());
    expect(room.users[0]).toBe(ME);
    expect(room.users.length).toBeGreaterThanOrEqual(8);
    expect(room.lines).toEqual([
      { id: 1, kind: "system", text: "Joined channel #metal" },
      { id: 2, kind: "system", text: `Topic: ${roomTopic("#metal")}` },
    ]);
    expect(roomTopic("#nowhere")).toBe("");
  });
});

describe(strangerLine.name, () => {
  it("fills in a user and a song, never speaking for you", () => {
    const random = seededRandom(3);
    const room = joinRoom("#napster", ME, random, counter());
    const lines = Array.from({ length: 80 }, (_, index) =>
      strangerLine(room, ME, random, index),
    );
    expect(
      lines.every((line) => line.kind === "message" && line.user !== ME),
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.kind === "message" && line.text.includes(" - "),
      ),
    ).toBe(true);
    expect(lines.every((line) => !line.text.includes("{"))).toBe(true);
  });

  it("still finds someone to talk in an empty room", () => {
    const empty: ChatRoom = { name: "#x", topic: "", users: [ME], lines: [] };
    const line = strangerLine(empty, ME, scriptedRandom([0]), 1);
    expect(line).toMatchObject({ kind: "message", user: FAKE_USERS[0] });
  });
});

describe(comingAndGoing.name, () => {
  const room: ChatRoom = {
    name: "#napster",
    topic: "",
    users: [ME, ...FAKE_USERS.slice(0, 8)],
    lines: [],
  };

  it("announces a leaver in the client's words", () => {
    const after = comingAndGoing(room, ME, scriptedRandom([0, 0]), 7);
    const user = FAKE_USERS[0] ?? "";
    expect(after.users).not.toContain(user);
    expect(after.lines.at(-1)).toEqual({
      id: 7,
      kind: "system",
      text: `${introduce(user)} has left.`,
    });
  });

  it("announces a newcomer, unless everyone is already here", () => {
    const after = comingAndGoing(room, ME, scriptedRandom([0.9, 0]), 8);
    expect(after.users).toHaveLength(room.users.length + 1);
    expect(after.lines.at(-1)?.text).toMatch(
      /\[sharing \d+ songs\] has joined\.$/,
    );
    const full = { ...room, users: [ME, ...FAKE_USERS] };
    expect(comingAndGoing(full, ME, scriptedRandom([0.9]), 9)).toBe(full);
  });
});

describe(appendLine.name, () => {
  it("keeps only the most recent lines", () => {
    let room: ChatRoom = { name: "#x", topic: "", users: [], lines: [] };
    for (let id = 0; id < MAX_CHAT_LINES + 5; id += 1)
      room = appendLine(room, { id, kind: "system", text: String(id) });
    expect(room.lines).toHaveLength(MAX_CHAT_LINES);
    expect(room.lines[0]?.id).toBe(5);
  });
});

describe(replyTo.name, () => {
  it("usually ignores you, sometimes answers by name", () => {
    const room: ChatRoom = {
      name: "#x",
      topic: "",
      users: [ME, "dialup_dan"],
      lines: [],
    };
    expect(replyTo(room, ME, scriptedRandom([0.1]), 1)).toBeUndefined();
    expect(replyTo(room, ME, scriptedRandom([0.9, 0, 0]), 2)).toEqual({
      id: 2,
      kind: "message",
      user: "dialup_dan",
      own: false,
      text: `${ME}: lol`,
    });
    expect(
      replyTo({ ...room, users: [ME] }, ME, scriptedRandom([0.9]), 3),
    ).toBeUndefined();
  });
});

describe(userFacts.name, () => {
  it("gives the same line and song count for the same name", () => {
    expect(userFacts("dialup_dan")).toEqual(userFacts("dialup_dan"));
    expect(introduce("dialup_dan")).toMatch(
      /^dialup_dan \([^)]+\) \[sharing \d+ songs\]$/,
    );
  });
});
