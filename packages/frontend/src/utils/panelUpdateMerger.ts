import type {
  PanelUpdates,
  CharacterUpdate,
  InventoryUpdate,
  InventoryItemData,
  QuestUpdate,
  QuestData,
  LocationUpdate,
  LocationPanelData,
  LocationConnectionData,
  CombatUpdate,
  CombatEnemyData,
  SkillsUpdate,
  SkillData,
  NPCUpdate,
  NPCData,
  DialogueUpdate,
} from '@ai-rpg/shared';
import type { FrontendInventoryItem } from '@/types';
import { parseCostArray } from '@ai-rpg/shared';
import { parseJsonField } from '@/mappers/inventoryMapper';
import { filterByOwnerType, findEntityByIdOrName, assertOwnerType } from '@/utils/entityFilter';
import type {
  FrontendCombatEnemy,
  FrontendCombatLog,
  FrontendCombatState,
  FrontendLocation,
  FrontendLocationConnection,
  FrontendLocationState,
  FrontendCharacterSkill,
  FrontendNPCInfo,
} from '@/types';

type CombatEnemy = FrontendCombatEnemy;
type CombatLog = FrontendCombatLog;
type CombatState = FrontendCombatState;
type LocationNodeType = FrontendLocation;
type LocationConnectionType = FrontendLocationConnection;
type LocationStateType = FrontendLocationState;
type GameCharacterSkill = FrontendCharacterSkill;
type NPCInfo = FrontendNPCInfo;

type EntityIdKind = 'generic' | 'inventory' | 'quest' | 'mapLocation' | 'combatEnemy' | 'skill' | 'npc';

// 后端 generateReadableId(source, name) 生成格式: {source}_{name}_{timestamp}_{counter}
// 示例: item_生锈的铁剑_1779785527271_0, quest_村长的委托_1779785551112_1
// name 中可含中文(\u4e00-\u9fff)、字母、数字、下划线
// 通用 readable ID（用于 generic 类型）
const READABLE_ID_RE = /^[a-z]+_[\w\u4e00-\u9fff]+_\d+_\d+$/i;

// 按前缀精确匹配的 readable ID（用于具体实体类型）
function readableIdWithPrefix(prefix: string, id: string): boolean {
  return new RegExp(`^${prefix}_[\\w\\u4e00-\\u9fff]+_\\d+_\\d+$`, 'i').test(id);
}

// 旧 UUID 格式（已废弃，保留兼容）
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');

// enemy-{idx} 格式（CombatService fallback）
const ENEMY_ID_RE = /^enemy-\d+$/i;

// slug 格式（模板预定义ID，如 village-square）
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i;

// save-scoped 格式
const SAVE_SCOPED_ID_RE = /^save-[a-z0-9-]+(?:-[a-z0-9]+)+$/i;

// 占位符ID（始终拒绝）
const PLACEHOLDER_ID_RE = /^(undefined|null|temp|placeholder)$/i;

function normalizeEntityId(id: string | undefined): string | null {
  if (typeof id !== 'string') return null;
  const normalizedId = id.trim();
  if (normalizedId === '' || PLACEHOLDER_ID_RE.test(normalizedId)) {
    return null;
  }
  return normalizedId;
}

function matchesEntityIdKind(kind: EntityIdKind, id: string): boolean {
  switch (kind) {
    case 'inventory':
      // 后端: item_{name}_{timestamp}
      return readableIdWithPrefix('item', id) || UUID_RE.test(id);
    case 'quest':
      // 后端: quest_{name}_{timestamp}
      return readableIdWithPrefix('quest', id) || UUID_RE.test(id);
    case 'mapLocation':
      // 后端: loc_{name}_{timestamp} 或 slug (模板预定义)
      return readableIdWithPrefix('loc', id) || UUID_RE.test(id) || SAVE_SCOPED_ID_RE.test(id) || SLUG_RE.test(id);
    case 'combatEnemy':
      // 后端: enemy-{idx} (fallback) 或来自输入的任意ID
      return ENEMY_ID_RE.test(id) || READABLE_ID_RE.test(id) || UUID_RE.test(id);
    case 'skill':
      // 后端: skill_{name}_{timestamp} 或 custom_{name}_{timestamp}
      return readableIdWithPrefix('skill', id) || readableIdWithPrefix('custom', id) || UUID_RE.test(id);
    case 'npc':
      // 后端: npc_{name}_{timestamp}
      return readableIdWithPrefix('npc', id) || UUID_RE.test(id) || SAVE_SCOPED_ID_RE.test(id);
    case 'generic':
      return (
        READABLE_ID_RE.test(id) ||
        UUID_RE.test(id) ||
        ENEMY_ID_RE.test(id) ||
        SAVE_SCOPED_ID_RE.test(id) ||
        SLUG_RE.test(id)
      );
  }
}

