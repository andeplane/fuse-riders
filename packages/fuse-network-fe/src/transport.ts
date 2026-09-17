/** What a room runtime needs from a transport; the WebRTC mesh and a test fake both provide it. */
export interface RoomTransport {
  readonly id: string;
  readonly hostId: string;
  readonly sentBytes: number;
  connect(): void;
  /** `farewell`: the page is leaving on purpose, so the transport may say goodbye on its links first. */
  close(farewell?: boolean): void;
  /** Reliable, ordered. `bufferLimit` lets a bulk transfer queue more than the room-control default. */
  send(id: string, data: unknown, bufferLimit?: number): boolean;
  /** Unordered, unreliable: skipped rather than queued when the channel is backed up. */
  sendFast(id: string, bytes: Uint8Array): boolean;
  linked(id: string): boolean;
  explain(id: string): string;
  stats(): Promise<{ direct: number; relayed: number; buffered: number }>;
}
export interface TransportEvents {
  /** Admitted by the room service: this member's id and the room creator's. */
  welcome(id: string, hostId: string): void;
  /** Membership, as the room service sees it. */
  peer(id: string, online: boolean): void;
  /** The direct link to a member opened or stopped carrying sends. An open link is a hint; `linked()` is the fact. */
  link(id: string, open: boolean): void;
  message(id: string, data: unknown): void;
  fast(id: string, bytes: Uint8Array): void;
  status(text: string): void;
  /** Another tab of the creator holds the authority lease. */
  revoked(): void;
  /** The room expired or its creator ended it. */
  ended(): void;
  terminated(text: string): void;
}
