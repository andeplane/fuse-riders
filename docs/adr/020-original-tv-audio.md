# ADR 020: Original synthesized TV audio

Status: Accepted; root reviewed before implementation.

Use a TV-only Web Audio synthesizer for an original looping arcade melody, bass and percussion. All notes are composed in source; no licensed recordings or external audio requests. Separate music/effects mute controls and volumes remain accessible beside TV controls. Audio starts only after an explicit host gesture; unsupported or blocked audio never blocks play.

A small pure audio director receives typed authoritative server messages and an injected synth/time interface. It scopes event deduplication to match/round, establishes a snapshot baseline after every connection, and discards old events. Simultaneous volley launches/explosions coalesce per tick. Pickup cues use a new authoritative pickupCollected event after successful collection; initial/reconnected snapshots are silent. Review refinement: live snapshots omit statistics until match end, so events avoid additional payload overhead. One bounded scheduler emits music steps while playing/countdown and resets scheduling after inactivity instead of replaying missed notes.

Web Audio adapter owns short oscillator envelopes, limits voice lifetimes, and applies independent channel gains. No audio on phone controllers. Tests inject a recording sink and clock to verify unlock, mute/volume routing, score scheduling, event deduplication, reconnect silence and pickup detection. Browser checks verify controls and gesture activation; physical TV speaker listening remains a user check.
