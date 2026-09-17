import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TEXT_LENGTH,
  bootFailedProps,
  bootFailureCode,
  sanitizeProperties,
  sanitizeText,
} from "../src/online/analytics-text.js";

const ROOM_TOKEN = "0123456789abcdef".repeat(4);

test("a URL carrying a room code and a token leaves as a placeholder, with the words around it intact", () => {
  const message = `Failed to fetch dynamically imported module: https://fuse.example/assets/ui-4f2a.js?room=AB42&token=${ROOM_TOKEN}`;
  const clean = sanitizeText(message);
  assert.equal(clean, "Failed to fetch dynamically imported module: [url]");
  for (const leaked of ["AB42", ROOM_TOKEN, "fuse.example", "?room="])
    assert.ok(!clean.includes(leaked), leaked);
});

test("a multi-kilobyte message is cut to the bound, and a token the cut ran through does not survive as a fragment", () => {
  const huge = `${"x ".repeat(3000)}${ROOM_TOKEN}`;
  const clean = sanitizeText(huge);
  assert.equal(clean.length, MAX_TEXT_LENGTH);
  assert.ok(clean.endsWith("…"));
  // A short prefix, then a token that straddles the 4096-character scan limit: the partial run is dropped.
  const straddling = `boot ${"y".repeat(4060)} ${ROOM_TOKEN}`;
  assert.equal(straddling.slice(0, 4096).includes(ROOM_TOKEN), false);
  assert.ok(straddling.slice(0, 4096).includes(ROOM_TOKEN.slice(0, 16)));
  assert.ok(!/[0-9a-f]{8,}/.test(sanitizeText(straddling)));
  assert.ok(sanitizeText("z".repeat(100_000)).length <= MAX_TEXT_LENGTH);
});

test("query strings, credential pairs, tokens, UUIDs, JWTs and e-mail addresses are all removed outside URLs too", () => {
  assert.equal(
    sanitizeText("GET /index.html?room=AB42&display=1 failed"),
    "GET /index.html[query] failed",
  );
  assert.equal(
    sanitizeText("joining room=AB42 now"),
    "joining room=[redacted] now",
  );
  assert.equal(sanitizeText("bad token: hunter2!"), "bad token=[redacted]");
  assert.equal(sanitizeText(`peer ${ROOM_TOKEN} gone`), "peer [token] gone");
  assert.equal(
    sanitizeText("id 3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b lost"),
    "id [token] lost",
  );
  assert.equal(
    sanitizeText(
      "auth failed for eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl",
    ),
    "auth failed for [token]",
  );
  assert.equal(
    sanitizeText("no account for rider@example.com"),
    "no account for [email]",
  );
  assert.equal(
    sanitizeText("blob:https://fuse.example/1b2c failed"),
    "blob:[url] failed",
  );
});

test("a known secret is removed wherever it appears, as a whole word and whatever its case", () => {
  assert.equal(
    sanitizeText("Room ab42 is full (AB42)", { secrets: ["AB42"] }),
    "Room [redacted] is full ([redacted])",
  );
  assert.equal(
    sanitizeText("CAB421 stays", { secrets: ["AB42"] }),
    "CAB421 stays",
    "never the middle of a longer word",
  );
  assert.equal(
    sanitizeText("the cat", { secrets: ["th", "", null, undefined] }),
    "the cat",
    "a secret too short to be one is ignored rather than shredding the text",
  );
  assert.equal(
    sanitizeText("a.b and axb cost $5", { secrets: ["a.b"] }),
    "[redacted] and axb cost $5",
    "a secret is a literal, not a pattern",
  );
});

test("ordinary event values pass through unchanged", () => {
  for (const value of [
    "bomb",
    "shared",
    "Connected · linking riders",
    "crossed",
    "error code: 1006",
    "TypeError: x is not a function",
  ])
    assert.equal(sanitizeText(value), value);
});

