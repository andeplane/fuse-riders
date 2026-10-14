/**
 * A city as data: a map picture, the streets traced over it as a graph, and where each place's door and building are.
 * Every coordinate is in the map's own pixel space (`map.width` × `map.height`, the concept board's size); the page
 * scales by the picture's real size when it draws, so a sharper picture with the same composition needs no new
 * numbers. The rules walk the streets (`../../streets.ts` densifies the graph into unit steps); the page draws them.
 */
export type MapPoint = readonly [x: number, y: number];

export interface CityNode {
  /** A name the edges and places refer to. */
  id: string;
  at: MapPoint;
}

/** What an edge is in the picture: asphalt, a footbridge or a sidewalk (only the debug overlay tells them apart). */
export type StreetKind = "road" | "bridge" | "path";

export interface CityEdge {
  from: string;
  to: string;
  /** The bends between the two nodes, in order. */
  via: readonly MapPoint[];
  kind: StreetKind;
}

export interface CityPlace {
  /** The place's id (`PLACES[i].id`); `City.places` lists them in `PLACES` order. */
  id: string;
  /** The node in front of the building: where walking to the place ends and its people stand. */
  door: string;
  /** The building's outline for taps. */
  tap: readonly MapPoint[];
  /** Where the place's name label sits. */
  label: MapPoint;
}

/** A part of the picture that stands in front of the streets, redrawn over walkers that pass behind it. */
export interface CityOccluder {
  /** Its outline. */
  shape: readonly MapPoint[];
  /** The ground line: walkers standing above it are behind. */
  base: number;
}

/** A node at (`x`, `y`). */
export const node = (id: string, x: number, y: number): CityNode => ({
  id,
  at: [x, y],
});
/** An edge from one node to another through the bends `via`. */
export const edge = (
  from: string,
  to: string,
  via: readonly MapPoint[],
  kind: StreetKind = "road",
): CityEdge => ({ from, to, via, kind });

export interface City {
  id: string;
  name: string;
  map: {
    /** The art table id of the picture. */
    art: string;
    /** The coordinate space of everything below. */
    width: number;
    height: number;
  };
  nodes: readonly CityNode[];
  edges: readonly CityEdge[];
  places: readonly CityPlace[];
  /** Where a new player starts (the first home's door). */
  start: string;
  occluders: readonly CityOccluder[];
  /** Looks only: the open water, where the board lets the light glint (`holes`: boats, piers and rocks on it). */
  water?: {
    shape: readonly MapPoint[];
    holes: readonly (readonly MapPoint[])[];
  };
}
