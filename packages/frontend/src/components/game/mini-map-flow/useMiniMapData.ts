import { useMemo } from 'react';
import { useMapStore, selectCurrentRegionChildren } from '@/stores/mapStore';
import type { ChildLocationNodeData, EntryPointNodeData } from './types';

export function useMiniMapData() {
  const children = useMapStore(selectCurrentRegionChildren);
  const mapState = useMapStore((s) => s.mapState);

  return useMemo(() => {
    const { connections, currentLocationId, locations } = mapState;
    if (!currentLocationId) {
      return { childNodes: [], entryNodes: [], childEdges: [] };
    }

    const currentLoc = locations.find((l) => l.id === currentLocationId);
    const parentLocationId = currentLoc?.parentLocationId;
    const regionId = parentLocationId ?? currentLocationId;

    const childNodes: ChildLocationNodeData[] = children.map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      isCurrentLocation: loc.id === currentLocationId,
      parentLocationId: loc.parentLocationId,
    }));

    const childLocationIds = new Set(children.map((c) => c.id));
    const adjacentRegionConnections = connections.filter((c) => {
      const fromIsChild = childLocationIds.has(c.from);
      const toIsChild = childLocationIds.has(c.to);
      return (fromIsChild && !toIsChild) || (toIsChild && !fromIsChild);
    });

    const entryPointMap = new Map<string, { regionId: string; regionName: string; direction: string }>();
    for (const conn of adjacentRegionConnections) {
      const isOutgoing = childLocationIds.has(conn.from);
      const externalId = isOutgoing ? conn.to : conn.from;

      const externalLoc = locations.find((l) => l.id === externalId);
      const externalRegionId = externalLoc?.parentLocationId ?? externalId;
      const externalRegion = locations.find((l) => l.id === externalRegionId);

      if (externalRegionId !== regionId && !entryPointMap.has(externalRegionId)) {
        entryPointMap.set(externalRegionId, {
          regionId: externalRegionId,
          regionName: externalRegion?.name ?? '???',
          direction: conn.direction ?? (isOutgoing ? '东' : '西'),
        });
      }
    }

    const entryNodes: EntryPointNodeData[] = Array.from(entryPointMap.values()).map((ep) => ({
      id: `entry-${ep.regionId}`,
      name: `entry-${ep.regionId}`,
      regionName: ep.regionName,
      direction: ep.direction,
    }));

    const childEdges: Array<{ id: string; from: string; to: string; isEntryEdge: boolean }> = [];

    const internalConns = connections.filter(
      (c) => childLocationIds.has(c.from) && childLocationIds.has(c.to)
    );
    const seenInternal = new Set<string>();
    for (const conn of internalConns) {
      const key = conn.from < conn.to ? `${conn.from}-${conn.to}` : `${conn.to}-${conn.from}`;
      if (!seenInternal.has(key)) {
        seenInternal.add(key);
        childEdges.push({
          id: `edge-${key}`,
          from: conn.from,
          to: conn.to,
          isEntryEdge: false,
        });
      }
    }

    const seenEntry = new Set<string>();
    for (const conn of adjacentRegionConnections) {
      const isOutgoing = childLocationIds.has(conn.from);
      const fromChildId = isOutgoing ? conn.from : conn.to;
      const externalId = isOutgoing ? conn.to : conn.from;
      const externalLoc = locations.find((l) => l.id === externalId);
      const externalRegionId = externalLoc?.parentLocationId ?? externalId;
      const entryKey = `${fromChildId}-${externalRegionId}`;

      if (entryPointMap.has(externalRegionId) && !seenEntry.has(entryKey)) {
        seenEntry.add(entryKey);
        childEdges.push({
          id: `edge-entry-${entryKey}`,
          from: fromChildId,
          to: `entry-${externalRegionId}`,
          isEntryEdge: true,
        });
      }
    }

    return { childNodes, entryNodes, childEdges };
  }, [children, mapState]);
}
