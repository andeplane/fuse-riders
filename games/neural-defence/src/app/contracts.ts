import type { Action, MapDefinition, MatchSettings, World } from '../engine/types.js';

export type GameMode = 'sandbox' | 'combat-lab';

export interface NeuralSession {
  view(): Readonly<World>;
  dispatch(action: Action): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
  dispose(): void;
}

export type SessionFactory = (map: MapDefinition, slot: number, mode: GameMode, settings: MatchSettings) => NeuralSession;

export interface MapSummary { id: string; title: string; description: string; width: number; height: number; url: string }
export interface MapRepository {
  list(signal: AbortSignal): Promise<MapSummary[]>;
  load(id: string, signal: AbortSignal): Promise<unknown>;
}

export interface PresentationPreferences { mute: boolean; volume: number; reducedMotion: boolean }
export interface PreferencesStore {
  read(): PresentationPreferences;
  write(value: PresentationPreferences): void;
}