export function isValidEntityIdFor(kind: EntityIdKind, id: string | undefined): boolean {
  const normalizedId = normalizeEntityId(id);
  if (normalizedId && matchesEntityIdKind(kind, normalizedId)) {
    return true;
  }
  console.warn('[panelUpdateMerger] Invalid entity ID rejected:', { kind, id });
  return false;
}

export function isValidEntityId(id: string | undefined): boolean {
  return isValidEntityIdFor('generic', id);
}

interface CharacterLike {
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  experience: number;
  level: number;
  gold: number;
  currency?: Record<string, number>;
  attributes?: Record<string, number>;
  statusEffects?: string[];
  [key: string]: unknown;
}

export interface MergeableState {
  player: CharacterLike | null;
  inventory: FrontendInventoryItem[];
  quests: Array<{ id: string; [key: string]: unknown }>;
  combat?: CombatState;
  mapState?: LocationStateType;
  skills: GameCharacterSkill[];
  npcInfoList: NPCInfo[];
}

export interface SubStoreHandlers {
  onCombatUpdate?: (update: CombatUpdate) => void;
  onLocationUpdate?: (update: LocationUpdate) => void;
  /** @deprecated Use onLocationUpdate */
  onMapUpdate?: (update: LocationUpdate) => void;
  /**
   * 对话面板更新回调（设计 5.6）。
   * dialogue 数据由 useDialogueStore 独立管理，不写入 MergeableState。
   * 后端通过 panelUpdates.dialogue 推送，前端按 addedMessages 逐条添加、options 覆盖。
   */
  onDialogueUpdate?: (update: DialogueUpdate) => void;
}

export function applyPanelUpdates(state: MergeableState, updates: PanelUpdates, subStoreHandlers?: SubStoreHandlers): void {
  if (updates.character) {
    mergeCharacterUpdate(state, updates.character);
  }
  if (updates.inventory) {
    mergeInventoryUpdate(state, updates.inventory);
  }
  if (updates.quest) {
    mergeQuestUpdate(state, updates.quest);
  }
  const locationUpdate = updates.location ?? updates.map;
  if (locationUpdate) {
    if (state.mapState) {
      mergeLocationUpdate(state, locationUpdate);
    } else if (subStoreHandlers?.onLocationUpdate) {
      subStoreHandlers.onLocationUpdate(sanitizeLocationUpdate(locationUpdate));
    } else if (subStoreHandlers?.onMapUpdate) {
      subStoreHandlers.onMapUpdate(sanitizeLocationUpdate(locationUpdate));
    }
  }
  if (updates.combat) {
    if (state.combat) {
      mergeCombatUpdate(state, updates.combat);
    } else if (subStoreHandlers?.onCombatUpdate) {
      subStoreHandlers.onCombatUpdate(sanitizeCombatUpdate(updates.combat));
    }
  }
  if (updates.skills) {
    mergeSkillsUpdate(state, updates.skills);
  }
  if (updates.npc) {
    mergeNPCUpdate(state, updates.npc);
  }
  // 统一面板变更推送机制：dialogue 委托到 subStoreHandlers.onDialogueUpdate（设计 5.7）
  // 不直接修改 state（dialogue 状态由 useDialogueStore 独立管理）
  if (updates.dialogue) {
    subStoreHandlers?.onDialogueUpdate?.(updates.dialogue);
  }
}

