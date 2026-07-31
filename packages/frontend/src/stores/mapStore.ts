import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { FrontendLocation, FrontendLocationConnection, FrontendLocationState } from '@/types';

export type LocationNode = FrontendLocation;
export type LocationConnection = FrontendLocationConnection;
export type LocationState = FrontendLocationState;
/** @deprecated Use LocationNode */
export type MapLocation = LocationNode;
/** @deprecated Use LocationConnection */
export type MapConnection = LocationConnection;
/** @deprecated Use LocationState */
export type MapState = LocationState;

const initialMap: LocationState = {
  locations: [],
  connections: [],
  currentLocationId: null,
  discoveredLocationIds: [],
  selectedMapId: null,
  viewMode: 'world',
};

interface MapStoreState {
  mapState: LocationState;

  setMapState: (mapState: Partial<LocationState>) => void;
  updateMapState: (updates: Partial<LocationState>) => void;
  clearMapState: () => void;
  selectMap: (mapId: string | null) => void;
  setViewMode: (mode: 'world' | 'region') => void;
}

export const useMapStore = create<MapStoreState>()(
  devtools(
    immer((set) => ({
      mapState: initialMap,

      setMapState: (mapState) =>
        set((state) => {
          Object.assign(state.mapState, mapState);
        }),

      updateMapState: (updates) =>
        set((state) => {
          Object.assign(state.mapState, updates);
        }),

      clearMapState: () =>
        set((state) => {
          state.mapState = initialMap;
        }),

      selectMap: (mapId) =>
        set((state) => {
          state.mapState.selectedMapId = mapId;
        }),

      setViewMode: (mode) =>
        set((state) => {
          state.mapState.viewMode = mode;
        }),
    })),
    { name: 'MapStore' }
  )
);

export const selectMaps = (state: MapStoreState): LocationNode[] =>
  state.mapState.locations.filter((l) => l.locationLevel === 1);

export const selectRegions = (state: MapStoreState, mapId?: string): LocationNode[] => {
  const regions = state.mapState.locations.filter((l) => l.locationLevel === 2);
  if (mapId) return regions.filter((l) => l.parentLocationId === mapId);
  return regions;
};

export const selectSubLocations = (state: MapStoreState, parentLocationId?: string): LocationNode[] => {
  const subLocations = state.mapState.locations.filter((l) => l.locationLevel === 3);
  if (parentLocationId) return subLocations.filter((l) => l.parentLocationId === parentLocationId);
  return subLocations;
};

export const selectCurrentMap = (state: MapStoreState): LocationNode | undefined => {
  const { locations, currentLocationId } = state.mapState;
  const currentLoc = currentLocationId
    ? locations.find((l) => l.id === currentLocationId)
    : locations.find((l) => l.current);
  if (!currentLoc) return undefined;
  if (currentLoc.locationLevel === 1) return currentLoc;
  const ancestor = findAncestorAtLevel(locations, currentLoc, 1);
  return ancestor;
};

function findAncestorAtLevel(locations: LocationNode[], loc: LocationNode, targetLevel: number): LocationNode | undefined {
  let current = loc;
  const visited = new Set<string>();
  while (current.parentLocationId) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    const parent = locations.find((l) => l.id === current.parentLocationId);
    if (!parent) return undefined;
    if (parent.locationLevel === targetLevel) return parent;
    current = parent;
  }
  return current.locationLevel === targetLevel ? current : undefined;
}

export const selectCurrentRegion = (state: MapStoreState): LocationNode | undefined => {
  const { locations, currentLocationId } = state.mapState;
  const currentLoc = currentLocationId
    ? locations.find((l) => l.id === currentLocationId)
    : locations.find((l) => l.current);
  if (!currentLoc) return undefined;
  if (currentLoc.locationLevel === 2) return currentLoc;
  if (currentLoc.locationLevel === 3) {
    const parent = locations.find((l) => l.id === currentLoc.parentLocationId);
    return parent?.locationLevel === 2 ? parent : undefined;
  }
  return undefined;
};

export const selectCurrentRegionChildren = (state: MapStoreState): LocationNode[] => {
  const { locations, currentLocationId } = state.mapState;
  const currentLoc = currentLocationId
    ? locations.find((l) => l.id === currentLocationId)
    : locations.find((l) => l.current);
  if (!currentLoc) return [];
  if (currentLoc.locationLevel === 2) {
    return locations.filter((l) => l.parentLocationId === currentLoc.id);
  }
  if (currentLoc.locationLevel === 3 && currentLoc.parentLocationId) {
    return locations.filter((l) => l.parentLocationId === currentLoc.parentLocationId);
  }
  return [];
};

export const selectAdjacentRegions = (state: MapStoreState): LocationNode[] => {
  const { locations, connections, currentLocationId } = state.mapState;
  if (!currentLocationId) return [];
  const currentLoc = locations.find((l) => l.id === currentLocationId);
  const currentParentLocationId = currentLoc?.parentLocationId;
  const neighborIds = new Set<string>();
  for (const conn of connections) {
    if (conn.from === currentLocationId) neighborIds.add(conn.to);
    if (conn.to === currentLocationId) neighborIds.add(conn.from);
  }
  const adjacentRegionIds = new Set<string>();
  if (currentParentLocationId) adjacentRegionIds.add(currentParentLocationId);
  for (const id of neighborIds) {
    const loc = locations.find((l) => l.id === id);
    if (loc?.parentLocationId) adjacentRegionIds.add(loc.parentLocationId);
  }
  adjacentRegionIds.delete(currentParentLocationId ?? '');
  return locations.filter((l) => adjacentRegionIds.has(l.id));
};

export { initialMap };
