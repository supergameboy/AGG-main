import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import type {
  NPCProfile,
  PartyMember,
  NPCStatusPanel,
  NPCMemory,
  MemoryCompressionResult,
  CompressOptions,
  NPCGoal,
  GoalCategory,
  MoveResult,
  NpcInitStatus,
  NpcInitUpdate,
  INPCRepository,
  INPCGoalRepository,
  INPCService,
} from './types.js';
import type { IMapService, LocationData } from '../map/types.js';
import type { ICharacterService } from '../character/types.js';
import type { ISaveRepository } from '../save/types.js';
import type { ITemplateProvider } from '../shared/types.js';
import type { INumericalService, BaseAttributes } from '../numerical/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';
import { computeDedupUpdate, formatDedupWarnings } from '../shared/dedup-helper.js';
import { NpcEntityResolver } from './NpcEntityResolver.js';
import { EntityResolutionError } from '../shared/entity-resolver/EntityResolutionError.js';

const MAX_PARTY_SIZE = 4;
const MAX_DIALOGUE_HISTORY_LENGTH = 50;
const NPC_NOT_FOUND_HINT = '请先使用现有 NPC 列表核对当前存档中的已存在 NPC。';
const NPC_LOCATION_EMPTY_HINT = '该地点暂无已存在 NPC，请先核对场景初始化、位置 ID 和上下文注入。';
const NPC_NEARBY_EMPTY_HINT = '附近暂无已存在 NPC，请先核对位置范围、场景初始化或扩大搜索条件。';
const NPC_MEMORY_EMPTY_HINT = '该 NPC 暂无可读记忆记录。';
// 模块3 简化：删除 NPC_KNOWLEDGE_EMPTY_HINT（NPCKnowledge 相关方法已迁移到 PERCEIVES 感知边）

/**
 * NPC 领域 Service（S2-1 重构：Repository 模式 + 端口注入）。
 *
 * 依赖注入（8 个端口）:
 * - npcRepo / goalRepo: 领域内 2 张表的 Repository
 * - mapService / characterService: 跨领域 Service 端口
 * - saveRepo / templateProvider: 跨领域数据访问端口
 * - numericalService: 数值重算端口
 * - txManager: 事务管理抽象
 *
 * 事务补齐（D10 + 设计 §3.5）: moveNpc / moveCharacterTo / quickTravelTo / createNPC
 * 通过 txManager.transaction 包裹，eventBus.emit 在事务提交后执行。
 *
 * 模块2 简化：删除 relationRepo 构造参数 + 5 个 relation 方法 + 2 个私有辅助方法 + 2 个常量
 * （关系数据由 EntityGraphService.setRelationship 通过 PERCEIVES 边维护，单一数据源）
 */