function mergeCharacterUpdate(state: MergeableState, update: CharacterUpdate): void {
  if (!state.player) return;

  if (update.currentHP !== undefined) state.player.currentHP = update.currentHP;
  if (update.maxHP !== undefined) state.player.maxHP = update.maxHP;
  if (update.currentMP !== undefined) state.player.currentMP = update.currentMP;
  if (update.maxMP !== undefined) state.player.maxMP = update.maxMP;
  if (update.exp !== undefined) state.player.experience = update.exp;
  if (update.level !== undefined) state.player.level = update.level;
  if (update.gold !== undefined) state.player.gold = update.gold;
  if (update.currency !== undefined) state.player.currency = update.currency;
  if (update.attributes && state.player.attributes) {
    Object.assign(state.player.attributes, update.attributes);
  }
  if (update.statusEffects !== undefined) {
    state.player.statusEffects = update.statusEffects;
  }
}

function mergeInventoryUpdate(state: MergeableState, update: InventoryUpdate): void {
  if (update.replace) {
    if (update.added && update.added.length > 0) {
      // §13.3 + 架构提升：白名单 filterByOwnerType 替代黑名单 !== 'npc'
      const characterItems = filterByOwnerType(update.added, 'character');
      state.inventory = characterItems
        .filter((itemData) => isValidEntityIdFor('inventory', itemData.id))
        .map(mapInventoryItemDataToNew);
    } else {
      state.inventory = [];
    }
    return;
  }

  if (update.removed && update.removed.length > 0) {
    const removeSet = new Set(update.removed);
    state.inventory = state.inventory.filter(
      (item) => !removeSet.has(item.id) && !removeSet.has(item.itemId)
    );
  }

  if (update.updated && update.updated.length > 0) {
    // §13.3: updated 路径新增 owner 过滤（修复前无过滤，NPC 物品可渗入）
    const characterUpdated = filterByOwnerType(update.updated, 'character');
    for (const itemData of characterUpdated) {
      const existing = state.inventory.find(
        (i) => i.id === itemData.id || i.itemId === itemData.itemId
      );
      if (existing) {
        mapInventoryItemDataToExisting(existing, itemData);
      } else if (isValidEntityIdFor('inventory', itemData.id)) {
        state.inventory.push(mapInventoryItemDataToNew(itemData));
      }
    }
  }

  if (update.added && update.added.length > 0) {
    // §13.3 + 架构提升：用 filterByOwnerType 替代 if (itemData.ownerType === 'npc') continue
    const characterAdded = filterByOwnerType(update.added, 'character');
    for (const itemData of characterAdded) {
      const existing = state.inventory.find(
        (i) => i.itemId === itemData.itemId
      );
      if (existing) {
        existing.quantity += itemData.quantity;
      } else if (isValidEntityIdFor('inventory', itemData.id)) {
        state.inventory.push(mapInventoryItemDataToNew(itemData));
      }
    }
  }
}

function mapInventoryItemDataToExisting(
  existing: FrontendInventoryItem,
  data: InventoryItemData
): void {
  if (data.name !== undefined) {
    existing.name = data.name;
  }
  if (data.description !== undefined) {
    existing.description = data.description;
  }
  if (data.quantity !== undefined) existing.quantity = data.quantity;
  if (data.equipped !== undefined) {
    existing.equipped = data.equipped;
    if (!data.equipped) {
      existing.equippedSlot = null;
    }
  }
  if (data.equippedSlot !== undefined) {
    existing.equippedSlot = data.equippedSlot ?? null;
    if (data.equippedSlot) {
      existing.equipped = true;
    }
  }
  if (data.inventorySlot !== undefined) {
    existing.inventorySlot = data.inventorySlot;
  }
  if (data.quality !== undefined) {
    existing.quality = data.quality as import('@ai-rpg/shared').ItemQuality;
  }
  if (data.category !== undefined) {
    existing.category = data.category as import('@ai-rpg/shared').ItemCategory;
  }
  if (data.stats !== undefined) {
    existing.stats = parseJsonField<Record<string, number>>(data.stats, {});
  }
  if (data.effects !== undefined) {
    existing.effects = parseJsonField<Array<{ type: string; value: number; target?: string; duration?: number }>>(data.effects, []);
  }
  if (data.value !== undefined) {
    existing.value = parseJsonField<{ buy?: number; sell?: number; currency?: string }>(data.value, {});
  }
  if (data.tags !== undefined) {
    existing.tags = parseJsonField<string[]>(data.tags, []);
  }
  if (data.customData !== undefined) {
    existing.customData = parseJsonField<Record<string, unknown>>(data.customData, {});
  }
  if (data.ownerType !== undefined) {
    existing.ownerType = data.ownerType;
  }
  if (data.ownerId !== undefined) {
    existing.ownerId = data.ownerId;
  }
  if (data.poolId !== undefined) {
    existing.poolId = data.poolId;
  }
  if (data.saveId !== undefined) {
    existing.saveId = data.saveId;
  }
  if (data.visible !== undefined) {
    existing.visible = data.visible;
  }
  if (data.weight !== undefined) {
    existing.weight = data.weight;
  }
  if (data.durability !== undefined) {
    existing.durability = data.durability;
  }
  if (data.maxDurability !== undefined) {
    existing.maxDurability = data.maxDurability;
  }
  if (data.maxStack !== undefined) {
    existing.maxStack = data.maxStack;
  }
}

