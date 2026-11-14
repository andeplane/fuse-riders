/**
 * The Chat tab's rooms: who is in them and what they say. Strangers' lines come from the catalogue's chatter with
 * a random user and song filled in; nobody reads what you type except the occasional stranger who answers your
 * name. Pure functions over an explicit random source.
 */
import type { Random } from "./fakeNetwork";
import { pick, shuffle } from "./fakeNetwork";
import { CATALOG, CHAT_LINES, CHAT_ROOMS, FAKE_USERS } from "./napsterCatalog";

export type ChatLine =
  | { id: number; kind: "message"; user: string; text: string; own: boolean }
  | { id: number; kind: "system"; text: string };

export type ChatRoom = {
  name: string;
  topic: string;
  users: string[];
  lines: ChatLine[];
};

/** Chat history kept per room; older lines scroll away for good. */
export const MAX_CHAT_LINES = 120;

/** A stranger's line speed and song count, the same every time for the same name. */
export function userFacts(user: string): { speed: string; songs: number } {
  let hash = 7;
  for (const char of user) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const speeds = [
    "56K",
    "Cable",
    "DSL",
    "T1",
    "33.6",
    "ISDN-128",
    "Cable",
    "56K",
  ];
  return {
    speed: speeds[hash % speeds.length] ?? "56K",
    songs: 5 + (hash % 1600),
  };
}

/** "Spacepilot (Cable) [sharing 263 songs]", how the room introduces someone. */
export function introduce(user: string): string {
  const facts = userFacts(user);
  return `${user} (${facts.speed}) [sharing ${facts.songs} songs]`;
}

export function roomTopic(name: string): string {
  return CHAT_ROOMS.find((room) => room.name === name)?.topic ?? "";
}

/** Joining a room: a handful of regulars already there, the topic and the join line. */
export function joinRoom(
  name: string,
  own: string,
  random: Random,
  nextId: () => number,
): ChatRoom {
  const users = [
    own,
    ...shuffle(FAKE_USERS, random).slice(0, 7 + Math.floor(random() * 9)),
  ];
  return {
    name,
    topic: roomTopic(name),
    users,
    lines: [
      { id: nextId(), kind: "system", text: `Joined channel ${name}` },
      { id: nextId(), kind: "system", text: `Topic: ${roomTopic(name)}` },
    ],
  };
}

function songName(random: Random): string {
  const song = pick(CATALOG, random);
  return `${song.artist} - ${song.title}`;
}

/** One stranger's line, `{user}` and `{song}` filled in. */
export function strangerLine(
  room: ChatRoom,
  own: string,
  random: Random,
  id: number,
): ChatLine {
  const others = room.users.filter((user) => user !== own);
  const speaker =
    others.length > 0 ? pick(others, random) : pick(FAKE_USERS, random);
  const template = pick(CHAT_LINES, random);
  const mention =
    others.filter((user) => user !== speaker)[0] ?? pick(FAKE_USERS, random);
  return {
    id,
    kind: "message",
    user: speaker,
    own: false,
    text: template
      .replace("{user}", mention)
      .replace("{song}", songName(random)),
  };
}

/** Someone wandering in or out, as the room announces it. */
export function comingAndGoing(
  room: ChatRoom,
  own: string,
  random: Random,
  id: number,
): ChatRoom {
  const leaving = room.users.length > 6 && random() < 0.5;
  if (leaving) {
    const candidates = room.users.filter((user) => user !== own);
    const user = pick(candidates, random);
    return appendLine(
      { ...room, users: room.users.filter((name) => name !== user) },
      { id, kind: "system", text: `${introduce(user)} has left.` },
    );
  }
  const fresh = FAKE_USERS.filter((user) => !room.users.includes(user));
  if (fresh.length === 0) return room;
  const user = pick(fresh, random);
  return appendLine(
    { ...room, users: [...room.users, user] },
    { id, kind: "system", text: `${introduce(user)} has joined.` },
  );
}

export function appendLine(room: ChatRoom, line: ChatLine): ChatRoom {
  return { ...room, lines: [...room.lines, line].slice(-MAX_CHAT_LINES) };
}

/** What someone says back when you speak: usually nothing, sometimes a reply that names you. */
export function replyTo(
  room: ChatRoom,
  own: string,
  random: Random,
  id: number,
): ChatLine | undefined {
  if (random() < 0.45) return undefined;
  const others = room.users.filter((user) => user !== own);
  if (others.length === 0) return undefined;
  const replies = [
    `${own}: lol`,
    `${own}: what r u sharing`,
    `${own}: a/s/l?`,
    `${own}: ur on 56k arent u`,
    `${own}: k`,
    `${own}: can i get ur fuse soundtrack stuff, its sick`,
    `${own}: add me to ur hot list`,
  ];
  return {
    id,
    kind: "message",
    user: pick(others, random),
    own: false,
    text: pick(replies, random),
  };
}
