# Command definitions and availability

The RTS command card is a view of game rules. Build/research costs, prerequisites and availability must have one authoritative definition consumed by both the simulation and the UI. Presentation owns icons, wording, keyboard slots and tooltip placement; it does not invent technology locks or duplicate affordability checks.

Construction distinguishes **can queue** from **can start**. Unsupported or unaffordable plans currently wait for support/resources, so the UI must explain that waiting state without forbidding a legal queue action. Research must report its actual missing requirements. New buildable/research entries should define prerequisites in the catalog and automatically receive availability explanations.

Disabled commands remain inspectable: hover/focus reveals requirements on desktop, tapping explains them on touch devices. The displayed requirements and clock overlays derive from the current authoritative world, so spending, construction, cancellation and research completion refresh the same command model. Input handlers refuse unavailable actions; explanatory taps never send a gameplay command.

Submenus replace the same six command slots. Slots use Q/W/E and A/S/D, A returns to the parent, and unused slots remain empty. Build contains the current Neuron and test Tower. Progress overlays show actual construction/research progress. Camera state and layout stay independent of these command rules.

This is a local catalog and a pure evaluator, not a plugin framework or a new simulation subsystem. Existing rules and queue semantics are preserved; future research prerequisites are data, not special cases in DOM handlers.
