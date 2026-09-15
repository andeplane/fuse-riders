# ADR 040: State-based input gestures and an unreliable input channel

Date: 2026-09-15. Status: implemented for user testing; first step of the deterministic action-log plan (issue #82 brief). Amends the [ADR030 direct-only amendment](030-online-delivery-and-replication.md#reviewed-direct-only-action-amendment-2026-09-14), which chose "safe shot loss" for a lost fire edge.

## Problem

A bomb press was a one-shot edge. Held-state resends carried `bomb: true` with no action, and the host started a charge only on an explicit `press`, so a lost or late press meant the whole gesture was silently lost while the button stayed down. Input arriving outside the host's ±4-tick window was rejected with a resync demand and cancelled any charge. Every input rode the single reliable ordered channel, so one lost packet stalled everything queued behind it until SCTP retransmitted.

## Decision

The wire carries control state, never edges. A controller numbers each bomb gesture within its session. Every packet restates the full state: held steering, the held gesture id while charging, or the last finished gesture (release or cancel, with its aim) until the next press. After any change the controller sends three trailing packets even when nothing is held. The host keeps the active and highest finished gesture per seat: a held packet naming an unknown, unfinished gesture recreates the press; a release naming an unknown gesture applies press and release in the same step, so a tap whose press and resends were all lost still fires at minimum charge; a finished gesture is idempotent. Freshness expiry (ten ticks) still neutralizes controls and cancels the charge, but forgets the held gesture so it re-presses when packets resume. A new host control scope forgets finished gestures on the client, so a repeated release can never invent a shot after a reset.

Late input is applied at the next step and far-future input waits at most four ticks; nothing is rejected for timing. Duplicate and reordered packets are dropped by sequence, so full-state packets are safe on an unordered channel. The host opens a second data channel, `fast`, with `ordered: false, maxRetransmits: 0`; input samples and tick probes use it and fall back to the reliable channel when it is unavailable. Management, world, events and checkpoints stay reliable.

Packets without a gesture id keep the previous edge semantics, so LAN controllers and older clients are unaffected. The LAN server ignores gesture ids.

## Consequences

A lost first packet costs one resend interval, not the gesture. The shot-failure notice remains for the case where the local send was refused. This does not yet reduce traffic or replace the world stream; those are the following steps of the action-log plan.
