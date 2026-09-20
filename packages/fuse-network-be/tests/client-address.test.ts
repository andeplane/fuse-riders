import test from "node:test";
import assert from "node:assert/strict";
import { rateLimitAddress } from "../src/client-address.js";

test("an IPv4 address is its own rate-limit identity", () => {
  assert.equal(rateLimitAddress("203.0.113.7"), "203.0.113.7");
  assert.equal(rateLimitAddress(" 203.0.113.7 "), "203.0.113.7");
  assert.notEqual(
    rateLimitAddress("203.0.113.7"),
    rateLimitAddress("203.0.113.8"),
  );
});

test("every address of one IPv6 /64 shares an identity, however it is written", () => {
  const key = "2001:db8:12:3400::/64";
  for (const address of [
    "2001:db8:12:3400::1",
    "2001:db8:12:3400:ffff:ffff:ffff:ffff",
    "2001:0DB8:0012:3400:0000:0000:0000:0001",
    "2001:db8:12:3400:1:2:3:4",
    "2001:db8:12:3400::1.2.3.4",
    "2001:db8:12:3400::1%eth0",
  ])
    assert.equal(rateLimitAddress(address), key, address);
  assert.equal(
    rateLimitAddress("2001:db8:12:3401::1"),
    "2001:db8:12:3401::/64",
  );
  assert.equal(rateLimitAddress("::1"), "0:0:0:0::/64");
  assert.equal(rateLimitAddress("::"), "0:0:0:0::/64");
  assert.equal(rateLimitAddress("fe80::1"), "fe80:0:0:0::/64");
  assert.equal(rateLimitAddress("1:2:3:4:5:6:7::"), "1:2:3:4::/64");
});

test("a v4-mapped IPv6 address is the IPv4 address it wraps", () => {
  for (const address of [
    "::ffff:203.0.113.7",
    "::FFFF:203.0.113.7",
    "::ffff:cb00:7107",
    "0:0:0:0:0:ffff:cb00:7107",
  ])
    assert.equal(rateLimitAddress(address), "203.0.113.7", address);
});

test("anything that is not an address shares one identity instead of minting budgets", () => {
  for (const garbage of [
    "",
    "unknown",
    "local",
    "203.0.113",
    "203.0.113.7.1",
    "256.1.1.1",
    "203.0.113.7:443",
    "[2001:db8::1]",
    "2001:db8:::1",
    "12345::1",
    "g::1",
    "x".repeat(10_000),
    "203.0.113.7, 198.51.100.1",
  ])
    assert.equal(rateLimitAddress(garbage), "unknown", garbage.slice(0, 40));
});