function mapInventoryItemDataToNew(data: InventoryItemData): FrontendInventoryItem {
  return {
    id: data.id,
    saveId: data.saveId ?? '',
    itemId: data.itemId,
    poolId: data.poolId ?? '',
    name: data.name,
    description: data.description ?? '',
    category: (data.category ?? 'misc') as import('@ai-rpg/shared').ItemCategory,
    quantity: data.quantity,
    quality: (data.quality ?? 'common') as import('@ai-rpg/shared').ItemQuality,
    durability: data.durability ?? 0,
    maxDurability: data.maxDurability ?? 0,
    inventorySlot: data.inventorySlot ?? null,
    equippedSlot: data.equippedSlot ?? null,
    equipped: data.equipped ?? false,
    weight: data.weight ?? 0,
    maxStack: data.maxStack ?? 1,
    stats: parseJsonField<Record<string, number>>(data.stats, {}),
    effects: parseJsonField<Array<{ type: string; value: number; target?: string; duration?: number }>>(data.effects, []),
    value: parseJsonField<{ buy?: number; sell?: number; currency?: string }>(data.value, {}),
    tags: parseJsonField<string[]>(data.tags, []),
    customData: parseJsonField<Record<string, unknown>>(data.customData, {}),
    visible: data.visible ?? true,
    // §13.3: ownerType 缺失即抛错，禁止 ?? 'character' 兜底
    ownerType: assertOwnerType(data.ownerType),
    ownerId: data.ownerId ?? '',
  } as FrontendInventoryItem;
}

function mergeQuestUpdate(
  state: MergeableState,
  update: QuestUpdate
): void {
  if (update.completed && update.completed.length > 0) {
    const completedSet = new Set(update.completed);
    for (const quest of state.quests) {
      if (completedSet.has(quest.id)) {
        quest.status = 'completed';
      }
    }
  }

  if (update.updated && update.updated.length > 0) {
    for (const questData of update.updated) {
      const existing = state.quests.find((q) => q.id === questData.id);
      if (existing) {
        mapQuestDataToExisting(existing, questData);
      } else if (isValidEntityIdFor('quest', questData.id)) {
        const normalized = mapQuestDataToNew(questData);
        if (normalized.id) {
          state.quests.push(normalized);
        }
      }
    }
  }

  if (update.added && update.added.length > 0) {
    for (const questData of update.added) {
      const existing = state.quests.find((q) => q.id === questData.id);
      if (!existing && isValidEntityIdFor('quest', questData.id)) {
        const normalized = mapQuestDataToNew(questData);
        if (normalized.id) {
          state.quests.push(normalized);
        }
      }
    }
  }
}

