import { useMemo } from 'react';
import { MarkerType, type Node, Edge } from '@xyflow/react';
import type { LocationNodeData, PathEdgeData } from './types';
import { radialLayout, type LocationHierarchy } from './radialLayout';
import { aggregateRegionConnections } from './aggregateRegionConnections';
import type { FrontendMapLocation, FrontendMapConnection } from '@/types';

export function useMapFlowData(
  locations: FrontendMapLocation[],
  connections: FrontendMapConnection[],
  currentLocationId?: string,
  discoveredLocationIds?: string[],
  selectedId?: string | null,
  regionOnly?: boolean
): { nodes: Node<LocationNodeData>[]; edges: Edge<PathEdgeData>[] } {
  return useMemo(() => {
    const discoveredSet = new Set<string>(discoveredLocationIds ?? []);
    locations.forEach((loc) => {
      if (loc.discovered) discoveredSet.add(loc.id);
    });

    const hierarchy = new Map<string, LocationHierarchy>();
    for (const loc of locations) {
      const childIds = locations
        .filter((child) => child.parentLocationId === loc.id)
        .map((child) => child.id);
      hierarchy.set(loc.id, {
        parentLocationId: loc.parentLocationId,
        childIds: childIds.length > 0 ? childIds : undefined,
      });
    }

    const filteredLocations = regionOnly
      ? locations.filter((loc) => loc.locationLevel === 2 || (!loc.locationLevel && !loc.parentLocationId))
      : locations;

    const locationMap = new Map(filteredLocations.map((loc) => [loc.id, loc]));
    const ids = filteredLocations.map((loc) => loc.id);

    const filteredConnections = regionOnly
      ? aggregateRegionConnections(connections, locations)
      : connections;

    const positions = radialLayout(ids, filteredConnections, currentLocationId, undefined, hierarchy);

    const nodes: Node<LocationNodeData>[] = filteredLocations.map((loc) => {
      const isCurrent = loc.id === currentLocationId || loc.current === true;
      const isDiscovered = discoveredSet.has(loc.id);
      const nodeType = isCurrent ? 'current' : isDiscovered ? 'discovered' : 'undiscovered';
      const pos = positions.get(loc.id) ?? { x: 0, y: 0 };
      const h = hierarchy.get(loc.id);

      return {
        id: loc.id,
        type: nodeType,
        position: pos,
        data: {
          id: loc.id,
          name: loc.name,
          description: loc.description,
          type: loc.type,
          parentLocationId: loc.parentLocationId,
          childIds: h?.childIds,
          dangerLevel: loc.dangerLevel,
          discovered: isDiscovered,
          current: isCurrent,
          travelTime: loc.customData?.travelTime as number | undefined,
          customData: loc.customData,
        },
        selected: loc.id === selectedId,
      };
    });

    const seenEdges = new Set<string>();
    const edges: Edge<PathEdgeData>[] = [];

    for (const conn of filteredConnections) {
      const [sortedFrom, sortedTo] =
        conn.from < conn.to ? [conn.from, conn.to] : [conn.to, conn.from];
      const dedupKey = `${sortedFrom}-${sortedTo}`;

      if (seenEdges.has(dedupKey)) continue;
      seenEdges.add(dedupKey);

      const fromLoc = locationMap.get(conn.from);
      const toLoc = locationMap.get(conn.to);
      if (!fromLoc || !toLoc) continue;

      const isOneWay = conn.connectionType === 'one_way';
      edges.push({
        id: `edge-${sortedFrom}-${sortedTo}`,
        source: conn.from,
        target: conn.to,
        type: 'path',
        data: {
          travelTime: conn.travelTime,
          isOneWay,
          direction: conn.direction,
        },
        style: { stroke: 'var(--border-primary)', strokeWidth: 1.5 },
        markerEnd: isOneWay ? { type: MarkerType.ArrowClosed, color: 'var(--border-primary)' } : undefined,
      });
    }

    return { nodes, edges };
  }, [locations, connections, currentLocationId, discoveredLocationIds, selectedId, regionOnly]);
}
