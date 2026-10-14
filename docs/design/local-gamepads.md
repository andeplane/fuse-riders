# Local gamepads

PLAY LOCAL opens a controller setup before starting a transport-free game. Up to five humans share one browser; each detected gamepad or configured keyboard player has a separate seat. Unused seats start as AI. Names and assignments last for this page only. Changing the roster means starting a new local game.

Controllers in keyboard mode use separate configurable key trios, with A/D/Space, E/F/M and I/G/K (left/right/fire) as the first three presets. Bindings use physical `KeyboardEvent.code`, with no overlapping keys across seats. Each rider owns its own `ControllerInputState` and keyboard binding instance; releasing one player's key cannot release another player's charge. Keyboard help reflects the chosen controls.

The existing room runtime owns one clock and one World. Each local human gets an ordinary input stream and JOIN entry. All local streams advance their completeness with the clock, and controls append through the same tick scheduler as the primary stream. Online transport never accepts these extra local streams. Engine rules, movement, log entries and golden hashes are unchanged. All riders in a local multiplayer game use the same presentation time, without the single-rider prediction lead.

The browser Gamepad API is sampled by the existing UI frame loop. Standard-mapped pads use left-stick X or D-pad left/right and the bottom face button to charge/release; Start starts a rematch. Nonstandard pads expose a small calibration flow for left, right and fire instead of assuming a vendor's raw layout. Browsers may hide a connected pad until a button is pressed. Setup reports missing/blocked APIs and offers a retry.

Disconnect, blur, hidden pages, dialogs and round changes cancel held controls without releasing a shot. A controller must return to neutral before rearming. Reconnection retains the seat by browser index and device id; a different device cannot silently take it. Multiple identical pads keep separate indices. Local multiplayer never submits account match/round reports.

Verification covers separate streams, completeness, repeatable local replay, lifecycle cancellation and simulated browser gamepads. Simulated pads do not establish physical 8BitDo compatibility; that requires the user's connected hardware.
