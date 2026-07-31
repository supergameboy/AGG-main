import type { LocationNode, LocationConnection } from '@/stores/mapStore';
import type { LocationLevel } from '@ai-rpg/shared';

export interface LocationMappingResult {
  locations: LocationNode[];
  connections: LocationConnection[];
  discoveredLocationIds: string[];
}

export function mapLocationData(saveData: Record<string, unknown>): LocationMappingResult {
  const rawLocations = Array.isArray(saveData.locations)
    ? (saveData.locations as Record<string, unknown>[])
    : [];

  const locations: LocationNode[] = rawLocations.map((loc) => ({
    id: loc.id as string,
    name: (loc.name as string) ?? '',
    description: (loc.description as string) ?? '',
    type: (loc.type as string) ?? 'poi',
    parentLocationId: (loc.parent_location_id as string) ?? (loc.parentLocationId as string) ?? undefined,
    locationLevel: (loc.location_level as LocationLevel) ?? undefined,
    x: (loc.x as number) ?? 0,
    y: (loc.y as number) ?? 0,
    discovered: Boolean(loc.is_explored ?? loc.is_discovered),
    customData: loc.customData as Record<string, unknown> | undefined,
  }));

  const connections = Array.isArray(saveData.location_connections)
    ? (saveData.location_connections as Record<string, unknown>[]).map((conn) => ({
        from: conn.from_location_id as string,
        to: conn.to_location_id as string,
        connectionType: (conn.connection_type as string) ?? 'normal',
        distance: (conn.distance as number) ?? 1,
        travelTime: (conn.distance as number) ?? 1,
      }))
    : [];

  const discoveredLocationIds = Array.isArray(saveData.discovered_locations)
    ? (saveData.discovered_locations as Record<string, unknown>[]).map(
        (dl) => dl.location_id as string
      )
    : [];

  return { locations, connections, discoveredLocationIds };
}