function mapQuestDataToExisting(
  existing: Record<string, unknown>,
  data: QuestData
): void {
  if (data.name !== undefined) existing.name = data.name;
  if (data.type !== undefined) existing.type = data.type;
  if (data.description !== undefined) existing.description = data.description;
  if (data.status !== undefined) existing.status = data.status;
  if (data.objectives !== undefined) {
    existing.objectives = data.objectives.map((obj) => ({
      id: obj.id,
      type: obj.type,
      description: obj.description,
      target: obj.target ?? '',
      current: obj.current,
      required: obj.required,
      completed: obj.completed,
      event_trigger: obj.eventTrigger,
    }));
  }
  if (data.rewards !== undefined) {
    existing.rewards = {
      experience: data.rewards.experience ?? 0,
      gold: data.rewards.gold ?? data.rewards.currency?.gold ?? 0,
      currency: data.rewards.currency,
      items: data.rewards.items,
      skills: data.rewards.skills,
    };
  }
  if (data.visible !== undefined) existing.visible = data.visible;
  if (data.giverNpcId !== undefined) existing.giver_npc_id = data.giverNpcId;
  if (data.giverLocationId !== undefined) existing.giver_location_id = data.giverLocationId;
  if (data.questChainId !== undefined) existing.quest_chain_id = data.questChainId;
  if (data.prerequisiteQuestIds !== undefined) existing.prerequisite_quest_ids = data.prerequisiteQuestIds;
  if (data.conditions !== undefined) existing.conditions = data.conditions;
  if (data.timeLimit !== undefined) existing.time_limit = data.timeLimit;
  if (data.customData !== undefined) {
    existing.custom_data = data.customData;
  }
  if (data.createdAt !== undefined) existing.created_at = data.createdAt;
  if (data.updatedAt !== undefined) existing.updated_at = data.updatedAt;
}

function mapQuestDataToNew(data: QuestData): { id: string; [key: string]: unknown } {
  if (data.description === undefined || data.description.trim() === '') {
    return {
      id: '',
    };
  }
  return {
    id: data.id,
    save_id: '',
    name: data.name,
    type: data.type,
    description: data.description,
    status: data.status,
    visible: data.visible ?? true,
    giver_npc_id: data.giverNpcId,
    giver_location_id: data.giverLocationId,
    quest_chain_id: data.questChainId,
    prerequisite_quest_ids: data.prerequisiteQuestIds ?? [],
    conditions: data.conditions,
    objectives: data.objectives.map((obj) => ({
      id: obj.id,
      type: obj.type,
      description: obj.description,
      target: obj.target ?? '',
      current: obj.current,
      required: obj.required,
      completed: obj.completed,
      event_trigger: obj.eventTrigger,
    })),
    rewards: {
      experience: data.rewards?.experience ?? 0,
      gold: data.rewards?.gold ?? data.rewards?.currency?.gold ?? 0,
      currency: data.rewards?.currency,
      items: data.rewards?.items,
      skills: data.rewards?.skills,
    },
    time_limit: data.timeLimit ?? 0,
    custom_data: data.customData,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
  };
}

function mergeLocationUpdate(state: MergeableState, update: LocationUpdate): void {
  if (!state.mapState) return;
  const sanitizedUpdate = sanitizeLocationUpdate(update);
  if (sanitizedUpdate.currentLocationId !== undefined) {
    state.mapState.currentLocationId = sanitizedUpdate.currentLocationId;
  }

  if (sanitizedUpdate.discoveredLocationIds && sanitizedUpdate.discoveredLocationIds.length > 0) {
    const existing = new Set(state.mapState.discoveredLocationIds);
    for (const id of sanitizedUpdate.discoveredLocationIds) {
      if (!existing.has(id)) {
        state.mapState.discoveredLocationIds.push(id);
      }
    }
    for (const loc of state.mapState.locations) {
      if (sanitizedUpdate.discoveredLocationIds.includes(loc.id)) {
        loc.discovered = true;
      }
    }
  }

  if (sanitizedUpdate.newLocations && sanitizedUpdate.newLocations.length > 0) {
    const existingIds = new Set(state.mapState.locations.map((l) => l.id));
    for (const locData of sanitizedUpdate.newLocations) {
      if (!existingIds.has(locData.id)) {
        state.mapState.locations.push(mapLocationPanelData(locData));
      }
    }
  }

  if (sanitizedUpdate.newConnections && sanitizedUpdate.newConnections.length > 0) {
    for (const connData of sanitizedUpdate.newConnections) {
      state.mapState.connections.push(mapLocationConnectionData(connData));
    }
  }
}

