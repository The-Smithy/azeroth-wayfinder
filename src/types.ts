export type LatLngTuple = [number, number];

export type LocationKind = 'city' | 'town' | 'dungeon' | 'raid' | 'landmark' | 'zone';
export type Faction = 'alliance' | 'horde' | 'neutral';

export interface Place {
  id: string;
  name: string;
  kind: LocationKind;
  faction: Faction;
  zoneId: number;
  zone: string;
  continent: string;
  latlng: LatLngTuple;
  /** Zone id whose outline counts as a bullseye (zones & cities). */
  area?: string;
  isNew?: boolean;
}

export interface Zone {
  name: string;
  continent: string;
  city: boolean;
  /** [[south, west], [north, east]] – the in-game zone map rectangle. */
  bounds: [LatLngTuple, LatLngTuple];
  rings: LatLngTuple[][];
}

export interface MapManifest {
  source: string;
  tileSize: number;
  maxNativeZoom: number;
  tiles: string[];
  worldBounds: [LatLngTuple, LatLngTuple];
  overviewBounds: [LatLngTuple, LatLngTuple];
  oceanBounds: [LatLngTuple, LatLngTuple];
}

export interface RoundResult {
  placeId: string;
  guess: LatLngTuple;
  /** Distance to the target in yards (0 = bullseye / inside the area). */
  yards: number;
  /** Accuracy, 0–100. */
  score: number;
  /** Points banked: score × the round multiplier. */
  points: number;
  hint: boolean;
}
