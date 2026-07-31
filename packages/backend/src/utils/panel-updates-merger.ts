import type {
  PanelUpdates,
  CharacterUpdate,
  InventoryUpdate,
  QuestUpdate,
  LocationUpdate,
  CombatUpdate,
  SkillsUpdate,
  NPCUpdate,
} from '../../../shared/src/types/dynamic-ui.js';

/**
 * PanelUpdates 合并工具类（纯函数，无状态）。
 *
 * 统一 ResponsePool.flush 和 ResponseBuilder.build 的 panelUpdates 合并逻辑，
 * 消除两处独立实现的行为不一致和数据丢失 bug。
 *
 * 合并策略：
 * - 标量字段：override 覆盖 base
 * - 数组字段（added/updated/learned/enemies/nearby 等）：按 id 合并（重复 id 原地更新）
 * - 数组字段（removed/completed/discoveredLocationIds）：去重拼接
 * - 数组字段（log）：顺序拼接
 * - replace 标志（inventory/skills）：true 时整体替换
 */
export class PanelUpdatesMerger {
  static merge(base: PanelUpdates, override: PanelUpdates): PanelUpdates {
    const result: PanelUpdates = { ...base };
    if (override.character) {
      result.character = { ...result.character, ...override.character };
    }
    if (override.inventory) {
      result.inventory = PanelUpdatesMerger.mergeInventory(result.inventory, override.inventory);
    }
    if (override.quest) {
      result.quest = PanelUpdatesMerger.mergeQuest(result.quest, override.quest);
    }
    if (override.map) {
      result.map = PanelUpdatesMerger.mergeLocation(result.map, override.map);
    }
    if (override.location) {
      result.location = PanelUpdatesMerger.mergeLocation(result.location, override.location);
    }
    if (override.combat) {
      result.combat = PanelUpdatesMerger.mergeCombat(result.combat, override.combat);
    }
    if (override.skills) {
      result.skills = PanelUpdatesMerger.mergeSkills(result.skills, override.skills);
    }
    if (override.npc) {
      result.npc = PanelUpdatesMerger.mergeNpc(result.npc, override.npc);
    }
    // 统一面板变更推送机制：dialogue 字段合并（设计 2.3 约束 1）。
    //
    // 当前实现语义：first-staged-wins（首个 staged 的 dialogue 生效）。
    // 当前正确性保证：buildGameMasterFinalResponse 中 GM 路径与 OutputAgent fallback
    //   是 if/else 互斥，同一次 flush 内最多 stage 一个 dialogue，不触发多 source 冲突。
    //
    // 设计 2.3 约束 1 要求"按 SOURCE_PRIORITY 优先级合并"，当前实现因互斥路径偶然等价。
    // 未来扩展注意：若引入多 source 并存 staging dialogue 的路径，需改为按 SOURCE_PRIORITY
    //   优先级解析（参考 response-pool.ts resolveUIDirective 模式），而非依赖 first-staged-wins。
    if (override.dialogue && !result.dialogue) {
      result.dialogue = override.dialogue;
    }
    return result;
  }

  static mergeInto(target: PanelUpdates, source: PanelUpdates): void {
    const merged = PanelUpdatesMerger.merge(target, source);
    Object.assign(target, merged);
  }

  static mergeCharacter(base: CharacterUpdate, override: CharacterUpdate): CharacterUpdate {
    return { ...base, ...override };
  }

  static mergeInventory(
    base: InventoryUpdate | undefined,
    override: NonNullable<InventoryUpdate>,
  ): NonNullable<InventoryUpdate> {
    if (override.replace) {
      return { ...override, added: override.added ?? [] };
    }
    return {
      ...base,
      ...override,
      added: PanelUpdatesMerger.mergeArrayByKey(base?.added, override.added, (item) => String(item.id ?? '')),
      updated: PanelUpdatesMerger.mergeArrayByKey(base?.updated, override.updated, (item) => String(item.id ?? '')),
      removed: PanelUpdatesMerger.mergeUniqueValues(base?.removed, override.removed),
    };
  }

