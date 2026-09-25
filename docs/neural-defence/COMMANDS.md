# Command definitions and availability

The RTS command card is a view of game rules. Build/research costs, prerequisites and availability must have one authoritative definition consumed by both the simulation and the UI. Presentation owns icons, wording, keyboard slots and tooltip placement; it does not invent technology locks or duplicate affordability checks.

Construction distinguishes **can queue** from **can start**. Unsupported or unaffordable plans currently wait for support/resources, so the UI must explain that waiting state without forbidding a legal queue action. Research must report its actual missing requirements. New buildable/research entries should define prerequisites in the catalog and automatically receive availability explanations.

Disabled commands remain inspectable: hover/focus reveals requirements on desktop, tapping explains them on touch devices. The displayed requirements and clock overlays derive from the current authoritative world, so spending, construction, cancellation and research completion refresh the same command model. Input handlers refuse unavailable actions; explanatory taps never send a gameplay command.

Submenus replace the same six command slots. Slots use Q/W/E and A/S/D, A returns to the parent, and unused slots remain empty. Build contains Neuron, Pulse, Siege and Relay towers; D pages the catalog. The brain's Particles card selects Pulse, Heavy or Swift. D Charge on a non-brain structure sets or clears maximum attack demand. Progress overlays show actual construction/research progress. Camera state and layout stay independent of these command rules.

This is a local catalog and a pure evaluator, not a plugin framework or a new simulation subsystem. Queue semantics are preserved; research prerequisites are data, not special cases in DOM handlers.

## Placement and automatic expansion

Build buttons evaluate player-level eligibility, then arm a local placement tool. Hover shows the actual translucent structure sprite and tile-specific validity; clicking/tapping queues only a legal target. Placement never spends resources or sends an action until confirmed. Esc, S Cancel, or leaving Build clears the tool. Touch uses choose-then-tap; camera gestures retain their click suppression. Invalid targets keep placement armed and explain the missing condition.

The brain's Auto expand toggle is an authoritative `setAutoExpand` command, stored as `Player.autoExpand` (default false). The engine proposes a neuron only with no manual queue, an idle builder, sufficient biomass and a legal connected frontier. Candidates are ordered by hex distance from the brain, then cell index. It waits while unavailable and resumes without user input. Existing rotating-slot construction arbitration resolves competing claims; losing automatic claims are discarded and reconsidered next tick. Foreign unpaid plans do not reserve land. Turning off preserves an already-started job. Elimination clears the toggle.

Auto expansion first changed Neural Defence rules to version 2 and requires explicit boolean checkpoint state. The input log, checkpoints and rollback replay carry the toggle; no UI timers or privileged construction path run the automation. The skirmish content/profile update advances Neural Defence to version 3. Research jobs, queued and built advanced structures, and individual particles must satisfy owner prerequisites during checkpoint validation. The stateless AI emits ordinary commands from each authoritative world tick, including during rollback. Fuse Riders rules are unchanged.
