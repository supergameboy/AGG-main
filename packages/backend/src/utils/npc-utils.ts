/**
 * Normalize explicit NPC ID: trim, reject 'n/a' and 'all', return undefined for invalid values
 */
export function normalizeExplicitNpcId(npcId: string | undefined): string | undefined {
  if (typeof npcId !== 'string') {
    return undefined;
  }

  const trimmed = npcId.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'n/a' || normalized === 'all') {
    return undefined;
  }

  return trimmed;
}
