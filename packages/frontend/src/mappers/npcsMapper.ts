import type { FrontendNPCInfo, NPCVisibility } from '@/types';
import type { DriveProfile, NPCGoal, NPCInventoryItem, NPCSkill } from '@ai-rpg/shared';

export function mapNPCsData(rawNpcs: Record<string, unknown>[], locationLookup: Map<string, string>): FrontendNPCInfo[] {
  return rawNpcs.map((npc) => {
    const locationId = (npc.location_id as string) ?? (npc.location as string | undefined);
    const locationName = locationId ? (locationLookup.get(locationId) || locationId) : undefined;
    return {
      id: npc.id as string,
      name: (npc.name as string) ?? '',
      role: (npc.role as string) ?? 'neutral',
      location: locationName,
      locationId: locationId ?? undefined,
      inParty: Boolean(npc.in_party ?? npc.inParty),
      affinity: (npc.reputation as number) ?? (npc.affinity as number) ?? 0,
      relation: (npc.relation as string) ?? undefined,
      services: Array.isArray(npc.services)
        ? (npc.services as string[])
        : typeof npc.services === 'string'
          ? (() => { try { return JSON.parse(npc.services as string); } catch { return []; } })()
          : [],
      level: (npc.level as number) ?? undefined,
      description: (npc.description as string) || undefined,
      mood: (npc.mood as number) ?? undefined,
      race: (npc.race as string) || undefined,
      title: (npc.title as string) || undefined,
      currency: typeof npc.currency === 'string'
        ? (() => { try { return JSON.parse(npc.currency as string); } catch { return undefined; } })()
        : (npc.currency as Record<string, number> | undefined),
      attributes: typeof npc.attributes === 'string'
        ? (() => { try { return JSON.parse(npc.attributes as string); } catch { return undefined; } })()
        : (npc.attributes as Record<string, unknown> | undefined),
      derivedAttributes: typeof npc.derived_attributes === 'string'
        ? (() => { try { return JSON.parse(npc.derived_attributes as string); } catch { return undefined; } })()
        : typeof npc.derivedAttributes === 'string'
          ? (() => { try { return JSON.parse(npc.derivedAttributes as string); } catch { return undefined; } })()
          : (npc.derivedAttributes as Record<string, unknown> | undefined),
      currentHp: (npc.current_hp as number | null) ?? (npc.currentHp as number | null) ?? undefined,
      maxHp: (npc.max_hp as number | null) ?? (npc.maxHp as number | null) ?? undefined,
      currentMp: (npc.current_mp as number | null) ?? (npc.currentMp as number | null) ?? undefined,
      maxMp: (npc.max_mp as number | null) ?? (npc.maxMp as number | null) ?? undefined,
      driveProfile: npc.driveProfile as DriveProfile | undefined,
      goals: npc.goals as NPCGoal[] | undefined,
      inventory: (npc.inventory as NPCInventoryItem[] | undefined) ?? [],
      skills: (npc.skills as NPCSkill[] | undefined) ?? [],
      customData: npc.customData as Record<string, unknown> | undefined,
      visible: npc.visible !== false,
      attrInitialized: Boolean(npc.attr_initialized ?? npc.attrInitialized ?? false),
      invInitialized: Boolean(npc.inv_initialized ?? npc.invInitialized ?? false),
      skillInitialized: Boolean(npc.skill_initialized ?? npc.skillInitialized ?? false),
      visibility: (npc.visibility as NPCVisibility | undefined) ?? undefined,
    };
  });
}
