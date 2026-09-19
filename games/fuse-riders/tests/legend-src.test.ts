import test from "node:test";
import assert from "node:assert/strict";
import { legendSrc } from "../src/client/legend-src.js";
import { resolveAssetUrl } from "../src/render/asset-url.js";

test("legendSrc routes pickup legend icons through assetUrl so they work under a Pages base path", () => {
  assert.equal(
    legendSrc("neon-pixel", "pickup-power"),
    resolveAssetUrl("/themes/neon-pixel/pickup-power.svg", "/"),
  );
  assert.equal(
    legendSrc("clean-neon", "pickup-orbitShield"),
    resolveAssetUrl("/themes/clean-neon/pickup-orbitShield.svg", "/"),
  );
});