function sanitizeLocationUpdate(update: LocationUpdate): LocationUpdate {
  return {
    ...update,
    currentLocationId: isValidEntityIdFor('mapLocation', update.currentLocationId)
      ? update.currentLocationId
      : undefined,
    discoveredLocationIds: update.discoveredLocationIds?.filter((id) =>
      isValidEntityIdFor('mapLocation', id)
    ),
    newLocations: update.newLocations?.filter((locData) =>
      isValidEntityIdFor('mapLocation', locData.id)
    ),
  };
}

function sanitizeCombatUpdate(update: CombatUpdate): CombatUpdate {
  return {
    ...update,
    enemies: update.enemies?.filter((enemy) =>
      isValidEntityIdFor('combatEnemy', enemy.id)
    ),
  };
}

function mapLocationPanelData(data: LocationPanelData): LocationNodeType {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    type: data.type,
    parentLocationId: data.parentLocationId,
    locationLevel: data.locationLevel,
    x: data.x,
    y: data.y,
    discovered: true,
    dangerLevel: data.dangerLevel,
    customData: data.customData,
  };
}

function mapLocationConnectionData(data: LocationConnectionData): LocationConnectionType {
  return {
    from: data.from,
    to: data.to,
    direction: data.direction,
    connectionType: data.connectionType,
    distance: data.distance,
    travelTime: data.travelTime,
  };
}

function mergeCombatUpdate(state: MergeableState, update: CombatUpdate): void {
  if (!state.combat) return;
  const sanitizedUpdate = sanitizeCombatUpdate(update);
  if (sanitizedUpdate.active !== undefined) state.combat.active = sanitizedUpdate.active;
  if (sanitizedUpdate.playerHP !== undefined) state.combat.playerHP = sanitizedUpdate.playerHP;
  if (sanitizedUpdate.playerMaxHP !== undefined) state.combat.playerMaxHP = sanitizedUpdate.playerMaxHP;
  if (sanitizedUpdate.playerMP !== undefined) state.combat.playerMP = sanitizedUpdate.playerMP;
  if (sanitizedUpdate.playerMaxMP !== undefined) state.combat.playerMaxMP = sanitizedUpdate.playerMaxMP;
  if (sanitizedUpdate.isPlayerTurn !== undefined) state.combat.isPlayerTurn = sanitizedUpdate.isPlayerTurn;
  if (sanitizedUpdate.availableActions !== undefined) state.combat.availableActions = sanitizedUpdate.availableActions;

  if (sanitizedUpdate.enemies !== undefined) {
    state.combat.enemies = sanitizedUpdate.enemies.map(mapCombatEnemyData);
  }

  if (sanitizedUpdate.log && sanitizedUpdate.log.length > 0) {
    const turn = state.combat.currentTurn;
    const newLogs: CombatLog[] = sanitizedUpdate.log.map((entry, i) => ({
      turn: entry.turn ?? (turn + i),
      message: entry.message,
      type: entry.type ?? 'info' as const,
    }));
    state.combat.log.push(...newLogs);
  }
}

function mapCombatEnemyData(data: CombatEnemyData): CombatEnemy {
  return {
    id: data.id,
    name: data.name,
    hp: data.hp,
    maxHP: data.maxHP,
    mp: data.mp ?? 0,
    maxMP: data.maxMP ?? 0,
    level: data.level,
    status: data.status,
  };
}

