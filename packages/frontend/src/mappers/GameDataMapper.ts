import type { Character, FrontendInventoryItem, Quest, FrontendNPCInfo } from '@/types';
import type { CompleteSaveData } from '@/api/saveApi';
import { mapCharacterData } from './characterMapper';
import { mapInventoryData } from './inventoryMapper';
import { mapSkillsData, type GameCharacterSkill } from './skillsMapper';
import { mapQuestsData } from './questsMapper';
import { mapNPCsData } from './npcsMapper';
import { mapLocationData, type LocationMappingResult } from './locationsMapper';

export interface SaveDataMappingResult {
  player: Character | null;
  inventory: FrontendInventoryItem[];
  equipment: FrontendInventoryItem[];
  skills: GameCharacterSkill[];
  quests: Quest[];
  npcInfoList: FrontendNPCInfo[];
  locationData: LocationMappingResult;
}

export interface InitResponseMappingResult {
  player: Character | null;
  inventory: FrontendInventoryItem[];
  skills: GameCharacterSkill[];
  quests: Quest[];
  npcInfoList: FrontendNPCInfo[];
  locationData: LocationMappingResult;
}

/**
 * 统一的游戏数据映射服务，封装所有后端数据到前端格式的转换逻辑。
 * 消除 initializeGame 和 loadSave 中的重复映射代码。
 */
export class GameDataMapper {
  /**
   * 将完整的存档数据映射为前端可用的格式（用于 loadSave）
   */
  static mapSaveData(saveData: CompleteSaveData): SaveDataMappingResult {
    const saveId = saveData.id;

    const player = saveData.character
      ? mapCharacterData(saveData.character as unknown as Record<string, unknown>, { saveId })
      : null;

    const inventory = saveData.inventory
      ? mapInventoryData(saveData.inventory as unknown as Record<string, unknown>[], saveId)
      : [];

    const equipment = saveData.equipment
      ? mapInventoryData(
          Array.isArray(saveData.equipment)
            ? saveData.equipment as unknown as Record<string, unknown>[]
            : Object.values(saveData.equipment as Record<string, unknown>) as unknown as Record<string, unknown>[],
          saveId
        )
      : [];

    const skills = saveData.skills
      ? mapSkillsData(saveData.skills as unknown as Record<string, unknown>[])
      : [];

    const quests = (saveData.quests && Array.isArray(saveData.quests))
      ? mapQuestsData(saveData.quests as unknown as Record<string, unknown>[], saveId)
      : [];

    const locationLookup = GameDataMapper.buildLocationLookup(saveData.locations);
    const npcInfoList = (saveData.npcs && Array.isArray(saveData.npcs))
      ? mapNPCsData(saveData.npcs as Record<string, unknown>[], locationLookup)
      : [];

    const locationData = mapLocationData(saveData as unknown as Record<string, unknown>);

    return { player, inventory, equipment, skills, quests, npcInfoList, locationData };
  }

  /**
   * 将初始化响应中的存档数据映射为前端可用的格式（用于 initializeGame）
   */
  static mapInitResponseData(
    saveData: Record<string, unknown>,
    saveId: string,
    characterOverrides?: Partial<Character>
  ): InitResponseMappingResult {
    const player = saveData.character
      ? mapCharacterData(saveData.character as Record<string, unknown>, { saveId, overrides: characterOverrides })
      : null;

    const inventory = saveData.inventory
      ? mapInventoryData(saveData.inventory as Record<string, unknown>[], saveId)
      : [];

    const skills = saveData.skills
      ? mapSkillsData(saveData.skills as Record<string, unknown>[])
      : [];

    const quests = (saveData.quests && Array.isArray(saveData.quests))
      ? mapQuestsData(saveData.quests as Record<string, unknown>[], saveId)
      : [];

    const locationLookup = GameDataMapper.buildLocationLookup(saveData.locations);
    const npcInfoList = (saveData.npcs && Array.isArray(saveData.npcs))
      ? mapNPCsData(saveData.npcs as Record<string, unknown>[], locationLookup)
      : [];

    const locationData = mapLocationData(saveData);

    return { player, inventory, skills, quests, npcInfoList, locationData };
  }

  /**
   * 从 locations 数组构建 id -> name 的查找表
   */
  static buildLocationLookup(locations: unknown): Map<string, string> {
    const lookup = new Map<string, string>();
    if (Array.isArray(locations)) {
      for (const loc of locations as Record<string, unknown>[]) {
        if (loc.id && loc.name) lookup.set(loc.id as string, loc.name as string);
      }
    }
    return lookup;
  }
}
