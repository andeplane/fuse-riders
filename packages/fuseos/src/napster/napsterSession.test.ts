import { createTestNapsterDeps } from "../__mocks__/napsterDeps";
import { FUSE_TRACKS } from "../winamp/fuseTracks";

import type { SearchQuery, SearchResult } from "./fakeNetwork";
import { METALLICA_DECOY, OWN_USERNAME } from "./napsterCatalog";
import type { NapsterEvent } from "./napsterSession";
import {
  baseName,
  CONNECT_MS,
  createNapsterSession,
  initialNapsterState,
  MUSIC_FOLDER,
  SEARCH_MS,
} from "./napsterSession";

const DECOY: SearchResult = {
  id: "r1",
  filename: METALLICA_DECOY.filename,
  filesize: 2_000_000,
  bitrate: 64,
  frequency: 44100,
  length: 250,
  user: "mp3_overlord",
  lineSpeed: "T1",
  ping: 30,
  source: { kind: "decoy" },
};

const FUSE: SearchResult = {
  ...DECOY,
  id: "r2",
  filename: "C:\\My Music\\Eminem - Stan.mp3",
  source: { kind: "fuse", trackId: "snaky-blue" },
};

function query(artist: string): SearchQuery {
  return { artist, title: "", maxResults: 100, filters: {} };
}

function connected(
  overrides: Parameters<typeof createTestNapsterDeps>[0] = {},
) {
  const deps = createTestNapsterDeps(overrides);
  const session = createNapsterSession(deps);
  const events: NapsterEvent[] = [];
  session.onEvent((event) => events.push(event));
  session.connect();
  deps.clock.advance(CONNECT_MS);
  return { deps, session, events };
}

describe(initialNapsterState.name, () => {
  it("shares the Fuse soundtrack from the Napster music folder", () => {
    const state = initialNapsterState();
    expect(state.username).toBe(OWN_USERNAME);
    expect(state.connection).toBe("connecting");
    expect(state.library).toHaveLength(FUSE_TRACKS.length);
    expect(state.library.every((file) => file.shared)).toBe(true);
    expect(state.library[0]?.filename).toBe(
      `${MUSIC_FOLDER}Fuse Radio - Pixel Sax Parade.mp3`,
    );
    expect(baseName(state.library[0]?.filename ?? "")).toBe(
      "Fuse Radio - Pixel Sax Parade.mp3",
    );
  });
});

