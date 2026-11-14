import type { NotepadState } from "./notepadState";
import {
  EMPTY_NOTEPAD_STATE,
  isDirty,
  isModified,
  notepadReducer,
} from "./notepadState";

const PATH = "packages/fuseos/src/App.tsx";

function loaded(saved: string | undefined = undefined): NotepadState {
  return notepadReducer(
    notepadReducer(EMPTY_NOTEPAD_STATE, { type: "load", path: PATH }),
    { type: "loaded", path: PATH, original: "one", saved, fromFallback: false },
  );
}

describe(notepadReducer.name, () => {
  it("loads once and then shows the committed text", () => {
    const loading = notepadReducer(EMPTY_NOTEPAD_STATE, {
      type: "load",
      path: PATH,
    });
    expect(loading[PATH]).toEqual({ status: "loading" });
    expect(notepadReducer(loading, { type: "load", path: PATH })).toBe(loading);
    expect(loaded()[PATH]).toEqual({
      status: "ready",
      original: "one",
      draft: "one",
      saved: undefined,
      fromFallback: false,
    });
    expect(isDirty(loaded()[PATH])).toBe(false);
    expect(isModified(loaded()[PATH])).toBe(false);
  });

  it("shows the saved copy over the committed text", () => {
    const state = loaded("two");
    expect(state[PATH]).toMatchObject({ draft: "two", saved: "two" });
    expect(isModified(state[PATH])).toBe(true);
    expect(isDirty(state[PATH])).toBe(false);
  });

  it("records a failure", () => {
    const state = notepadReducer(EMPTY_NOTEPAD_STATE, {
      type: "failed",
      path: PATH,
      message: "HTTP 404",
    });
    expect(state[PATH]).toEqual({ status: "error", message: "HTTP 404" });
    expect(isDirty(state[PATH])).toBe(false);
  });

  it("tracks typing as dirty until saved, and reverting drops the saved copy", () => {
    const edited = notepadReducer(loaded(), {
      type: "edit",
      path: PATH,
      draft: "one more",
    });
    expect(isDirty(edited[PATH])).toBe(true);
    const saved = notepadReducer(edited, {
      type: "saved",
      path: PATH,
      text: "one more",
    });
    expect(saved[PATH]).toMatchObject({ draft: "one more", saved: "one more" });
    expect(isDirty(saved[PATH])).toBe(false);
    expect(isModified(saved[PATH])).toBe(true);
    const reverted = notepadReducer(saved, { type: "reverted", path: PATH });
    expect(reverted[PATH]).toMatchObject({ draft: "one", saved: undefined });
  });

  it("ignores edits, saves and reverts for files that are not ready", () => {
    const loading = notepadReducer(EMPTY_NOTEPAD_STATE, {
      type: "load",
      path: PATH,
    });
    expect(
      notepadReducer(loading, { type: "edit", path: PATH, draft: "x" }),
    ).toBe(loading);
    expect(
      notepadReducer(loading, { type: "saved", path: PATH, text: "x" }),
    ).toBe(loading);
    expect(notepadReducer(loading, { type: "reverted", path: PATH })).toBe(
      loading,
    );
    expect(
      notepadReducer(EMPTY_NOTEPAD_STATE, {
        type: "overlayChanged",
        path: PATH,
        content: "x",
      }),
    ).toBe(EMPTY_NOTEPAD_STATE);
  });

  it("follows an outside save when the editor has no unsaved typing", () => {
    const followed = notepadReducer(loaded(), {
      type: "overlayChanged",
      path: PATH,
      content: "from clippy",
    });
    expect(followed[PATH]).toMatchObject({
      draft: "from clippy",
      saved: "from clippy",
    });
    const reverted = notepadReducer(followed, {
      type: "overlayChanged",
      path: PATH,
      content: undefined,
    });
    expect(reverted[PATH]).toMatchObject({ draft: "one", saved: undefined });
  });

  it("keeps unsaved typing when the overlay changes underneath", () => {
    const edited = notepadReducer(loaded(), {
      type: "edit",
      path: PATH,
      draft: "typing",
    });
    const changed = notepadReducer(edited, {
      type: "overlayChanged",
      path: PATH,
      content: "elsewhere",
    });
    expect(changed[PATH]).toMatchObject({
      draft: "typing",
      saved: "elsewhere",
    });
    expect(isDirty(changed[PATH])).toBe(true);
  });

  it("forgets a closed tab and leaves the rest alone", () => {
    const state = loaded();
    expect(notepadReducer(state, { type: "forget", path: PATH })).toEqual({});
    expect(notepadReducer(state, { type: "forget", path: "other" })).toBe(
      state,
    );
  });
});
