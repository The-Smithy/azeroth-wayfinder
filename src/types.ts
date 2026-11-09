export type LatLngTuple = [number, number];

/** npc = a famous character; mob = a quest target / named enemy. */
export type LocationKind = 'city' | 'town' | 'dungeon' | 'raid' | 'landmark' | 'zone' | 'npc' | 'mob';
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
  /** A well-known hub town (dealt in the ×1 rounds). */
  popular?: boolean;
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