describe(createNapsterSession.name, () => {
  it("connects after a moment with the chime, the network totals and #napster joined", () => {
    const deps = createTestNapsterDeps();
    const session = createNapsterSession(deps);
    const changes = vi.fn();
    session.subscribe(changes);
    session.connect();
    expect(session.getState().connection).toBe("connecting");
    deps.clock.advance(CONNECT_MS - 1);
    expect(session.getState().connection).toBe("connecting");
    deps.clock.advance(1);
    const state = session.getState();
    expect(state.connection).toBe("online");
    expect(state.stats?.libraries).toBeGreaterThan(1000);
    expect(state.activeRoom).toBe("#napster");
    expect(state.hotList.map((entry) => entry.online)).toEqual([true, false]);
    expect(deps.chimes()).toBe(1);
    expect(changes).toHaveBeenCalled();
    session.connect();
    expect(deps.chimes()).toBe(1);
  });

  it("searches only when online and only for something, then lands the results", () => {
    const deps = createTestNapsterDeps();
    const session = createNapsterSession(deps);
    session.search(query("blur"));
    session.connect();
    expect(session.getState().search.status).toBe("idle");
    deps.clock.advance(CONNECT_MS);
    session.search(query("   "));
    expect(session.getState().search.status).toBe("idle");
    session.search({ ...query("Blur"), title: "Song 2" });
    expect(session.getState().search).toEqual({
      status: "searching",
      title: "Blur - Song 2",
      results: [],
    });
    deps.clock.advance(SEARCH_MS + 900);
    const search = session.getState().search;
    expect(search.status).toBe("done");
    expect(search.results.length).toBeGreaterThan(0);
    session.clearResults();
    expect(session.getState().search).toEqual({
      status: "idle",
      title: "",
      results: [],
    });
  });

  it("delivers a finished download into the library and says so", () => {
    const { deps, session, events } = connected();
    session.download([DECOY, DECOY]);
    expect(session.getState().downloads).toHaveLength(1);
    deps.clock.advance(120_000);
    const state = session.getState();
    expect(state.downloads[0]?.phase).toBe("complete");
    const file = state.library.at(-1);
    expect(file).toMatchObject({
      id: "dl:d1",
      filename: `${MUSIC_FOLDER}${METALLICA_DECOY.filename}`,
      delivery: { kind: "decoy" },
      shared: false,
      bitrate: 64,
      length: 250,
    });
    expect(events).toEqual([
      { kind: "connected" },
      { kind: "downloaded", file },
    ]);
    session.clearFinished();
    expect(session.getState().downloads).toEqual([]);
  });

  it("downloads the same file again once the first try has stopped", () => {
    const { session } = connected();
    session.download([FUSE]);
    session.cancel("d1");
    expect(session.getState().downloads[0]?.phase).toBe("cancelled");
    session.download([FUSE]);
    expect(session.getState().downloads).toHaveLength(2);
    session.download([]);
    expect(session.getState().downloads).toHaveLength(2);
  });

  it("drops everything moving when you disconnect, and connects again", () => {
    const { deps, session } = connected();
    session.download([FUSE]);
    session.search(query("blur"));
    session.disconnect();
    const state = session.getState();
    expect(state.connection).toBe("offline");
    expect(state.downloads[0]?.phase).toBe("error");
    expect(state.search.status).toBe("done");
    expect(state.rooms).toEqual([]);
    expect(state.stats).toBeUndefined();
    expect(deps.clock.pending()).toBe(0);
    session.disconnect();
    session.download([DECOY]);
    session.say("hello?");
    session.browse("dialup_dan");
    expect(session.getState().browsing).toEqual({
      user: "dialup_dan",
      results: [],
    });
    session.connect();
    deps.clock.advance(CONNECT_MS);
    expect(session.getState().connection).toBe("online");
  });

  it("goes dark by court order when the odds say so", () => {
    const { session, deps, events } = connected({ shutdownChance: 1 });
    deps.clock.advance(1000);
    expect(session.getState().connection).toBe("shutdown");
    expect(events.at(-1)).toEqual({ kind: "shutdown" });
    session.disconnect();
    expect(session.getState().connection).toBe("shutdown");
  });

  it("keeps the room talking, friends dialing in and strangers grabbing your files", () => {
    // 0.03: no court order, an upload starts, the room speaks and a Hot List friend toggles.
    const { session, deps } = connected({ random: () => 0.03 });
    const before = session.getState().rooms[0]?.lines.length ?? 0;
    deps.clock.advance(1000);
    const state = session.getState();
    expect(state.rooms[0]?.lines.length).toBeGreaterThan(before);
    expect(state.uploads).toHaveLength(1);
    expect(state.hotList[0]?.online).toBe(false);
  });

  it("brings strangers in and out of the room on a middling roll", () => {
    const { session, deps } = connected({ random: () => 0.33 });
    const before = session.getState().rooms[0]?.lines.length ?? 0;
    deps.clock.advance(1000);
    expect(session.getState().rooms[0]?.lines.at(-1)?.text).toMatch(
      /has (joined|left)\.$/,
    );
    expect(session.getState().rooms[0]?.lines.length).toBe(before + 1);
  });

  it("keeps a Hot List: add, browse, remove", () => {
    const { session } = connected();
    session.addToHotList("dsl_dave");
    session.addToHotList("dsl_dave");
    expect(session.getState().hotList.map((entry) => entry.user)).toEqual([
      "dialup_dan",
      "bitrate_betty",
      "dsl_dave",
    ]);
    session.browse("dialup_dan");
    expect(session.getState().browsing?.results.length).toBeGreaterThan(0);
    session.browse("bitrate_betty");
    expect(session.getState().browsing?.results).toEqual([]);
    session.removeFromHotList("dsl_dave");
    expect(session.getState().browsing?.user).toBe("bitrate_betty");
    session.removeFromHotList("bitrate_betty");
    expect(session.getState().browsing).toBeUndefined();
  });

  it("joins, switches, talks in and leaves chat rooms", () => {
    const { session, deps } = connected({ random: () => 0.9 });
    session.joinRoom("#metal");
    expect(session.getState().activeRoom).toBe("#metal");
    session.joinRoom("#napster");
    expect(session.getState().rooms).toHaveLength(2);
    expect(session.getState().activeRoom).toBe("#napster");
    session.say("   ");
    session.say("anyone got the fuse soundtrack?");
    const room = () =>
      session.getState().rooms.find((item) => item.name === "#napster");
    expect(room()?.lines.at(-1)).toMatchObject({
      kind: "message",
      own: true,
      user: OWN_USERNAME,
      text: "anyone got the fuse soundtrack?",
    });
    deps.clock.advance(4000);
    expect(room()?.lines.at(-1)?.text).toMatch(new RegExp(`^${OWN_USERNAME}:`));
    session.setActiveRoom("#metal");
    session.leaveRoom("#napster");
    expect(session.getState().activeRoom).toBe("#metal");
    session.leaveRoom("#metal");
    expect(session.getState().activeRoom).toBeUndefined();
    session.say("anyone?");
  });

  it("stops every timer when disposed", () => {
    const { session, deps } = connected();
    session.say("bye");
    session.setTab("chat");
    expect(session.getState().tab).toBe("chat");
    session.dispose();
    expect(deps.clock.pending()).toBe(0);
    session.connect();
    expect(session.getState().connection).toBe("online");
  });
});
