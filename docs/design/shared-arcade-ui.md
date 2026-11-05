# Shared arcade UI

This refinement applies Impeccable's polish and adaptation guidance to the existing
Fuse visual system. The gallery, launcher and game menu are shared surfaces;
each game's arena, illustration, lobby composition and controls keep their own identity.

- Let real gameplay screenshots lead the gallery. Keep its introduction compact,
  use the existing pixel face for display type and retain readable sans-serif descriptions.
  A failed screenshot falls back to the game's existing mark without blocking play.
- The launcher is a navigation task: show game names and descriptions together,
  keep accents on the game marks, distinguish the current game and use visible keyboard focus.
  Bound the list to the viewport and scroll it, including on landscape phones.
- In the game menu, returning to play is the primary action. Keep leaving visually
  separate, retain existing confirmation behavior and never imply that opening a menu pauses a room.
- Use at least 44px for launcher controls, preserve mute across game links and
  respect reduced motion. Keep colors and typography scoped to shared components
  so improving navigation does not change a game's simulation or player identity.

For another design pass, use Impeccable's `polish` or `adapt` against a named surface,
with the existing code, tokens and gameplay captures as visual authority. Review the
rendered result at desktop, narrow portrait and short landscape sizes; detector output
alone does not establish visual quality. See [Impeccable](https://github.com/pbakaus/impeccable).

Validation: the fuse-ui gallery, portal and game-menu tests; `scripts/gallery-smoke.ts`
for each game's real entrance and return path; `scripts/shared-menu-controls-smoke.ts`
for play, controls and return-to-game behavior. Capture PR screenshots with headless
`agent-browser` as required by the repository instructions.