function mergeSkillsUpdate(state: MergeableState, update: SkillsUpdate): void {
  if (update.replace && update.learned && update.learned.length > 0) {
    // §13.3: replace 路径新增 owner 过滤（修复前无过滤，本次 bug 根因）
    const characterSkills = filterByOwnerType(update.learned, 'character');
    state.skills = characterSkills
      .filter((skillData) => isValidEntityIdFor('skill', skillData.id))
      .map(mapSkillDataToNew);
    return;
  }

  if (update.replace && (!update.learned || update.learned.length === 0)) {
    state.skills = [];
    return;
  }

  if (update.learned && update.learned.length > 0) {
    // §13.3: learned 路径新增 owner 过滤
    const characterLearned = filterByOwnerType(update.learned, 'character');
    for (const skillData of characterLearned) {
      const existing = state.skills.find(
        (s) => s.id === skillData.id || s.skill_id === skillData.id
      );
      if (!existing && isValidEntityIdFor('skill', skillData.id)) {
        state.skills.push(mapSkillDataToNew(skillData));
      }
    }
  }

  if (update.updated && update.updated.length > 0) {
    // §13.3: updated 路径新增 owner 过滤
    const characterUpdated = filterByOwnerType(update.updated, 'character');
    for (const skillData of characterUpdated) {
      const existing = state.skills.find(
        (s) => s.id === skillData.id || s.skill_id === skillData.id
      );
      if (existing) {
        mapSkillDataToExisting(existing, skillData);
      } else if (isValidEntityIdFor('skill', skillData.id)) {
        state.skills.push(mapSkillDataToNew(skillData));
      }
    }
  }
}

function mapSkillDataToNew(data: SkillData): GameCharacterSkill {
  return {
    id: data.id,
    skill_id: data.skillId ?? data.id,
    name: data.name,
    type: data.type,
    description: data.description,
    level: data.level ?? 1,
    maxLevel: data.maxLevel,
    experience: data.experience,
    cost: parseCostArray(data.cost),
    cooldown: data.cooldownRemaining ?? data.cooldown,
    unlocked: data.unlocked ?? true,
    element: data.element,
    effects: data.effects,
    customData: data.customData,
    // 新增：与 mapInventoryItemDataToNew 对称，遵循 §13.3
    ownerType: assertOwnerType(data.ownerType),
    ownerId: data.ownerId ?? '',
    visible: data.visible ?? true,
  };
}

function mapSkillDataToExisting(
  existing: GameCharacterSkill,
  data: SkillData
): void {
  if (data.name !== undefined) existing.name = data.name;
  if (data.type !== undefined) existing.type = data.type;
  if (data.description !== undefined) existing.description = data.description;
  if (data.level !== undefined) existing.level = data.level;
  if (data.maxLevel !== undefined) existing.maxLevel = data.maxLevel;
  if (data.experience !== undefined) existing.experience = data.experience;
  if (data.cost !== undefined) existing.cost = parseCostArray(data.cost);
  if (data.cooldownRemaining !== undefined) existing.cooldown = data.cooldownRemaining;
  else if (data.cooldown !== undefined) existing.cooldown = data.cooldown;
  if (data.unlocked !== undefined) existing.unlocked = data.unlocked;
  if (data.element !== undefined) existing.element = data.element;
  if (data.effects !== undefined) existing.effects = data.effects;
  if (data.customData !== undefined) existing.customData = data.customData;
  // 新增：owner 字段同步
  if (data.ownerType !== undefined) existing.ownerType = assertOwnerType(data.ownerType);
  if (data.ownerId !== undefined) existing.ownerId = data.ownerId;
  if (data.visible !== undefined) existing.visible = data.visible;
}

function mergeNPCUpdate(state: MergeableState, update: NPCUpdate): void {
  const locationLookup = new Map<string, string>();
  if (state.mapState?.locations) {
    for (const loc of state.mapState.locations) {
      if (loc.id && loc.name) locationLookup.set(loc.id, loc.name);
    }
  }

  if (update.nearby && update.nearby.length > 0) {
    for (const npcData of update.nearby) {
      // 架构提升：使用 findEntityByIdOrName 统一查找路径（id 优先，name 兜底）
      const existing = findEntityByIdOrName(state.npcInfoList, {
        id: npcData.id,
        name: npcData.name,
      });
      if (existing) {
        mapNPCDataToExisting(existing, npcData, locationLookup);
      } else if (isValidEntityIdFor('npc', npcData.id)) {
        state.npcInfoList.push(mapNPCDataToNew(npcData, locationLookup));
      }
    }
  }

  if (update.partyChanges && update.partyChanges.length > 0) {
    for (const npcData of update.partyChanges) {
      const existing = findEntityByIdOrName(state.npcInfoList, {
        id: npcData.id,
        name: npcData.name,
      });
      if (existing) {
        mapNPCDataToExisting(existing, npcData, locationLookup);
      } else if (isValidEntityIdFor('npc', npcData.id)) {
        state.npcInfoList.push(mapNPCDataToNew(npcData, locationLookup));
      }
    }
  }
}

