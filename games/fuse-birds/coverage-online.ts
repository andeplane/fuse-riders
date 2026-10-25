// The turn handoff and phone-reload recovery race the turn deadline (#250, being fixed in #547): quarantined here as in
// CI's birds-online smoke, so the instrumented run covers the lobby, controls and aim/cancel.
process.env.FUSE_BIRDS_SKIP_TURN_HANDOFF ??= "1";
await import("../../scripts/fuse-birds-online-smoke.js");
export {};
