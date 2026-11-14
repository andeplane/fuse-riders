import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";

import { createWrapper } from "../__mocks__/renderWithProviders";

import type { FrameLike } from "./roomObserver";
import {
  readRoomInFrame,
  useRecordRoom,
  useRecordRoomFromFrame,
} from "./roomObserver";

const NOW = Date.UTC(1998, 5, 25, 12, 34);

function frameAt(search: string): FrameLike {
  return { contentWindow: { location: { search } } };
}

describe(readRoomInFrame.name, () => {
  it("reads the room the page inside a same-origin frame is in", () => {
    expect(readRoomInFrame(frameAt("?room=ab42&mute"))).toBe("AB42");
    expect(readRoomInFrame(frameAt(""))).toBeNull();
  });

  it("is null without a frame, before the page loads, and for a page that hides its address", () => {
    expect(readRoomInFrame(null)).toBeNull();
    expect(readRoomInFrame(undefined)).toBeNull();
    expect(readRoomInFrame({ contentWindow: null })).toBeNull();
    const crossOrigin: FrameLike = {
      get contentWindow(): FrameLike["contentWindow"] {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    };
    expect(readRoomInFrame(crossOrigin)).toBeNull();
  });
});

describe(useRecordRoomFromFrame.name, () => {
  it("records the room once it appears in the frame's address and again only when it changes", () => {
    const context = createWrapper();
    let search = "";
    const frame: FrameLike = {
      get contentWindow() {
        return { location: { search } };
      },
    };
    const { unmount } = renderHook(
      () => {
        const ref = useRef<FrameLike | null>(frame);
        useRecordRoomFromFrame(ref, "fuseball");
      },
      { wrapper: context.Wrapper },
    );
    expect(context.recentRooms.list()).toEqual([]);
    search = "?room=AB42";
    act(() => context.networkDeps.tick());
    act(() => context.networkDeps.tick());
    expect(context.recentRooms.list()).toEqual([
      { gameId: "fuseball", code: "AB42", lastSeen: NOW },
    ]);
    search = "?room=CD07";
    act(() => context.networkDeps.tick());
    expect(context.recentRooms.list().map((room) => room.code)).toEqual([
      "CD07",
      "AB42",
    ]);
    unmount();
    search = "?room=EF99";
    act(() => context.networkDeps.tick());
    expect(context.recentRooms.list()).toHaveLength(2);
  });

  it("records a room that is there from the start without waiting for a tick", () => {
    const context = createWrapper();
    renderHook(
      () => {
        const ref = useRef<FrameLike | null>(frameAt("?room=AB42"));
        useRecordRoomFromFrame(ref, "fuse-riders");
      },
      { wrapper: context.Wrapper },
    );
    expect(context.recentRooms.list()).toEqual([
      { gameId: "fuse-riders", code: "AB42", lastSeen: NOW },
    ]);
  });
});

describe(useRecordRoom.name, () => {
  it("records the room the OS opened itself", () => {
    const context = createWrapper();
    renderHook(() => useRecordRoom("fuseball", "AB42"), {
      wrapper: context.Wrapper,
    });
    expect(context.recentRooms.list()).toEqual([
      { gameId: "fuseball", code: "AB42", lastSeen: NOW },
    ]);
  });
});