function resolveLocationName(location: string | undefined, locationLookup: Map<string, string>): string | undefined {
  if (!location) return undefined;
  if (locationLookup.has(location)) return locationLookup.get(location);
  const parts = location.split('_');
  if (parts.length >= 3 && (parts[0] === 'loc' || parts[0] === 'npc')) {
    return parts.slice(1, -1).join('_');
  }
  return location;
}

function mapNPCDataToNew(data: NPCData, locationLookup: Map<string, string>): NPCInfo {
  const locationId = data.locationId ?? data.location;
  return {
    id: data.id,
    name: data.name,
    role: data.role,
    inParty: data.inParty ?? false,
    affinity: data.affinity,
    relation: data.relation,
    locationId,
    location: resolveLocationName(locationId, locationLookup),
    services: data.services,
    level: data.level,
    description: data.description,
    mood: data.mood,
    race: data.race,
    title: data.title,
    currency: data.currency,
    attributes: data.attributes,
    derivedAttributes: data.derivedAttributes,
    currentHp: data.currentHp,
    maxHp: data.maxHp,
    currentMp: data.currentMp,
    maxMp: data.maxMp,
    driveProfile: data.driveProfile,
    goals: data.goals,
    inventory: data.inventory ?? [],
    skills: data.skills ?? [],
    customData: data.customData,
    visible: data.visible ?? true,
    attrInitialized: data.attrInitialized ?? false,
    invInitialized: data.invInitialized ?? false,
    skillInitialized: data.skillInitialized ?? false,
    visibility: data.visibility,
  };
}

function mapNPCDataToExisting(existing: NPCInfo, data: NPCData, locationLookup: Map<string, string>): void {
  if (data.name !== undefined) existing.name = data.name;
  if (data.role !== undefined) existing.role = data.role;
  if (data.inParty !== undefined) existing.inParty = data.inParty;
  if (data.affinity !== undefined) existing.affinity = data.affinity;
  if (data.relation !== undefined) existing.relation = data.relation;
  const newLocationId = data.locationId ?? data.location;
  if (newLocationId !== undefined) {
    existing.locationId = newLocationId;
    existing.location = resolveLocationName(newLocationId, locationLookup);
  }
  if (data.services !== undefined) existing.services = data.services;
  if (data.level !== undefined) existing.level = data.level;
  if (data.description !== undefined) existing.description = data.description;
  if (data.mood !== undefined) existing.mood = data.mood;
  if (data.race !== undefined) existing.race = data.race;
  if (data.title !== undefined) existing.title = data.title;
  if (data.currency !== undefined) existing.currency = data.currency;
  if (data.attributes !== undefined) existing.attributes = data.attributes;
  if (data.derivedAttributes !== undefined) existing.derivedAttributes = data.derivedAttributes;
  if (data.currentHp !== undefined) existing.currentHp = data.currentHp;
  if (data.maxHp !== undefined) existing.maxHp = data.maxHp;
  if (data.currentMp !== undefined) existing.currentMp = data.currentMp;
  if (data.maxMp !== undefined) existing.maxMp = data.maxMp;
  if (data.driveProfile !== undefined) existing.driveProfile = data.driveProfile;
  if (data.goals !== undefined) existing.goals = data.goals;
  if (data.inventory !== undefined) existing.inventory = data.inventory;
  if (data.skills !== undefined) existing.skills = data.skills;
  if (data.customData !== undefined) existing.customData = data.customData;
  if (data.visible !== undefined) existing.visible = data.visible;
  if (data.attrInitialized !== undefined) existing.attrInitialized = data.attrInitialized;
  if (data.invInitialized !== undefined) existing.invInitialized = data.invInitialized;
  if (data.skillInitialized !== undefined) existing.skillInitialized = data.skillInitialized;
  if (data.visibility !== undefined) existing.visibility = data.visibility;
}
