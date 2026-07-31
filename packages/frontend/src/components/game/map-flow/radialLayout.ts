export interface RadialLayoutOptions {
  baseRadius?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  childRadius?: number;
}

export interface LocationHierarchy {
  parentLocationId?: string;
  childIds?: string[];
}

export function radialLayout(
  locationIds: string[],
  connections: Array<{ from: string; to: string }>,
  currentLocationId: string | undefined,
  options?: RadialLayoutOptions,
  hierarchy?: Map<string, LocationHierarchy>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (locationIds.length === 0) return positions;

  const baseRadius = options?.baseRadius ?? 200;
  const childRadius = options?.childRadius ?? 120;

  const idSet = new Set(locationIds);
  const adjList = new Map<string, string[]>();
  for (const id of locationIds) {
    adjList.set(id, []);
  }
  for (const conn of connections) {
    if (idSet.has(conn.from) && idSet.has(conn.to)) {
      adjList.get(conn.from)!.push(conn.to);
      adjList.get(conn.to)!.push(conn.from);
    }
  }

  const hasHierarchy = hierarchy && hierarchy.size > 0;
  const parentLocations = hasHierarchy
    ? locationIds.filter((id) => {
        const h = hierarchy!.get(id);
        return h && h.childIds && h.childIds.length > 0;
      })
    : [];
  const childLocations = hasHierarchy
    ? locationIds.filter((id) => {
        const h = hierarchy!.get(id);
        return h && h.parentLocationId;
      })
    : [];

  if (hasHierarchy && parentLocations.length > 0) {
    return hierarchicalLayout(
      locationIds,
      connections,
      currentLocationId,
      hierarchy!,
      parentLocations,
      childLocations,
      baseRadius,
      childRadius
    );
  }

  return flatRadialLayout(locationIds, connections, currentLocationId, baseRadius);
}

function hierarchicalLayout(
  locationIds: string[],
  connections: Array<{ from: string; to: string }>,
  currentLocationId: string | undefined,
  hierarchy: Map<string, LocationHierarchy>,
  parentLocations: string[],
  childLocations: string[],
  baseRadius: number,
  childRadius: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const orphanLocations = locationIds.filter(
    (id) => !parentLocations.includes(id) && !childLocations.includes(id)
  );

  const allTopLevel = [...parentLocations, ...orphanLocations];

  const idSet = new Set(locationIds);
  const topConnections = connections.filter(
    (c) => idSet.has(c.from) && idSet.has(c.to)
  );

  const topPositions = flatRadialLayout(
    allTopLevel,
    topConnections,
    currentLocationId ? findTopLevelParent(currentLocationId, hierarchy) : undefined,
    baseRadius
  );

  for (const [id, pos] of topPositions) {
    positions.set(id, pos);
  }

  for (const parentId of parentLocations) {
    const parentPos = positions.get(parentId);
    if (!parentPos) continue;

    const h = hierarchy.get(parentId);
    if (!h?.childIds) continue;

    const validChildren = h.childIds.filter((id) => idSet.has(id));
    if (validChildren.length === 0) continue;

    const parentAngle = Math.atan2(parentPos.y, parentPos.x);

    const angleSpan = Math.min(Math.PI, (Math.PI * 2) / Math.max(parentLocations.length, 1));
    const startAngle = parentAngle - angleSpan / 2;

    for (let i = 0; i < validChildren.length; i++) {
      const fraction = validChildren.length === 1 ? 0.5 : i / (validChildren.length - 1);
      const angle = startAngle + fraction * angleSpan;
      positions.set(validChildren[i], {
        x: parentPos.x + childRadius * Math.cos(angle),
        y: parentPos.y + childRadius * Math.sin(angle),
      });
    }
  }

  return positions;
}

function findTopLevelParent(
  locationId: string,
  hierarchy: Map<string, LocationHierarchy>
): string {
  let current = locationId;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) break;
    visited.add(current);
    const h = hierarchy.get(current);
    if (!h?.parentLocationId) break;
    current = h.parentLocationId;
  }
  return current;
}

function flatRadialLayout(
  locationIds: string[],
  connections: Array<{ from: string; to: string }>,
  currentLocationId: string | undefined,
  baseRadius: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (locationIds.length === 0) return positions;

  const idSet = new Set(locationIds);
  const adjList = new Map<string, string[]>();
  for (const id of locationIds) {
    adjList.set(id, []);
  }
  for (const conn of connections) {
    if (idSet.has(conn.from) && idSet.has(conn.to)) {
      adjList.get(conn.from)!.push(conn.to);
      adjList.get(conn.to)!.push(conn.from);
    }
  }

  const rootId = currentLocationId ?? locationIds[0];
  positions.set(rootId, { x: 0, y: 0 });

  const visited = new Set<string>([rootId]);
  const hops = new Map<string, number>([[rootId, 0]]);
  const parents = new Map<string, string>();
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentHop = hops.get(current)!;
    for (const neighbor of adjList.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        hops.set(neighbor, currentHop + 1);
        parents.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  const rings = new Map<number, string[]>();
  for (const [id, hop] of hops) {
    if (hop === 0) continue;
    if (!rings.has(hop)) rings.set(hop, []);
    rings.get(hop)!.push(id);
  }

  const isolatedNodes = locationIds.filter((id) => !visited.has(id));
  if (isolatedNodes.length > 0) {
    const maxHop = Math.max(0, ...Array.from(hops.values()));
    const outerHop = maxHop + 1;
    rings.set(outerHop, isolatedNodes);
    for (const id of isolatedNodes) {
      hops.set(id, outerHop);
    }
  }

  const parentAngles = new Map<string, number>();
  parentAngles.set(rootId, 0);

  for (const [hop, nodeIds] of rings) {
    const radius = baseRadius * hop;

    const groups = new Map<string, string[]>();
    for (const id of nodeIds) {
      const parentId = parents.get(id);
      const groupKey = parentId ?? '__isolated__';
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(id);
    }

    const totalInRing = nodeIds.length;
    const sectorAngle = (2 * Math.PI) / totalInRing;

    for (const [, groupIds] of groups) {
      const parentId = parents.get(groupIds[0]);
      const parentAngle = parentId ? (parentAngles.get(parentId) ?? 0) : 0;

      for (let i = 0; i < groupIds.length; i++) {
        const localOffset = (i - (groupIds.length - 1) / 2) * sectorAngle;
        const angle = parentAngle + localOffset;
        positions.set(groupIds[i], {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
        });
        parentAngles.set(groupIds[i], angle);
      }
    }
  }

  return positions;
}
