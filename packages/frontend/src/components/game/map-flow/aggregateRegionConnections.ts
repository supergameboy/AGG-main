import type { FrontendMapLocation, FrontendMapConnection } from '@/types';

export function aggregateRegionConnections(
  connections: FrontendMapConnection[],
  locations: FrontendMapLocation[],
): FrontendMapConnection[] {
  const locationMap = new Map<string, FrontendMapLocation>(
    locations.map((l) => [l.id, l]),
  );

  const getTopLevelParentId = (locationId: string): string | undefined => {
    const loc = locationMap.get(locationId);
    if (!loc) return undefined;
    if (loc.locationLevel === 1) return loc.id;
    return loc.parentLocationId ? getTopLevelParentId(loc.parentLocationId) : loc.id;
  };

  const seen = new Set<string>();
  const result: FrontendMapConnection[] = [];

  for (const conn of connections) {
    const fromTop = getTopLevelParentId(conn.from);
    const toTop = getTopLevelParentId(conn.to);

    if (!fromTop || !toTop || fromTop === toTop) continue;

    const key =
      fromTop < toTop ? `${fromTop}-${toTop}` : `${toTop}-${fromTop}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      from: fromTop,
      to: toTop,
      direction: conn.direction,
      connectionType: conn.connectionType,
      distance: conn.distance,
      travelTime: conn.travelTime,
    });
  }

  return result;
}