  static mergeQuest(
    base: QuestUpdate | undefined,
    override: NonNullable<QuestUpdate>,
  ): NonNullable<QuestUpdate> {
    return {
      ...base,
      ...override,
      added: PanelUpdatesMerger.mergeArrayByKey(base?.added, override.added, (item) => String(item.id ?? '')),
      updated: PanelUpdatesMerger.mergeArrayByKey(base?.updated, override.updated, (item) => String(item.id ?? '')),
      completed: PanelUpdatesMerger.mergeUniqueValues(base?.completed, override.completed),
    };
  }

  static mergeLocation(
    base: LocationUpdate | undefined,
    override: NonNullable<LocationUpdate>,
  ): NonNullable<LocationUpdate> {
    return {
      ...base,
      ...override,
      discoveredLocationIds: PanelUpdatesMerger.mergeUniqueValues(base?.discoveredLocationIds, override.discoveredLocationIds),
      newLocations: PanelUpdatesMerger.mergeArrayByKey(base?.newLocations, override.newLocations, (item) => String(item.id ?? '')),
      newConnections: PanelUpdatesMerger.mergeArrayByKey(
        base?.newConnections,
        override.newConnections,
        (item) => `${String(item.from ?? '')}|${String(item.to ?? '')}|${String(item.direction ?? '')}`,
      ),
    };
  }

  static mergeCombat(
    base: CombatUpdate | undefined,
    override: NonNullable<CombatUpdate>,
  ): NonNullable<CombatUpdate> {
    return {
      ...base,
      ...override,
      enemies: PanelUpdatesMerger.mergeArrayByKey(base?.enemies, override.enemies, (item) => String(item.id ?? '')),
      log: [...(base?.log ?? []), ...(override.log ?? [])],
    };
  }

  static mergeSkills(
    base: SkillsUpdate | undefined,
    override: NonNullable<SkillsUpdate>,
  ): NonNullable<SkillsUpdate> {
    if (override.replace) {
      return { ...override, learned: override.learned ?? [] };
    }
    return {
      ...base,
      ...override,
      learned: PanelUpdatesMerger.mergeArrayByKey(base?.learned, override.learned, (item) => String(item.id ?? '')),
      updated: PanelUpdatesMerger.mergeArrayByKey(base?.updated, override.updated, (item) => String(item.id ?? '')),
    };
  }

  static mergeNpc(
    base: NPCUpdate | undefined,
    override: NonNullable<NPCUpdate>,
  ): NonNullable<NPCUpdate> {
    return {
      ...base,
      ...override,
      nearby: PanelUpdatesMerger.mergeArrayByKey(base?.nearby, override.nearby, (item) => String(item.id ?? '')),
      partyChanges: PanelUpdatesMerger.mergeArrayByKey(base?.partyChanges, override.partyChanges, (item) => String(item.id ?? '')),
    };
  }

  private static mergeUniqueValues<T>(base: T[] | undefined, override: T[] | undefined): T[] | undefined {
    if (!base?.length && !override?.length) {
      return undefined;
    }
    const merged: T[] = [];
    const seen = new Set<string>();
    for (const item of [...(base ?? []), ...(override ?? [])]) {
      const key = typeof item === 'string' ? item : JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  }

  private static mergeArrayByKey<T extends object>(
    base: T[] | undefined,
    override: T[] | undefined,
    getKey: (item: T) => string,
  ): T[] | undefined {
    if (!base?.length && !override?.length) {
      return undefined;
    }
    const merged: T[] = [];
    const indexMap = new Map<string, number>();
    for (const item of [...(base ?? []), ...(override ?? [])]) {
      const key = getKey(item);
      if (key && indexMap.has(key)) {
        const existingIndex = indexMap.get(key)!;
        merged[existingIndex] = {
          ...(merged[existingIndex] as object),
          ...(item as object),
        } as T;
        continue;
      }
      merged.push(item);
      if (key) {
        indexMap.set(key, merged.length - 1);
      }
    }
    return merged;
  }
}