export class NPCService implements INPCService {
  private readonly logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly npcRepo: INPCRepository,
    private readonly goalRepo: INPCGoalRepository,
    private readonly mapService: IMapService,
    private readonly characterService: ICharacterService,
    private readonly saveRepo: ISaveRepository,
    private readonly templateProvider: ITemplateProvider,
    private readonly numericalService: INumericalService,
    private readonly txManager: ITransactionManager,
    private readonly npcResolver: NpcEntityResolver,
  ) {
    this.logger = createChildLogger('service:npc');
  }

  /**
   * 事务执行辅助：统一处理外部事务复用与自建事务。
   * 消除各方法中 `if (trx) return execute(trx); return this.txManager.transaction(execute);` 样板。
   */
  private runInTransaction<T>(
    externalTrx: Knex.Transaction | undefined,
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.txManager, externalTrx, work);
  }

  // ===========================================================================
  // 查询方法
  // ===========================================================================

  async listNPCs(saveId: ID, visibility?: 'all' | 'visible' | 'hidden'): Promise<NPCProfile[]> {
    try {
      return await this.npcRepo.findBySaveId(saveId, { visibility });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get NPCs', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getNPCsByLocationIds(saveId: ID, locationIds: ID[]): Promise<Array<{
    id: string; name: string; role: string; locationId: string;
    services: string | null; reputation: number; mood: string | null;
    inParty: boolean; title: string | null;
  }>> {
    return await this.npcRepo.findSummariesByLocationIds(saveId, locationIds);
  }

  async getNPCNamesByIds(npcIds: ID[]): Promise<Map<ID, string>> {
    return await this.npcRepo.findNamesByIds(npcIds);
  }

  async getNPC(saveId: ID, npcId: ID, trx?: Knex.Transaction): Promise<NPCProfile> {
    try {
      const resolvedId = await this.resolveNpcId(saveId, npcId, trx);
      const npc = await this.npcRepo.findById(resolvedId, saveId, trx);
      if (!npc) throw new Error(`NPC not found: ${npcId}. ${NPC_NOT_FOUND_HINT}`);
      return npc;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get NPC', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async resolveNpcId(saveId: ID, npcIdOrName: string, trx?: Knex.Transaction): Promise<string> {
    if (!npcIdOrName || typeof npcIdOrName !== 'string') {
      throw new Error('NPC ID不能为空');
    }

    /**
     * 委托给 NpcEntityResolver 统一设施（13.2 规则收敛）。
     * - name/id 双兼容 + 时间戳兼容由 EntityResolverBase 提供
     * - 失败抛 EntityResolutionError（含候选列表），转为对调用方友好的 Error 信息
     * - trx 透传由基类阶段1/2 的子类实现支持
     */
    try {
      const resolved = await this.npcResolver.resolve({
        saveId,
        entityType: 'npc',
        ref: npcIdOrName,
      }, trx);
      return resolved.entityId;
    } catch (error) {
      if (error instanceof EntityResolutionError) {
        // 转换为对调用方兼容的错误信息（保留候选列表 hint）
        throw new Error(error.message);
      }
      throw error;
    }
  }

  // ===========================================================================
  // S3-3 新增（dialogue 跨领域调用）
  // ===========================================================================
  // 模块2 简化：删除 getPlayerRelation / changePlayerRelation / changePlayerRelationInTrx 三个方法
  // （NPC_PARTY 不写关系，关系数据由 EntityGraphService.setRelationship 通过 PERCEIVES 边维护）

  /**
   * 修改 NPC 当前 HP（delta 增量，clamp 0~maxHp）。
   * 与 ICharacterService.modifyHealth 对称，供 SkillService.useSkill 应用伤害到 NPC。
   *
   * 事务策略（与 InventoryService.addItem 模式一致，避免嵌套事务）:
   * - 传入 trx: 在已有事务内执行，所有 Repository 调用透传 trx，不开新事务
   * - 未传 trx: 用 txManager.transaction 开新事务
   */
  async modifyNpcHealth(
    saveId: ID,
    npcId: ID,
    delta: number,
    trx?: Knex.Transaction,
  ): Promise<{ previous: number; current: number; max: number }> {
    try {
      if (trx) {
        return await this.modifyNpcHealthInTrx(trx, saveId, npcId, delta);
      }
      return await this.txManager.transaction(async (innerTrx) => {
        return await this.modifyNpcHealthInTrx(innerTrx, saveId, npcId, delta);
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to modify NPC health', { saveId, npcId, delta, error: errorMessage });
      throw error;
    }
  }

  /**
   * modifyNpcHealth 的事务内实现（私有方法，避免嵌套事务）。
   * NPC 存在性校验 + HP 计算 + 写入原子化。
   */
  private async modifyNpcHealthInTrx(
    trx: Knex.Transaction,
    saveId: ID,
    npcId: ID,
    delta: number,
  ): Promise<{ previous: number; current: number; max: number }> {
    const npc = await this.npcRepo.findById(npcId, saveId, trx);
    if (!npc) throw new Error(`NPC not found: ${npcId}`);
    if (npc.currentHp === null || npc.maxHp === null) {
      throw new Error(`NPC HP not initialized: ${npcId}. 请先调用 init_attributes 初始化 NPC 属性`);
    }

    const previous = npc.currentHp;
    const max = npc.maxHp;
    const current = Math.max(0, Math.min(max, previous + delta));

    await this.npcRepo.update(npcId, saveId, { currentHp: current }, trx);

    this.logger.info('NPC health modified', { saveId, npcId, delta, previous, current, max });
    return { previous, current, max };
  }

  /**
   * 追加 NPC 对话历史到 dialogue_history JSON 字段，含 max 50 截断
   * （INPCService 端口实现，覆盖 DialogueService.updateNPCDialogueHistoryWithTrx L924-970 trx('npcs') 读写）。
   * 读取 NPC → 追加 message → 截断 50 → 写回。NPC 不存在则静默返回（与原行为一致）。
   * messageType 作为 opaque string 写入（NPC 域不感知 dialogue 的 MessageType 联合类型）。
   * D9: 支持 trx 透传，供 dialogue addDialogueMessage 事务内调用。
   */
  async appendDialogueHistory(
    saveId: ID,
    npcId: ID,
    message: { speaker: string; content: string; emotion: string; messageType: string; timestamp: Timestamp },
    trx?: Knex.Transaction,
  ): Promise<void> {
    try {
      const npc = await this.npcRepo.findById(npcId, saveId, trx);
      if (!npc) return;

      const history = [...npc.dialogueHistory];
      history.push({
        speaker: message.speaker,
        content: message.content,
        emotion: message.emotion,
        messageType: message.messageType,
        timestamp: message.timestamp,
      });

      const trimmed = history.length > MAX_DIALOGUE_HISTORY_LENGTH
        ? history.slice(-MAX_DIALOGUE_HISTORY_LENGTH)
        : history;

      await this.npcRepo.update(npcId, saveId, { dialogueHistory: trimmed }, trx);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to append dialogue history', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async getNPCsByLocation(saveId: ID, locationId: string): Promise<{ npcs: NPCProfile[]; hint?: string }> {
    if (!locationId) {
      return { npcs: [], hint: '需要提供有效的位置ID' };
    }
    try {
      const npcs = await this.npcRepo.findByLocationId(saveId, locationId as ID);
      if (npcs.length === 0) {
        return { npcs: [], hint: NPC_LOCATION_EMPTY_HINT };
      }
      return { npcs };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get NPCs by location', { saveId, locationId, error: errorMessage });
      throw error;
    }
  }

  // 模块2 简化：删除 getRelations 方法（关系数据由 EntityGraphPort.getNpcProfile/getEntityRelations 查询）

  async getParty(saveId: ID): Promise<PartyMember[]> {
    try {
      const npcs = await this.npcRepo.findPartyMembers(saveId);
      return npcs.map(npc => ({
        npcId: npc.id,
        name: npc.name,
        role: npc.role,
        level: npc.level,
        joinedAt: npc.joinedPartyAt,
      }));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get party', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getNPCFullStatus(saveId: ID, npcId: ID): Promise<NPCStatusPanel> {
    const npc = await this.getNPC(saveId, npcId);

    let locationName: string | null = null;
    if (npc.locationId) {
      try {
        const location = await this.mapService.getLocation(npc.locationId as ID, saveId);
        locationName = location.name;
      } catch {
        this.logger.warn('Failed to resolve NPC location name', { locationId: npc.locationId });
      }
    }

    // 模块2 简化：availableServices.unlocked 恒 true（服务解锁不再依赖关系数据，所有 NPC 服务默认解锁）
    const servicesWithUnlockStatus = npc.services.map(service => ({
      type: service.type,
      name: service.name,
      unlocked: true as const,
    }));

    let raceName = npc.race;
    try {
      const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId);
      if (templateId) {
        const template = await this.templateProvider.getTemplate(templateId);
        const cc = template.characterCreation;
        if (cc) {
          const races = (cc.races as Array<{ id: string; name: string }> | undefined) ?? [];
          const race = races.find(r => r.id === npc.race);
          if (race) raceName = race.name;
        }
      }
    } catch {
      this.logger.warn('Failed to resolve NPC race name from template');
    }

    return {
      basicInfo: {
        name: npc.name,
        title: npc.title,
        race: npc.race,
        raceName,
        role: npc.role,
        level: npc.level,
      },
      location: {
        locationId: npc.locationId,
        locationName,
      },
      partyStatus: {
        inParty: npc.inParty,
        joinedAt: npc.joinedPartyAt,
      },
      availableServices: servicesWithUnlockStatus,
      attributes: npc.attributes,
      derivedAttributes: npc.derivedAttributes,
      currentHp: npc.currentHp,
      maxHp: npc.maxHp,
      currentMp: npc.currentMp,
      maxMp: npc.maxMp,
      attrInitialized: npc.attrInitialized,
      invInitialized: npc.invInitialized,
      skillInitialized: npc.skillInitialized,
      visibility: npc.visibility,
    };
  }

  async getNearbyNPCs(saveId: ID, locationId: string, _radius?: number): Promise<{ npcs: NPCProfile[]; hint?: string }> {
    try {
      const locationResult = await this.getNPCsByLocation(saveId, locationId);
      const npcsAtLocation = locationResult.npcs;

      if (!_radius || _radius <= 0) {
        if (npcsAtLocation.length === 0) {
          return { npcs: [], hint: NPC_NEARBY_EMPTY_HINT };
        }
        return { npcs: npcsAtLocation };
      }

      let location: LocationData | null = null;
      try {
        location = await this.mapService.getLocation(locationId as ID, saveId);
      } catch {
        // location 不存在
      }

      if (!location) {
        if (npcsAtLocation.length === 0) {
          return { npcs: [], hint: NPC_NEARBY_EMPTY_HINT };
        }
        return { npcs: npcsAtLocation };
      }

      const filtered = npcsAtLocation.filter(npc => {
        const npcCustomData: Record<string, unknown> = npc.customData ?? {};

        if ('x' in npcCustomData && 'y' in npcCustomData) {
          const locX = (location.customData && typeof location.customData === 'object' && 'x' in location.customData)
            ? (location.customData as Record<string, unknown>).x as number
            : 0;
          const locY = (location.customData && typeof location.customData === 'object' && 'y' in location.customData)
            ? (location.customData as Record<string, unknown>).y as number
            : 0;

          const distance = Math.sqrt(
            Math.pow((npcCustomData.x as number) - locX, 2) +
            Math.pow((npcCustomData.y as number) - locY, 2),
          );

          return distance <= _radius;
        }

        return true;
      });

      if (filtered.length === 0) {
        return { npcs: [], hint: NPC_NEARBY_EMPTY_HINT };
      }
      return { npcs: filtered };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get nearby NPCs', { saveId, locationId, error: errorMessage });
      throw error;
    }
  }

  async getMemories(
    saveId: ID,
    npcId: ID,
    type?: NPCMemory['type'],
    limit: number = 20,
  ): Promise<{ memories: NPCMemory[]; hint?: string }> {
    try {
      const npc = await this.getNPC(saveId, npcId);
      const customData: Record<string, unknown> = npc.customData ?? {};

      let memories: NPCMemory[] = Array.isArray(customData.memories)
        ? customData.memories as NPCMemory[]
        : [];

      if (type) {
        memories = memories.filter(m => m.type === type);
      }

      memories.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return b.importance - a.importance;
      });

      const result = memories.slice(0, limit);
      if (result.length === 0) {
        return { memories: [], hint: NPC_MEMORY_EMPTY_HINT };
      }
      return { memories: result };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get NPC memories', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  // 模块3 简化：删除 getKnowledge（NPCKnowledge 已迁移到 PERCEIVES 感知边，由 set_awareness/get_awareness 替代）

  async getGoals(saveId: string, npcId: string, status?: string): Promise<NPCGoal[]> {
    const resolvedNpcId = await this.resolveNpcId(saveId, npcId);
    return await this.goalRepo.findBySaveIdAndNpcId(saveId as ID, resolvedNpcId as ID, status ? { status } : undefined);
  }

  async getActiveGoals(saveId: string, npcId: string): Promise<NPCGoal[]> {
    return this.getGoals(saveId, npcId, 'active');
  }

  // ===========================================================================
  // 写入方法
  // ===========================================================================
  // 模块2 简化：删除 updateRelation 方法（关系数据由 EntityGraphService.setRelationship 维护）

  async addToParty(saveId: ID, npcId: ID): Promise<PartyMember> {
    try {
      const npc = await this.getNPC(saveId, npcId);
      if (npc.inParty) {
        throw new Error(`NPC ${npc.name} is already in the party`);
      }

      const currentParty = await this.getParty(saveId);
      if (currentParty.length >= MAX_PARTY_SIZE) {
        throw new Error(`Party is full (max ${MAX_PARTY_SIZE} members)`);
      }

      const now = Date.now() as Timestamp;
      const updated = await this.npcRepo.update(npcId, saveId, { inParty: true, joinedPartyAt: now });
      if (!updated) throw new Error(`NPC not found after party update: ${npcId}`);

      this.logger.info('NPC added to party', { npcId, name: npc.name });

      return {
        npcId,
        name: npc.name,
        role: npc.role,
        level: npc.level,
        joinedAt: now,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to add NPC to party', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async removeFromParty(saveId: ID, npcId: ID): Promise<void> {
    try {
      const npc = await this.getNPC(saveId, npcId);
      if (!npc.inParty) {
        throw new Error(`NPC ${npc.name} is not in the party`);
      }

      const updated = await this.npcRepo.update(npcId, saveId, { inParty: false, joinedPartyAt: null });
      if (!updated) throw new Error(`NPC not found after party update: ${npcId}`);

      this.logger.info('NPC removed from party', { npcId, name: npc.name });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to remove NPC from party', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async updateNPCDisposition(saveId: ID, npcId: ID, disposition: string): Promise<NPCProfile> {
    try {
      const npc = await this.getNPC(saveId, npcId);
      const customData = { ...npc.customData, disposition };
      const updated = await this.npcRepo.updateCustomData(npcId, saveId, customData);
      if (!updated) throw new Error(`NPC not found after disposition update: ${npcId}`);

      this.logger.info('NPC disposition updated', { npcId, disposition });
      return updated;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update NPC disposition', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async updateNPC(
    saveId: ID,
    npcId: ID,
    fields: {
      name?: string;
      description?: string;
      title?: string;
      customData?: Record<string, unknown>;
      role?: string;
      race?: string;
      level?: number;
      mood?: number;
      visible?: boolean;
      locationId?: string;
      currency?: string;
      attributes?: string;
      derivedAttributes?: string;
      currentHp?: number | null;
      maxHp?: number | null;
      currentMp?: number | null;
      maxMp?: number | null;
    },
  ): Promise<NPCProfile> {
    try {
      const resolvedId = await this.resolveNpcId(saveId, npcId);
      const npc = await this.npcRepo.findById(resolvedId, saveId);
      if (!npc) throw new Error(`NPC not found: ${npcId}`);

      if (fields.locationId !== undefined) {
        return this.moveNpc(saveId, resolvedId, fields.locationId as ID);
      }

      const patch: Partial<NPCProfile> = {};
      if (fields.name !== undefined) patch.name = fields.name;
      if (fields.description !== undefined) patch.description = fields.description;
      if (fields.title !== undefined) patch.title = fields.title;
      if (fields.role !== undefined) patch.role = fields.role;
      if (fields.race !== undefined) patch.race = fields.race;
      if (fields.level !== undefined) patch.level = fields.level;
      if (fields.mood !== undefined) patch.mood = fields.mood;
      if (fields.visible !== undefined) patch.visible = fields.visible;
      if (fields.customData !== undefined) patch.customData = fields.customData;
      if (fields.currency !== undefined) {
        patch.currency = typeof fields.currency === 'string'
          ? JSON.parse(fields.currency) as Record<string, number>
          : fields.currency as Record<string, number>;
      }
      if (fields.attributes !== undefined) {
        patch.attributes = typeof fields.attributes === 'string'
          ? JSON.parse(fields.attributes) as Record<string, unknown>
          : fields.attributes as Record<string, unknown>;

        // 高级方法自动完成低级方法：传入 attributes 时自动派生 HP/MP
        // LLM 无需关心派生公式，无需单独调 numerical_service.calculate_derived_attributes
        const derived = this.numericalService.calculateDerivedAttributes(
          patch.attributes as Partial<BaseAttributes>,
        );
        patch.derivedAttributes = derived;
        // maxHp/maxMp：未显式传则用派生值，显式传则覆盖派生值
        if (derived.maxHealth !== undefined) {
          patch.maxHp = fields.maxHp !== undefined ? fields.maxHp : derived.maxHealth;
        } else if (fields.maxHp !== undefined) {
          patch.maxHp = fields.maxHp;
        }
        if (derived.maxMana !== undefined) {
          patch.maxMp = fields.maxMp !== undefined ? fields.maxMp : derived.maxMana;
        } else if (fields.maxMp !== undefined) {
          patch.maxMp = fields.maxMp;
        }
        // 满血初始化：未显式传 currentHp/currentMp 时设为 maxHp/maxMp
        if (fields.currentHp === undefined && patch.maxHp !== undefined) {
          patch.currentHp = patch.maxHp;
        } else if (fields.currentHp !== undefined) {
          patch.currentHp = fields.currentHp;
        }
        if (fields.currentMp === undefined && patch.maxMp !== undefined) {
          patch.currentMp = patch.maxMp;
        } else if (fields.currentMp !== undefined) {
          patch.currentMp = fields.currentMp;
        }
      } else {
        // 未传入 attributes 时维持现状（纯透传）
        if (fields.derivedAttributes !== undefined) {
          patch.derivedAttributes = typeof fields.derivedAttributes === 'string'
            ? JSON.parse(fields.derivedAttributes) as Record<string, unknown>
            : fields.derivedAttributes as Record<string, unknown>;
        }
        if (fields.currentHp !== undefined) patch.currentHp = fields.currentHp;
        if (fields.maxHp !== undefined) patch.maxHp = fields.maxHp;
        if (fields.currentMp !== undefined) patch.currentMp = fields.currentMp;
        if (fields.maxMp !== undefined) patch.maxMp = fields.maxMp;
      }

      if (Object.keys(patch).length === 0) {
        return npc;
      }

      const updated = await this.npcRepo.update(resolvedId, saveId, patch);
      if (!updated) throw new Error(`NPC not found after update: ${resolvedId}`);

      this.logger.info('NPC updated', { npcId: resolvedId, fields: Object.keys(fields) });
      return updated;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update NPC', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 移动 NPC 到新地点。
   * 事务补齐（设计 §3.5）：location 解析 + NPC 位置更新原子化。
   */
  async moveNpc(saveId: ID, npcId: ID, newLocationId: ID): Promise<NPCProfile> {
    const resolvedId = await this.resolveNpcId(saveId, npcId);
    const npc = await this.npcRepo.findById(resolvedId, saveId);
    if (!npc) {
      throw new Error(`NPC not found: ${npcId}`);
    }

    const resolvedLocationId = await this.mapService.resolveLocationId(newLocationId as string, saveId);
    await this.mapService.getLocation(resolvedLocationId, saveId);

    await this.txManager.transaction(async (trx) => {
      const updated = await this.npcRepo.update(resolvedId, saveId, { locationId: resolvedLocationId }, trx);
      if (!updated) throw new Error(`NPC not found during move: ${resolvedId}`);
    });

    const refreshed = await this.npcRepo.findById(resolvedId, saveId);
    if (!refreshed) throw new Error(`NPC not found after move: ${resolvedId}`);
    return refreshed;
  }

  /**
   * 移动角色到新地点（含队伍 NPC 跟随）。
   * 事务补齐（设计 §3.5）：角色位置 + 队伍 NPC 位置原子化。
   * eventBus.emit 在事务提交后执行。
   */
  async moveCharacterTo(saveId: string, targetLocationId: string, options?: { skipValidation?: boolean }): Promise<MoveResult> {
    const character = await this.characterService.getCharacterBasicInfo(saveId);
    if (!character) {
      throw new Error(`Character not found for save: ${saveId}`);
    }
    const fromLocationId = await this.characterService.getCurrentLocationId(saveId);

    await this.mapService.getLocation(targetLocationId as ID, saveId);

    let distance = 0;
    if (!options?.skipValidation && fromLocationId) {
      const path = await this.mapService.getNavigationPath(fromLocationId, targetLocationId as ID, saveId as ID);
      distance = path.totalDistance;
    } else if (fromLocationId) {
      const fromLoc = await this.mapService.getLocation(fromLocationId as ID, saveId as ID);
      const toLoc = await this.mapService.getLocation(targetLocationId as ID, saveId as ID);
      distance = Math.sqrt(
        Math.pow((toLoc.coordinates.x - fromLoc.coordinates.x), 2) +
        Math.pow((toLoc.coordinates.y - fromLoc.coordinates.y), 2),
      );
    }

    const followersMoved = await this.txManager.transaction(async (trx) => {
      await this.characterService.updateLocationId(saveId, targetLocationId, trx);

      const partyNpcIds = await this.npcRepo.findPartyMemberIds(saveId as ID, trx);
      if (partyNpcIds.length > 0) {
        await this.npcRepo.updateLocationForNpcs(saveId as ID, partyNpcIds, targetLocationId as ID, trx);
      }

      // 访问即发现：角色到达新地点写入 discovered_locations（幂等）。
      // markDiscovered 与移动操作在同一事务内，保证原子性（消除原"副产物失败不回滚"反模式）。
      await this.mapService.markDiscovered(saveId as ID, targetLocationId as ID, trx);

      return partyNpcIds;
    });

    this.logger.info('Character moved', { saveId, fromLocationId, targetLocationId, distance, followersMoved: followersMoved.length });

    eventBus.emit('location_enter', { type: 'location_enter', saveId, data: { locationId: targetLocationId, fromLocationId }, timestamp: Date.now() });

    return {
      success: true,
      fromLocationId,
      toLocationId: targetLocationId,
      distance,
      followersMoved,
    };
  }

  /**
   * 快速旅行（消耗金币移动角色 + 队伍 NPC 跟随）。
   * 事务补齐（设计 §3.5）：金币扣减 + 角色位置 + 队伍 NPC 位置原子化。
   * eventBus.emit 在事务提交后执行。
   */
  async quickTravelTo(saveId: string, targetLocationId: string, costPerUnit?: number): Promise<MoveResult> {
    const character = await this.characterService.getCharacterBasicInfo(saveId);
    if (!character) {
      throw new Error(`Character not found for save: ${saveId}`);
    }
    const fromLocationId = await this.characterService.getCurrentLocationId(saveId);
    if (!fromLocationId) {
      throw new Error('Character has no current location, cannot quick travel');
    }

    await this.mapService.getLocation(targetLocationId as ID, saveId);

    const path = await this.mapService.getNavigationPath(fromLocationId, targetLocationId as ID, saveId as ID);
    const distance = path.totalDistance;

    const effectiveCostPerUnit = costPerUnit ?? 10;
    const totalCost = Math.ceil(distance * effectiveCostPerUnit);

    const gold = character.currency.gold ?? 0;
    if (gold < totalCost) {
      throw new Error(`金币不足：快速旅行需要 ${totalCost} 金币，当前仅有 ${gold} 金币`);
    }

    const followersMoved = await this.txManager.transaction(async (trx) => {
      await this.characterService.modifyCurrency(saveId, 'gold', -totalCost, trx);
      await this.characterService.updateLocationId(saveId, targetLocationId, trx);

      const partyNpcIds = await this.npcRepo.findPartyMemberIds(saveId as ID, trx);
      if (partyNpcIds.length > 0) {
        await this.npcRepo.updateLocationForNpcs(saveId as ID, partyNpcIds, targetLocationId as ID, trx);
      }

      // 访问即发现：快速旅行到达新地点写入 discovered_locations（幂等）。
      // markDiscovered 与快速旅行操作在同一事务内，保证原子性（消除原"副产物失败不回滚"反模式）。
      await this.mapService.markDiscovered(saveId as ID, targetLocationId as ID, trx);

      return partyNpcIds;
    });

    this.logger.info('Character quick traveled', { saveId, fromLocationId, targetLocationId, distance, cost: totalCost, followersMoved: followersMoved.length });

    eventBus.emit('location_enter', { type: 'location_enter', saveId, data: { locationId: targetLocationId, fromLocationId }, timestamp: Date.now() });

    return {
      success: true,
      fromLocationId,
      toLocationId: targetLocationId,
      distance,
      followersMoved,
    };
  }

  /**
   * 创建 NPC（含默认 player 关系初始化）。
   * 事务补齐（设计 §3.5）：NPC 插入 + 默认关系原子化。
   */
  async createNPC(params: {
    saveId: ID;
    name: string;
    role: string;
    race: string;
    locationId: string;
    description: string;
    personality: string;
    background: string;
    abilities?: string;
    disposition?: string;
    level?: number;
    services?: Array<{ type: string; name: string }>;
    title?: string;
    visible?: boolean;
  }): Promise<NPCProfile & { alreadyExists?: boolean; warnings?: string[] }> {
    const existing = await this.npcRepo.findByName(params.saveId, params.name);
    if (existing) {
      return await this.applyNpcDedupUpdate(params, existing);
    }

    const resolvedLocationId = await this.mapService.resolveLocationId(params.locationId, params.saveId);
    const level = params.level ?? 1;
    const disposition = params.disposition ?? 'neutral';

    const customData: Record<string, unknown> = {
      disposition,
      personality: params.personality,
      background: params.background,
    };
    if (params.abilities) {
      customData.abilities = params.abilities;
    }

    const npcData: Omit<NPCProfile, 'id'> & { id?: ID } = {
      saveId: params.saveId,
      templateNpcId: null,
      name: params.name,
      title: params.title ?? '',
      description: params.description,
      role: params.role,
      race: params.race,
      locationId: resolvedLocationId,
      level,
      services: params.services ?? [],
      dialogueHistory: [],
      inParty: false,
      joinedPartyAt: null,
      reputation: 0,
      mood: 50,
      visible: params.visible === true,
      attrInitialized: false,
      invInitialized: false,
      skillInitialized: false,
      customData,
      currency: {},
      attributes: {},
      derivedAttributes: {},
      currentHp: null,
      maxHp: null,
      currentMp: null,
      maxMp: null,
      // createdAt 由 DB 默认值/Repository.insert 设置，创建时先置 0
      createdAt: 0,
    };

    const created = await this.txManager.transaction(async (trx) => {
      const npc = await this.npcRepo.insert(npcData, trx);

      // 模块2 简化：删除"插入默认 player relation"逻辑
      // （PERCEIVES 边由 GM 首次交互时通过 set_relationship lazily 创建）

      this.logger.info('NPC created via create_npc', {
        npcId: npc.id, name: params.name, role: params.role, locationId: resolvedLocationId,
      });

      return npc;
    });

    return created;
  }

  /**
   * NPC 去重防护：同 saveId+name 已存在时增量更新非黑名单字段 + 返回 alreadyExists + warnings。
   *
   * 黑名单字段（禁止覆盖）：id、saveId、npcId、createdAt
   * 可更新字段：role、race、locationId、description、personality、background、abilities、
   *            disposition、level、services、title、visible
   *
   * 特殊处理：
   * - locationId：需经 mapService.resolveLocationId 解析（name → id）
   * - personality/background/abilities/disposition：存储在 customData 内，合并后整体更新
   */
  private async applyNpcDedupUpdate(
    params: {
      saveId: ID;
      name: string;
      role: string;
      race: string;
      locationId: string;
      description: string;
      personality: string;
      background: string;
      abilities?: string;
      disposition?: string;
      level?: number;
      services?: Array<{ type: string; name: string }>;
      title?: string;
      visible?: boolean;
    },
    existing: NPCProfile,
  ): Promise<NPCProfile & { alreadyExists?: boolean; warnings?: string[] }> {
    this.logger.info('NPC already exists, applying incremental update', {
      saveId: params.saveId, existingId: existing.id, existingName: existing.name,
    });

    // 解析 locationId（name → id）
    const resolvedLocationId = await this.mapService.resolveLocationId(params.locationId, params.saveId);

    // 构建顶层字段新值
    const newValues: Record<string, unknown> = {
      role: params.role,
      race: params.race,
      locationId: resolvedLocationId,
      description: params.description,
      level: params.level,
      services: params.services,
      title: params.title,
      visible: params.visible,
    };

    const existingValues: Record<string, unknown> = {
      role: existing.role,
      race: existing.race,
      locationId: existing.locationId,
      description: existing.description,
      level: existing.level,
      services: existing.services,
      title: existing.title,
      visible: existing.visible,
    };

    const NPC_BLACKLIST = ['id', 'saveId', 'npcId', 'createdAt'] as const;
    const { updatedFields, blockedFields } = computeDedupUpdate(
      existingValues, newValues, NPC_BLACKLIST,
    );

    // 处理 customData 字段（personality/background/abilities/disposition）
    const existingCustomData = existing.customData ?? {};
    const newCustomData: Record<string, unknown> = {
      personality: params.personality,
      background: params.background,
      disposition: params.disposition ?? 'neutral',
    };
    if (params.abilities !== undefined) {
      newCustomData.abilities = params.abilities;
    }

    const customDataUpdatedFields: typeof updatedFields = [];
    const customDataBlockedFields: typeof blockedFields = [];
    const CUSTOM_DATA_BLACKLIST: readonly string[] = []; // customData 内字段无黑名单
    const customResult = computeDedupUpdate(existingCustomData, newCustomData, CUSTOM_DATA_BLACKLIST);
    customDataUpdatedFields.push(...customResult.updatedFields);
    customDataBlockedFields.push(...customResult.blockedFields);

    // 应用顶层字段更新
    if (updatedFields.length > 0 || customDataUpdatedFields.length > 0) {
      await this.runInTransaction(undefined, async (t) => {
        const patch: Partial<NPCProfile> = {};
        for (const f of updatedFields) {
          (patch as Record<string, unknown>)[f.field] = f.newValue;
        }
        // 合并 customData 更新
        if (customDataUpdatedFields.length > 0) {
          const mergedCustomData = { ...existingCustomData };
          for (const f of customDataUpdatedFields) {
            mergedCustomData[f.field] = f.newValue;
          }
          patch.customData = mergedCustomData;
        }
        await this.npcRepo.update(existing.id, params.saveId, patch, t);
      });
    }

    // 获取更新后的实体
    const updated = await this.npcRepo.findById(existing.id, params.saveId);
    if (!updated) throw new Error('Failed to retrieve updated NPC');

    // 合并 warnings（顶层 + customData）
    const warnings = [
      ...formatDedupWarnings('NPC', existing.name, updatedFields, blockedFields),
      ...formatDedupWarnings('NPC', existing.name, customDataUpdatedFields, customDataBlockedFields),
    ];

    this.logger.info('NPC incremental update applied', {
      saveId: params.saveId, existingId: existing.id,
      updatedFields: [...updatedFields.map(f => f.field), ...customDataUpdatedFields.map(f => `customData.${f.field}`)],
      blockedFields: [...blockedFields.map(f => f.field), ...customDataBlockedFields.map(f => `customData.${f.field}`)],
    });

    return { ...updated, alreadyExists: true, warnings };
  }

  // ===========================================================================
  // 初始化标记
  // ===========================================================================

  /**
   * 检查 NPC 属性是否需要初始化（P0-1 v1.1 修复语义 BUG）。
   * 返回 true=需要初始化（attr_initialized=0），false=已初始化（attr_initialized=1）。
   * Repository.findInitFlag 返回 init flag 本身的值（true=已初始化），
   * Service 层取反得到真正的 needsInit 语义。
   */
  async ensureAttrInitialized(saveId: ID, npcId: string): Promise<boolean> {
    const isInitialized = await this.npcRepo.findInitFlag(npcId as ID, saveId, 'attrInitialized');
    return !isInitialized;
  }

  async markAttrInitialized(saveId: ID, npcId: string): Promise<void> {
    await this.npcRepo.updateInitFlag(npcId as ID, saveId, 'attrInitialized');
  }

  /**
   * 检查 NPC 物品是否需要初始化（P0-1 v1.1 修复语义 BUG）。
   * 返回 true=需要初始化，false=已初始化。
   */
  async ensureInvInitialized(saveId: ID, npcId: string): Promise<boolean> {
    const isInitialized = await this.npcRepo.findInitFlag(npcId as ID, saveId, 'invInitialized');
    return !isInitialized;
  }

  async markInvInitialized(saveId: ID, npcId: string): Promise<void> {
    await this.npcRepo.updateInitFlag(npcId as ID, saveId, 'invInitialized');
  }

  /**
   * 检查 NPC 技能是否需要初始化（P0-1 v1.1 修复语义 BUG）。
   * 返回 true=需要初始化，false=已初始化。
   */
  async ensureSkillInitialized(saveId: ID, npcId: string): Promise<boolean> {
    const isInitialized = await this.npcRepo.findInitFlag(npcId as ID, saveId, 'skillInitialized');
    return !isInitialized;
  }

  async markSkillInitialized(saveId: ID, npcId: string): Promise<void> {
    await this.npcRepo.updateInitFlag(npcId as ID, saveId, 'skillInitialized');
  }

  /**
   * 批量查询多个 NPC 的初始化状态（P0-1 优化）。
   * 对每个 NPC 并行查询 attr/inv/skill 三类 init flag，串行处理 NPC 列表。
   * 返回真正的 needsInit 语义：true=需要初始化（init flag=0），false=已初始化（init flag=1）。
   * 返回结果与入参 npcIds 顺序一致。
   */
  async batchCheckInitStatus(saveId: ID, npcIds: ID[]): Promise<NpcInitStatus[]> {
    const results: NpcInitStatus[] = [];
    for (const npcId of npcIds) {
      try {
        const [attrIsInitialized, invIsInitialized, skillIsInitialized] = await Promise.all([
          this.npcRepo.findInitFlag(npcId, saveId, 'attrInitialized'),
          this.npcRepo.findInitFlag(npcId, saveId, 'invInitialized'),
          this.npcRepo.findInitFlag(npcId, saveId, 'skillInitialized'),
        ]);
        results.push({
          npcId,
          attrNeedsInit: !attrIsInitialized,
          invNeedsInit: !invIsInitialized,
          skillNeedsInit: !skillIsInitialized,
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to batch check NPC init status', {
          saveId, npcId, error: errorMessage,
        });
        throw error;
      }
    }
    return results;
  }

  /**
   * 批量标记 NPC 的初始化完成状态（P0-1 优化）。
   * 在单个事务内执行所有标记，保证原子性（任一标记失败则整体回滚）。
   * 仅处理 NpcInitUpdate 中显式设为 true 的字段，undefined 字段保持原状态。
   */
  async batchMarkInitialized(saveId: ID, updates: NpcInitUpdate[], trx?: Knex.Transaction): Promise<void> {
    if (updates.length === 0) return;

    await this.runInTransaction(trx, async (t) => {
      for (const update of updates) {
        if (update.attrInitialized === true) {
          await this.npcRepo.updateInitFlag(update.npcId, saveId, 'attrInitialized', t);
        }
        if (update.invInitialized === true) {
          await this.npcRepo.updateInitFlag(update.npcId, saveId, 'invInitialized', t);
        }
        if (update.skillInitialized === true) {
          await this.npcRepo.updateInitFlag(update.npcId, saveId, 'skillInitialized', t);
        }
      }
    });

    this.logger.info('Batch marked NPC init flags', {
      saveId,
      count: updates.length,
      attrCount: updates.filter(u => u.attrInitialized === true).length,
      invCount: updates.filter(u => u.invInitialized === true).length,
      skillCount: updates.filter(u => u.skillInitialized === true).length,
    });
  }

  // ===========================================================================
  // NPC 记忆与知识系统
  // ===========================================================================

  async addMemory(
    saveId: ID,
    npcId: ID,
    content: string,
    type: NPCMemory['type'],
    importance: number = 1,
    tags: string[] = [],
  ): Promise<NPCMemory> {
    try {
      const npc = await this.getNPC(saveId, npcId);
      const customData: Record<string, unknown> = npc.customData ?? {};

      let memories: NPCMemory[] = Array.isArray(customData.memories)
        ? customData.memories as NPCMemory[]
        : [];

      const newMemory: NPCMemory = {
        id: generateReadableId('mem', npcId + '_' + type),
        content,
        type,
        importance: Math.max(1, Math.min(5, importance)),
        timestamp: Date.now() as Timestamp,
        tags,
      };

      memories.push(newMemory);

      if (memories.length > 100) {
        memories.sort((a, b) => b.importance - a.importance);
        memories = memories.slice(0, 100);
      }

      customData.memories = memories;
      const updated = await this.npcRepo.updateCustomData(npcId, saveId, customData);
      if (!updated) throw new Error(`NPC not found after memory update: ${npcId}`);

      this.logger.info('NPC memory added', { npcId, type, importance, content: content.substring(0, 50) });
      return newMemory;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to add NPC memory', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  // 模块3 简化：删除 addKnowledge（NPCKnowledge 已迁移到 PERCEIVES 感知边，由 set_awareness 替代）

  async compressMemories(
    saveId: ID,
    npcId: ID,
    options?: CompressOptions,
    trx?: Knex.Transaction,
  ): Promise<MemoryCompressionResult> {
    try {
      const npc = await this.getNPC(saveId, npcId);
      if (!npc) {
        return { success: false, beforeCount: 0, afterCount: 0, compressedCount: 0, protectedCount: 0, compressionRatio: 0, summaries: [], error: `NPC not found: ${npcId}` };
      }

      const timeWindowMs = options?.timeWindowMs ?? 86400000;
      const protectThreshold = options?.protectThreshold ?? 4;
      const maxSummaryLength = options?.maxSummaryLength ?? 100;

      const customData: Record<string, unknown> = npc.customData ?? {};

      let memories: NPCMemory[] = Array.isArray(customData.memories)
        ? customData.memories as NPCMemory[]
        : [];

      const beforeCount = memories.length;

      if (beforeCount <= 1) {
        return {
          success: true,
          beforeCount,
          afterCount: beforeCount,
          compressedCount: 0,
          protectedCount: memories.filter(m => m.importance >= protectThreshold).length,
          compressionRatio: 0,
          summaries: [],
        };
      }

      const protectedMemories = memories.filter(m => m.importance >= protectThreshold);
      const candidates = memories.filter(m => m.importance < protectThreshold);

      const candidatesByType = new Map<string, NPCMemory[]>();
      for (const mem of candidates) {
        const group = candidatesByType.get(mem.type) || [];
        group.push(mem);
        candidatesByType.set(mem.type, group);
      }

      const compressedMemories: NPCMemory[] = [...protectedMemories];
      const summaries: MemoryCompressionResult['summaries'] = [];

      for (const [type, group] of candidatesByType) {
        group.sort((a, b) => a.timestamp - b.timestamp);

        let windowStart = 0;
        for (let i = 0; i < group.length; i++) {
          if (i === 0) {
            windowStart = i;
            continue;
          }

          if (group[i].timestamp - group[windowStart].timestamp > timeWindowMs || i === group.length - 1) {
            const endIndex = i === group.length - 1 ? i + 1 : i;
            const windowGroup = group.slice(windowStart, endIndex);

            if (windowGroup.length > 1) {
              const mergedTags = [...new Set(windowGroup.flatMap(m => m.tags))];
              const maxImportance = Math.max(...windowGroup.map(m => m.importance));
              const earliestTime = windowGroup[0].timestamp;
              const latestTime = windowGroup[endIndex - 1].timestamp;

              const typeLabelMap: Record<string, string> = {
                interaction: '互动',
                quest: '任务',
                trade: '交易',
                combat: '战斗',
                event: '事件',
                secret: '秘密',
              };

              const sampleContent = windowGroup.map(m => {
                const content = m.content.length > 20 ? m.content.substring(0, 20) + '...' : m.content;
                return content;
              });

              let summaryContent = `[摘要]${typeLabelMap[type] || type}×${windowGroup.length}次`;
              if (sampleContent.length <= 3) {
                summaryContent += ': ' + sampleContent.join('; ');
              } else {
                summaryContent += `(${sampleContent[0]}; ...; ${sampleContent[sampleContent.length - 1]})`;
              }

              if (summaryContent.length > maxSummaryLength) {
                summaryContent = summaryContent.substring(0, maxSummaryLength - 3) + '...';
              }

              const summaryMemory: NPCMemory = {
                id: generateReadableId('cmp', npcId + '_' + type),
                content: summaryContent,
                type: type as NPCMemory['type'],
                importance: Math.min(maxImportance + 1, 3),
                timestamp: latestTime as Timestamp,
                tags: mergedTags,
              };

              compressedMemories.push(summaryMemory);
              summaries.push({
                originalType: type,
                mergedCount: windowGroup.length,
                summaryContent,
                timeRange: { start: earliestTime as Timestamp, end: latestTime as Timestamp },
                preservedTags: mergedTags,
              });
            } else {
              compressedMemories.push(windowGroup[0]);
            }

            windowStart = i;
          }
        }
      }

      compressedMemories.sort((a, b) => {
        if (b.importance !== a.importance) return b.importance - a.importance;
        return b.timestamp - a.timestamp;
      });

      if (compressedMemories.length > 100) {
        compressedMemories.splice(100);
      }

      customData.memories = compressedMemories;
      const updated = await this.npcRepo.updateCustomData(npcId, saveId, customData, trx);
      if (!updated) throw new Error(`NPC not found after memory compression: ${npcId}`);

      this.logger.info('NPC memories compressed', {
        npcId,
        beforeCount,
        afterCount: compressedMemories.length,
        compressedCount: beforeCount - compressedMemories.length,
        summaryCount: summaries.length,
      });

      return {
        success: true,
        beforeCount,
        afterCount: compressedMemories.length,
        compressedCount: beforeCount - compressedMemories.length,
        protectedCount: protectedMemories.length,
        compressionRatio: beforeCount > 0 ? (beforeCount - compressedMemories.length) / beforeCount : 0,
        summaries,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to compress NPC memories', { saveId, npcId, error: errorMessage });
      return {
        success: false,
        beforeCount: 0,
        afterCount: 0,
        compressedCount: 0,
        protectedCount: 0,
        compressionRatio: 0,
        summaries: [],
        error: errorMessage,
      };
    }
  }

  // ===========================================================================
  // NPC 目标系统
  // ===========================================================================

  async createGoal(
    saveId: string,
    npcId: string,
    goal: {
      type: 'long_term' | 'mid_term';
      category: GoalCategory;
      description: string;
      priority?: number;
      relatedEntityIds?: string[];
    },
  ): Promise<string> {
    const resolvedNpcId = await this.resolveNpcId(saveId, npcId);
    const created = await this.goalRepo.insert({
      saveId,
      npcId: resolvedNpcId,
      type: goal.type,
      category: goal.category,
      description: goal.description,
      priority: goal.priority ?? 5,
      status: 'active',
      relatedEntityIds: goal.relatedEntityIds ?? [],
      progress: '',
    });
    return created.id;
  }

  async updateGoal(
    saveId: string,
    goalId: string,
    updates: Partial<Pick<NPCGoal, 'status' | 'priority' | 'progress' | 'description'>>,
  ): Promise<void> {
    const patch: Partial<NPCGoal> = {};
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.progress !== undefined) patch.progress = updates.progress;
    if (updates.description !== undefined) patch.description = updates.description;
    await this.goalRepo.update(saveId as ID, goalId as ID, patch);
  }

  // ===========================================================================
  // NPC 货币与数值系统
  // ===========================================================================

  async modifyCurrency(
    saveId: string,
    npcId: string,
    currencyType: string,
    delta: number,
  ): Promise<Record<string, number>> {
    const npc = await this.getNPC(saveId, npcId as ID);
    const currency = { ...npc.currency };
    currency[currencyType] = (currency[currencyType] ?? 0) + delta;
    if (currency[currencyType] < 0) throw new Error(`Insufficient currency: ${currencyType}`);

    const updated = await this.npcRepo.update(npcId as ID, saveId, { currency });
    if (!updated) throw new Error(`NPC not found after currency update: ${npcId}`);
    return currency;
  }

  async addExperience(saveId: ID, npcId: ID, amount: number, trx?: Knex.Transaction): Promise<{ experience: number; level: number; leveledUp: boolean }> {
    return this.runInTransaction(trx, async (t) => {
      const npc = await this.getNPC(saveId, npcId, t);
      const customData: Record<string, unknown> = npc.customData ?? {};
      const currentExp = (customData.experience as number) || 0;
      const currentLevel = npc.level || 1;

      const newExp = currentExp + amount;
      const newLevel = Math.floor(newExp / 100) + 1;
      const leveledUp = newLevel > currentLevel;

      const updatedCustomData = { ...customData, experience: newExp };
      const updated = await this.npcRepo.update(npcId, saveId, { customData: updatedCustomData, level: newLevel }, t);
      if (!updated) throw new Error(`NPC not found after experience update: ${npcId}`);

      if (leveledUp) {
        await this.numericalService.recalculateNpcAttributes(saveId, npcId, t);
      }

      this.logger.info('NPC experience added', { npcId, amount, newExp, newLevel, leveledUp });

      return { experience: newExp, level: newLevel, leveledUp };
    });
  }

  async recalculateStats(saveId: string, npcId: string): Promise<void> {
    await this.numericalService.recalculateNpcAttributes(saveId, npcId);
  }

  // ===========================================================================
  // INPCService 新增方法（S2-3 skill 跨领域调用）
  // ===========================================================================

  async modifyNpcResource(
    saveId: ID,
    npcId: ID,
    resourceType: 'mp' | 'hp' | 'stamina' | 'currency',
    delta: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const npc = await this.npcRepo.findById(npcId, saveId, trx);
    if (!npc) throw new Error(`NPC not found: ${npcId}`);

    if (resourceType === 'currency') {
      const currency = { ...npc.currency };
      const newGold = (currency.gold ?? 0) + delta;
      if (newGold < 0) throw new Error('Insufficient currency: gold');
      currency.gold = newGold;
      const updated = await this.npcRepo.update(npcId, saveId, { currency }, trx);
      if (!updated) throw new Error(`NPC not found after currency update: ${npcId}`);
      return;
    }

    if (resourceType === 'stamina') {
      const customData: Record<string, unknown> = { ...npc.customData };
      const currentStamina = (customData.stamina as number) ?? 0;
      customData.stamina = Math.max(0, currentStamina + delta);
      const updated = await this.npcRepo.updateCustomData(npcId, saveId, customData, trx);
      if (!updated) throw new Error(`NPC not found after stamina update: ${npcId}`);
      return;
    }

    const currentValue = resourceType === 'mp' ? (npc.currentMp ?? 0) : (npc.currentHp ?? 0);
    const maxValue = resourceType === 'mp' ? (npc.maxMp ?? currentValue) : (npc.maxHp ?? currentValue);
    const newValue = Math.max(0, Math.min(maxValue, currentValue + delta));

    const patch: Partial<NPCProfile> = resourceType === 'mp'
      ? { currentMp: newValue }
      : { currentHp: newValue };
    const updated = await this.npcRepo.update(npcId, saveId, patch, trx);
    if (!updated) throw new Error(`NPC not found after ${resourceType} update: ${npcId}`);
  }

  async getNpcResources(
    saveId: ID,
    npcId: ID,
    trx?: Knex.Transaction,
  ): Promise<{
    currentMp: number | null;
    currentHp: number | null;
    currentStamina: number | null;
    currency: Record<string, number>;
  }> {
    const npc = await this.npcRepo.findById(npcId, saveId, trx);
    if (!npc) throw new Error(`NPC not found: ${npcId}`);

    return {
      currentMp: npc.currentMp,
      currentHp: npc.currentHp,
      currentStamina: (npc.customData?.stamina as number | undefined) ?? null,
      currency: npc.currency,
    };
  }

  async getNpcAttributes(saveId: ID, npcId: ID, trx?: Knex.Transaction): Promise<Record<string, unknown>> {
    const npc = await this.npcRepo.findById(npcId, saveId, trx);
    if (!npc) throw new Error(`NPC not found: ${npcId}`);
    return npc.attributes;
  }

  // ===========================================================================
  // 私有辅助方法
  // ===========================================================================
  // 模块2 简化：删除 getDispositionFromValue + isServiceUnlocked 私有方法
  // （旧关系系统已删除，disposition 阈值映射和服务解锁不再需要）
}
