# ADR-019: Controller pointer recovery

- Status: Accepted; root reviewed before implementation
- Date: 2026-09-13

## Evidence and decision

The input model overwrites a reused pointer ID without releasing its old control; pressing right with a reused left pointer therefore leaves left held indefinitely. DOM cleanup removes active classes but never releases browser pointer capture. A capture owned by the previous button can route the next interaction away from the intended button. Capture setup also currently throws before input handling with no recovery path.

Keep control state as the source of truth. Cancel previous ownership before reusing an ID, preserving cancellation rather than launch for bomb reassignment. Extract the browser pointer adapter with typed injected targets. It tracks capture owners, releases captures on clear, derives every active class from input state, and handles pointerup/cancel at the window capture phase so releases outside a button are recovered even if capture failed. Lost capture cancels only that owner's current pointer. A failed setPointerCapture is tolerated because global terminal handlers remain active. Preserve multiple simultaneous touches, existing no-zoom behavior, and charged-bomb release/cancel distinction.

Tests exercise event target to input-message mapping and real browser cancellation, capture loss, reused ID, blur cleanup, and immediate re-entry. This fixes demonstrated lifecycle defects; it does not claim to reproduce the exact unobserved phone incident.
