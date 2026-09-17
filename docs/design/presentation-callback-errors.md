# Presentation callback errors

Addresses P4 in #255 and #258. A malformed transport frame and a failing consumer
are different failures.

`SocketClient` catches only JSON decoding failures. LAN message and round-trip
callback exceptions reach the browser's event error boundary, retaining the
original error for diagnostics. Later WebSocket messages remain eligible for
delivery; this does not add a retry of partially executed application callbacks.

`RoomRuntime` must finish simulation, delivery and each event batch even when its
consumer fails. State, event, ready, status and ended callbacks are isolated
individually. Failures go to `RuntimeOptions.callbackError(kind, error)`, or
`console.error` by default. A custom reporter must not throw; if it does, both
errors are reported to the console. No callback error is labelled malformed
network traffic.

State publication is acknowledged only after the callback returns successfully.
A failed frame remains eligible on the next runtime iteration, unless a newer
frame supersedes it. State consumers should therefore tolerate receiving a frame
again after partial execution. Event, ready, status and ended notifications are
attempted once at their normal emission points; replaying partially handled
sounds, analytics or lifecycle actions would create duplicate effects. Callback
failure does not rewind the world, undo consumer side effects or promise to
recover a permanently broken UI. An ended callback runs after runtime scheduling
has already stopped.

Regressions use typed synchronous WebSocket delivery and injected runtime clocks,
schedulers and transports. They verify malformed JSON versus application errors,
same-frame retry, subsequent events and ticks, terminal cancellation, and peer
convergence while the other replica's presentation callbacks keep failing.
