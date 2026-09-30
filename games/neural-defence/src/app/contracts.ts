import type {
  Action,
  MapDefinition,
  MatchSettings,
  World,
  AiStrategy,
} from "../engine/types.js";
import { isAiStrategy } from "../engine/types.js";

export type GameMode = "sandbox" | "combat-lab" | "skirmish" | "watch";
/** An AI opening to play, or "random": drawn when the match starts. */
export type OpeningChoice = AiStrategy | "random";
export const isOpeningChoice = (value: unknown): value is OpeningChoice =>
  value === "random" || isAiStrategy(value);

/** A seat as the lobby shows it. */
export interface RoomSeat {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  watcher: boolean;
}
/** Settings the room's manager can change in the lobby. */
export interface RoomRules {
  mapId: string;
  aiStrategy: OpeningChoice;
  powerups: boolean;
}
export interface RoomSnapshot extends RoomRules {
  code: string;
  /** "between" never occurs in Fuse Craft (one round per match) but is part of the netcode's stages. */
  stage: "connecting" | "lobby" | "running" | "between" | "over";
  seats: RoomSeat[];
  /** This device's member id, once the room service has welcomed it. */
  self: string;
  manager: boolean;
  status: string;
  closed: "" | "ended" | "kicked";
}
/** A Versus room: a game session plus its lobby. */
export interface OnlineSession extends NeuralSession {
  readonly code: string;
  room(): RoomSnapshot;
  join(name: string): void;
  addBot(): void;
  removeBot(id: string): void;
  configure(change: Partial<RoomRules>): void;
  start(): void;
  rematch(): void;
  lobby(): void;
}
export interface OnlineDependencies {
  /** Asks the room service for a new room; this browser becomes its creator. */
  createRoom(): Promise<{ code: string }>;
  /** Connects to a room as its creator or a joiner. */
  openRoom(code: string): OnlineSession;
  validCode(code: string): boolean;
  /** The shareable link for a room. */
  roomLink(code: string): string;
  /** Moves the page to a room, so a refresh and a shared link land there. */
  enterRoom(code: string): void;
  /** Leaves any room in the page address. */
  leaveRoom(): void;
  /** A QR code image for a link, when the page can draw one. */
  qr?(text: string): Promise<string>;
  savedName(): string;
  saveName(name: string): void;
}
export interface SessionOptions {
  watchStrategies?: readonly [AiStrategy, AiStrategy];
}

export interface NeuralSession {
  readonly localPlayerId: string;
  readonly canControl: boolean;
  view(): Readonly<World>;
  dispatch(action: Action): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
  dispose(): void;
}

export type SessionFactory = (
  map: MapDefinition,
  slot: number,
  mode: GameMode,
  settings: MatchSettings,
  options?: SessionOptions,
) => NeuralSession;

export interface MapSummary {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  url: string;
}
export interface MapRepository {
  list(signal: AbortSignal): Promise<MapSummary[]>;
  load(id: string, signal: AbortSignal): Promise<unknown>;
}

export interface PresentationPreferences {
  mute: boolean;
  volume: number;
  reducedMotion: boolean;
}
export interface PreferencesStore {
  read(): PresentationPreferences;
  write(value: PresentationPreferences): void;
}
