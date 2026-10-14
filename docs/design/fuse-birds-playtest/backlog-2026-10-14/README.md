# Backlog integration browser evidence

Real Chromium room captures from the source-matched `fa997b5c` recovery smoke
(identical application source to integration `c24053b6`). The flow used two
players, an emulated 390×844 phone and a separate shared TV, with `?mute`.

The full flow passed: Scatter launch and ammunition agreement, automatic
generation-two phone admission after refresh, persistent applied-action ordinal
checks on the opposite peer in both PASS directions, bounded round completion,
results and rematch with fresh ammunition. The smoke requires same-match and
same-round receiver application; a queued send or automatic deadline cannot
satisfy that check.

- [Desktop room](desktop.png)
- [Recovered phone and zoom controls](recovered-phone.png)
- [Completed round](result.png)

These are actual browser captures, inspected after the flow. They do not establish
physical-phone, WAN, gamepad or unmuted sound acceptance. Final integration CI and
measured coverage are recorded on PR #517 rather than inferred from these images.