test("the result is one line, and anything can be passed in", () => {
  const nul = String.fromCharCode(0);
  assert.equal(
    sanitizeText(`Error: boom\n    at start (ui.js:1:2)\n\tat main${nul}`),
    "Error: boom at start (ui.js:1:2) at main",
  );
  assert.equal(sanitizeText(undefined), "undefined");
  assert.equal(sanitizeText(42), "42");
  assert.equal(sanitizeText({ toString: () => "custom" }), "custom");
  assert.equal(
    sanitizeText({
      toString() {
        throw new Error("hostile");
      },
    }),
    "[unprintable]",
  );
  assert.equal(sanitizeText("abcdef", { max: 4 }), "abc…");
});

test("every string in a property bag is sanitised and nothing unbounded rides along", () => {
  assert.deepEqual(
    sanitizeProperties(
      {
        status: "link to https://fuse.example/?room=AB42 failed",
        secondsWaiting: 20,
        host: true,
        nothing: null,
        dropped: undefined,
        tags: ["ok", `t ${ROOM_TOKEN}`],
        nested: { room: "AB42" },
        callback: () => "AB42",
      },
      { secrets: ["AB42"] },
    ),
    {
      status: "link to [url] failed",
      secondsWaiting: 20,
      host: true,
      nothing: null,
      tags: ["ok", "t [token]"],
      nested: "[object]",
      callback: "[function]",
    },
  );
  const many = sanitizeProperties({ many: Array<string>(100).fill("a") }).many;
  assert.ok(Array.isArray(many));
  assert.equal(many.length, 32);
});

test("a boot failure is reported as a class, a stable code and a bounded message", () => {
  const error = new TypeError(
    `Failed to fetch dynamically imported module: https://fuse.example/assets/ui.js?room=AB42`,
  );
  assert.deepEqual(bootFailedProps(error, { secrets: ["AB42"] }), {
    name: "TypeError",
    code: "module-load",
    message: "Failed to fetch dynamically imported module: [url]",
  });
  const long = bootFailedProps(new Error("m ".repeat(5000)));
  assert.equal(long.message.length, MAX_TEXT_LENGTH);
  assert.equal(bootFailedProps(new Error("x")).name, "Error");
  assert.equal(
    bootFailedProps(Object.assign(new Error("x"), { name: "n ".repeat(500) }))
      .name.length,
    40,
  );
});

test("boot failure codes are few and stable, whatever was thrown", () => {
  const named = (name: string, message: string) =>
    Object.assign(new Error(message), { name });
  assert.equal(
    bootFailureCode(named("SecurityError", "The operation is insecure.")),
    "storage",
  );
  assert.equal(
    bootFailureCode(named("QuotaExceededError", "exceeded")),
    "storage",
  );
  assert.equal(
    bootFailureCode(new Error("localStorage is not available")),
    "storage",
  );
  assert.equal(
    bootFailureCode(new Error("Importing a module script failed.")),
    "module-load",
  );
  assert.equal(
    bootFailureCode(new Error("Unable to preload CSS for /assets/x.css")),
    "module-load",
  );
  assert.equal(
    bootFailureCode(new Error("Cannot create WebGL context")),
    "webgl",
  );
  assert.equal(bootFailureCode(new TypeError("Failed to fetch")), "network");
  assert.equal(bootFailureCode(new Error("Load failed")), "network");
  assert.equal(bootFailureCode(new Error("boom")), "unknown");
  // Not everything thrown is an Error: a rejected promise's reason can be anything.
  assert.deepEqual(bootFailedProps("plain string"), {
    name: "string",
    code: "unknown",
    message: "plain string",
  });
  assert.deepEqual(bootFailedProps(undefined), {
    name: "undefined",
    code: "unknown",
    message: "undefined",
  });
  assert.deepEqual(
    bootFailedProps({ name: "SecurityError", message: "denied" }),
    { name: "SecurityError", code: "storage", message: "denied" },
    "a DOMException from another realm is not instanceof Error",
  );
  assert.equal(
    bootFailedProps(Object.assign(new Error("x"), { name: "" })).name,
    "Error",
  );
});
