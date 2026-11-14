import type { ChatEngine, ReplyRequest } from "../../llm/llmChat";

import { cannedBrain, cannedLine, engineBrain, toIrcLine } from "./brain";
import type { Regular } from "./regulars";
import { findRegular, regularsIn, systemPromptFor } from "./regulars";

function regular(nick: string): Regular {
  const found = findRegular(nick);
  if (!found) throw new Error(nick);
  return found;
}

class FakeEngine implements ChatEngine {
  readonly requests: ReplyRequest[] = [];
  disposed = false;
  constructor(
    private readonly answer: string | Error,
    private readonly kind: "model" | "rules" = "model",
  ) {}
  backend() {
    return this.kind === "model"
      ? ({ kind: "model", modelId: "m", label: "Tiny Model" } as const)
      : ({ kind: "rules", reason: "x" } as const);
  }
  async *reply(request: ReplyRequest) {
    this.requests.push(request);
    if (this.answer instanceof Error) throw this.answer;
    for (const piece of this.answer.match(/.{1,5}/gs) ?? []) yield piece;
  }
  dispose() {
    this.disposed = true;
  }
}

const signal = new AbortController().signal;
const request = (nick: string) => ({
  regular: regular(nick),
  channel: "#ddrnorway",
  userNick: "Guest1",
  history: [
    { nick: "Guest1", text: "hei RiChY" },
    { nick: "RiChY", text: "hei" },
  ],
});

describe("regulars", () => {
  it("seats the AI-voiced real regulars and fictional ones in #ddrnorway", () => {
    const nicks = regularsIn("#DDRnorway").map((r) => r.nick);
    expect(nicks).toEqual(
      expect.arrayContaining([
        "RiChY",
        "Andeplane",
        "Zredna",
        "CCBSbot",
        "stepzilla",
      ]),
    );
    expect(regular("richy").ai).toBe(true);
    expect(regular("FootieFox").ai).toBe(false);
  });

  it("tells the model who it is, its CCBS record, and not to speak for others", () => {
    const prompt = systemPromptFor(
      regular("Andeplane"),
      "#ddrnorway",
      "Guest1",
    );
    expect(prompt).toContain("You are Andeplane");
    expect(prompt).toContain("ranked tournaments");
    expect(prompt).toContain(
      "Never speak for, quote or pretend to be anyone else",
    );
  });
});

describe("brains", () => {
  it("picks canned lines deterministically", async () => {
    expect(cannedLine(regular("Zredna"), () => 0)).toBe("hehe");
    expect(cannedLine(regular("CCBSbot"), () => 0)).toBeUndefined();
    const brain = cannedBrain(() => 0);
    expect(brain.describe()).toContain("canned");
    expect(await brain.reply(request("Zredna"), signal)).toBe("hehe");
    brain.dispose();
  });

  it("cleans a model reply down to one IRC line", () => {
    expect(toIrcLine('<RiChY>: "hei på deg!"\nsecond line', "RiChY")).toBe(
      "hei på deg!",
    );
    expect(toIrcLine("RiChY: ok", "RiChY")).toBe("ok");
    expect(toIrcLine("  \n ", "RiChY")).toBeUndefined();
    expect(toIrcLine('""', "RiChY")).toBeUndefined();
    expect(toIrcLine("x".repeat(400), "RiChY")).toHaveLength(300);
  });

  it("asks the shared engine for AI regulars, with the channel as the conversation", async () => {
    const engine = new FakeEngine("<RiChY> klart, søndag!");
    const brain = engineBrain(engine, () => 0);
    expect(brain.describe()).toBe("Tiny Model, running in this browser");
    expect(await brain.reply(request("RiChY"), signal)).toBe("klart, søndag!");
    const sent = engine.requests[0];
    expect(sent?.system).toContain("You are RiChY");
    expect(sent?.messages).toEqual([
      { role: "user", content: "<Guest1> hei RiChY" },
      { role: "assistant", content: "hei" },
    ]);
    sent?.onProgress("loading");
    brain.dispose();
    expect(engine.disposed).toBe(true);
  });

  it("uses canned lines for non-AI regulars, failures, empty answers and while busy", async () => {
    const quiet = engineBrain(new FakeEngine("", "rules"), () => 0);
    expect(quiet.describe()).toBe("canned lines");
    expect(await quiet.reply(request("RiChY"), signal)).toBe(
      regular("RiChY").lines[0],
    );
    expect(await quiet.reply(request("FootieFox"), signal)).toBe("*gjesp*");
    const failing = engineBrain(new FakeEngine(new Error("no gpu")), () => 0);
    expect(await failing.reply(request("Zredna"), signal)).toBe("hehe");
    const slow = engineBrain(new FakeEngine("x".repeat(700)), () => 0);
    const first = slow.reply(request("RiChY"), signal);
    expect(await slow.reply(request("Zredna"), signal)).toBe("hehe");
    expect((await first)?.length).toBe(300);
  });
});
