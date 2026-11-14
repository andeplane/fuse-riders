import { renderHook } from "@testing-library/react";

import { useNoChat } from "./llmChat";

describe(useNoChat.name, () => {
  it("is a chat that never answers: no messages, no backend, and controls that do nothing", async () => {
    const { result } = renderHook(() =>
      useNoChat({ getAppContext: () => "desktop" }),
    );
    const chat = result.current;
    expect(chat).toMatchObject({
      messages: [],
      isStreaming: false,
      progress: null,
      error: null,
      backend: { kind: "none" },
    });
    await expect(chat.send("hello")).resolves.toBeUndefined();
    expect(chat.messages).toEqual([]);
    expect(chat.reset()).toBeUndefined();
    expect(chat.abort()).toBeUndefined();
  });
});
