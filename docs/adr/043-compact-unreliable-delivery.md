# ADR 043: Compact tuples on the unreliable channel with overlap and repair

Date: 2026-09-15. Status: implemented for user testing; fourth step of the deterministic action-log plan. Extends [ADR040](040-state-based-input-gestures.md) and [ADR042](042-action-replication.md).

## Problem

After ADR042 the JSON envelope was most of every packet: four UUID-sized identity fields per message plus named keys, about 90 bytes of framing around 20 bytes of content. Committed batches still rode the ordered reliable channel, so one lost packet stalled the batches queued behind it until SCTP retransmitted, and the guest's own inputs were repeated 20 times a second while held.

## Decision

Gameplay messages on the `fast` data channel are MessagePack tuples with a four-field envelope: message id, authority epoch, a 32-bit hash of the authority incarnation, and the payload. Sender and receiver identity are implied by the data channel, which belongs to one authenticated peer connection that is replaced whenever a connection id changes; the reliable channel keeps its full JSON envelope. Committed batches, input samples and tick probes use tuples with numeric tags. A control scope travels as a 32-bit hash that the receiver resolves only against scopes it already holds; an unknown hash yields a stale scope that the host rejects as before.

Committed batches ride the unreliable channel. Each batch restarts from the journal sequence sent four publishes earlier, so any run of up to three consecutive lost packets costs nothing and no receipts are needed. A view that sees a batch start beyond its own sequence reports a gap; if the gap persists for 100 ms it asks the host to repair from that sequence, and the host answers from its journal on the reliable channel, at most every 250 ms. Only history the journal no longer holds, a hash mismatch or a malformed batch leads to a baseline. Baselines and events stay on the reliable channel.

Held controls repeat at 4 Hz after the three trailing resends that follow every change, instead of 20 Hz, and the host's freshness window grows from ten to twenty ticks so two lost heartbeats cannot neutralize a held control; the local predictor mirrors the window. The LAN controller keeps its own cadence.

## Measured

`scripts/benchmark-actions.ts` reports about 1.9 KB/s of fast-channel bytes per full view with four AI riders, against 2.7 KB/s of application JSON after ADR042 and roughly 47 KB/s for the retired world codec at 20 Hz. The AI riders' per-tick steering changes are most of that; an idle committed batch is under 32 bytes including its envelope, so a humans-only room sits near 0.6 KB/s per view. A held input packet is under 48 bytes and is sent four times a second.

## Consequences

A lost packet no longer stalls anything. The fast channel drops back to the reliable channel whenever it is not open. Bounding is by packet size, declared collection lengths and the existing journal limits. Controller-only phones, which need none of the committed stream, are the next step.
