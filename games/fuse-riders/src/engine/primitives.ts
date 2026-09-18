/**
 * The small records the simulation is written in. They also travel on the wire, so `games/fuse-riders/src/shared/protocol.ts` re-exports
 * them; they are defined here because the engine imports nothing outside itself.
 */
export type PlayerId = string;
export interface BombActionCommand {
  action: BombAction;
}
export type BombAction = "press" | "release" | "cancel";
export interface TrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  createdTick: number;
  expiresAtTick: number;
  /** Absent on the living, age-limited tail. Detached runs share an issued id and decay clock. */
  detached?: Readonly<{ id: number; decayStartTick: number }>;
}
export interface BlastCircle {
  x: number;
  y: number;
  radius: number;
}
