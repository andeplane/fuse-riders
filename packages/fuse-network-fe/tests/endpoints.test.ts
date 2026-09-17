import test from "node:test";
import assert from "node:assert/strict";
import { createEndpoints } from "../src/endpoints.js";
test("Pages invites preserve project path while API requests use configured backend", () => {
  const endpoints = createEndpoints(
    { basePath: "/fuse-riders/", apiOrigin: "https://backend.run.app" },
    "https://andeplane.github.io",
  );
  assert.equal(
    endpoints.appUrl("?room=ABC&display=1"),
    "https://andeplane.github.io/fuse-riders/?room=ABC&display=1",
  );
  assert.equal(
    endpoints.apiUrl("/api/rooms"),
    "https://backend.run.app/api/rooms",
  );
  assert.equal(endpoints.appUrl(), "https://andeplane.github.io/fuse-riders/");
});
test("local origin default and endpoint boundaries are explicit", () => {
  const endpoints = createEndpoints({ basePath: "/" }, "http://localhost:8787");
  assert.equal(
    endpoints.apiUrl("/api/rooms"),
    "http://localhost:8787/api/rooms",
  );
  for (const path of [
    "//other/api/rooms",
    "/api/../secret",
    "/api/\\evil",
    "/display",
  ])
    assert.throws(() => endpoints.apiUrl(path));
  assert.throws(() => endpoints.appUrl("https://other/"));
  for (const apiOrigin of [
    "https://user:secret@example.com",
    "https://example.com/path",
    "ftp://example.com",
  ])
    assert.throws(() =>
      createEndpoints({ basePath: "/", apiOrigin }, "https://example.com"),
    );
  assert.throws(() =>
    createEndpoints({ basePath: "https://other/" }, "https://example.com"),
  );
});
