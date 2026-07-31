import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type { EntityType, RelationType, AwarenessSource, RelationshipSource, AwarenessSourceType, RelationshipSourceType } from './types.js';
import { EntityGraphService } from './EntityGraphService.js';
import { EntityGraphRepository } from './EntityGraphRepository.js';
import { AwarenessRepository } from './AwarenessRepository.js';
import { RelationshipRepository } from './RelationshipRepository.js';
import { EntityGraphResolver } from './EntityGraphResolver.js';
import { NullEntityGraphCache } from './EntityGraphCache.js';
import type { ICharacterReadPort } from './types.js';
import { CharacterRepository } from '../character/CharacterRepository.js';
import { EntityResolutionError } from '../shared/entity-resolver/EntityResolutionError.js';
import type { NPCServiceTool } from '../npc/NPCServiceTool.js';
import type { MapServiceTool } from '../map/MapServiceTool.js';
import { validateRequired } from '../../utils/paramValidator.js';

/**
 * Entity Graph Service Tool（模块4 重构 + Phase A 实体引用解析修复）。
 *
 * 模块4 变更：
 * - 删除 7 个纯图/元数据查询工具（get_node/get_edges/get_edges_by_relation/get_full_graph/get_subgraph/get_latest_snapshot/get_snapshot）
 * - 重命名 2 个业务查询工具（get_nodes_by_type → list_entities_by_type，get_nodes_by_location → list_entities_in_location）
 * - 新增 3 个业务聚合查询工具（get_entity_relations/get_npc_profile/get_location_summary）
 * - 保留模块3 的 PERCEIVES 感知边管理工具（set_awareness/get_awareness/set_relationship/get_relationship/get_awareness_batch/get_entity_awareness）
 *
 * Phase A 变更（2026-07-21）：
 * - 删除私有 resolveEntityRef（静默 fallback 反模式，§13.3 违规）
 * - 删除私有 getRepo（per-request 共享 Repository 替代）
 * - 新增 createEntityGraphRepository / createEntityGraphResolver / createCharacterReadPort（per-request 共享）
 * - 新增 resolveEntityId / resolveEntityPair（错误包装为 ToolResponse 失败结构，candidates 放入 data 子对象）
 * - 10 个工具方法（除 list_entities_by_type）改用 resolveEntityId / resolveEntityPair
 * - character 类型支持 'player' 别名自动匹配玩家角色（通过 ICharacterReadPort.findIdBySaveId）
 *
 * 组合根（D8）：createEntityGraphService(context) 内按请求创建 EntityGraphService，
 * 注入 EntityGraphRepository + EntityGraphCache + INPCService + IMapService（跨领域端口接口，§7.1）。
 */
export class EntityGraphServiceTool extends BaseTool {
  constructor(
    private readonly npcServiceTool: NPCServiceTool,
    private readonly mapServiceTool: MapServiceTool,
  ) {
    super(
      'entity_graph_service' as ToolType,
      'Entity Graph Service',
      '实体关系图服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );
    this.registerMethods();
  }

  /**
   * 创建 per-request EntityGraphService（组合根入口，D8）。
   * 注入跨领域端口 INPCService/IMapService（§7.1），供 getNpcProfile/getLocationSummary 使用。
   * 006 升级：注入 AwarenessRepository + RelationshipRepository（双表方案）。
   * 通过 requestScope 在请求内共享。
   */
  async createEntityGraphService(context: ToolContext): Promise<EntityGraphService> {
    return context.requestScope.getOrCompute('entityGraph', async () => {
      // 复用同一 Repository 实例供 Service 和 Resolver 共享
      const repo = await this.createEntityGraphRepository(context);
      // 006 升级：per-request awareness/relationship Repository
      const awarenessRepo = await this.createAwarenessRepository(context);
      const relationshipRepo = await this.createRelationshipRepository(context);
      // LLM 工具场景使用 NullEntityGraphCache（per-request 实例，无跨请求复用价值）
      // 生产缓存由 init.ts 的 entityGraphService 单例负责（createEntityGraphPort 使用）
      const cache = new NullEntityGraphCache();
      const npcService = await this.npcServiceTool.createNPCService(context);
      const mapService = await this.mapServiceTool.createMapService(context);
      return new EntityGraphService(repo, cache, awarenessRepo, relationshipRepo, npcService, mapService);
    });
  }

  /**
   * 创建 per-request 共享 AwarenessRepository（006 升级）。
   */
  private async createAwarenessRepository(context: ToolContext): Promise<AwarenessRepository> {
    return context.requestScope.getOrCompute('awarenessRepository', async () => {
      const db = context.requestScope.getDb();
      return new AwarenessRepository(db);
    });
  }

  /**
   * 创建 per-request 共享 RelationshipRepository（006 升级）。
   */
  private async createRelationshipRepository(context: ToolContext): Promise<RelationshipRepository> {
    return context.requestScope.getOrCompute('relationshipRepository', async () => {
      const db = context.requestScope.getDb();
      return new RelationshipRepository(db);
    });
  }

  /**
   * 创建 per-request 共享 EntityGraphRepository（同一实例供 Service 和 Resolver 复用）。
   * 通过 requestScope 在请求内共享。
   */
  private async createEntityGraphRepository(context: ToolContext): Promise<EntityGraphRepository> {
    return context.requestScope.getOrCompute('entityGraphRepository', async () => {
      const db = context.requestScope.getDb();
      return new EntityGraphRepository(db);
    });
  }

  /**
   * 创建 per-request 共享 ICharacterReadPort 端口适配器（player 别名解析端口）。
   * 参考 agents/agent-deps.ts:405-416 的 characterReadPort 实现。
   * 通过 requestScope 在请求内共享。
   */
  private async createCharacterReadPort(context: ToolContext): Promise<ICharacterReadPort> {
    return context.requestScope.getOrCompute('characterReadPort', async () => {
      const db = context.requestScope.getDb();
      return {
        findBySaveId: async (saveId: string) => {
          const repo = new CharacterRepository(db);
          return repo.findBySaveIdWithNames(saveId) as unknown as Record<string, unknown>[];
        },
        findIdBySaveId: async (saveId: string) => {
          const repo = new CharacterRepository(db);
          const rows = await repo.findBySaveIdWithNames(saveId);
          return rows[0]?.id ?? null;
        },
      };
    });
  }

  /**
   * 创建 per-request 共享 EntityGraphResolver（按 entityType 分别缓存）。
   * 一个 Resolver 实例只解析一种 entityType。
   * characterReadPort 在所有类型都注入（实现层简化），仅 character 类型 + ref='player' 时使用。
   */
  private async createEntityGraphResolver(
    context: ToolContext,
    entityType: EntityType,
  ): Promise<EntityGraphResolver> {
    const cacheKey = `entityGraphResolver:${entityType}`;
    return context.requestScope.getOrCompute(cacheKey, async () => {
      const db = context.requestScope.getDb();
      const repo = await this.createEntityGraphRepository(context);
      const characterReadPort = await this.createCharacterReadPort(context);
      return new EntityGraphResolver(repo, entityType, db, characterReadPort);
    });
  }

  /**
   * 解析单个实体引用 + 错误包装为 ToolResponse 失败结构。
   * - 不传 context.timestamp 作为 ref.timestamp（语义不严格正确：context.timestamp 是请求时间戳，
   *   §13.2 要求的 timestamp 是实体创建时间戳。让 multiple_match_no_timestamp 触发由 Agent 选择）
   * - candidates 等结构化字段放入 ToolResponse.data 子对象（ToolResponse 接口无索引签名，详见设计 §14）
   * - 其他错误（非 EntityResolutionError）向上抛，由 Agent 框架统一处理
   */
  private async resolveEntityId(
    context: ToolContext,
    entityType: EntityType,
    ref: string,
  ): Promise<{ success: true; entityId: string } | { success: false; response: ToolResponse }> {
    try {
      const resolver = await this.createEntityGraphResolver(context, entityType);
      const resolved = await resolver.resolve({
        saveId: context.saveId,
        entityType,
        ref,
      });
      return { success: true, entityId: resolved.entityId };
    } catch (err: unknown) {
      if (err instanceof EntityResolutionError) {
        return {
          success: false,
          response: {
            success: false,
            error: err.message,
            data: {
              candidates: err.candidates.map(c => ({ entityId: c.entityId, label: c.label })),
              entityType: err.entityType,
              ref: err.ref,
            },
          },
        };
      }
      throw err;
    }
  }

  /**
   * 解析 observer/target 实体引用对（6 个 PERCEIVES 工具方法共用，消除重复模板代码）。
   * 任一解析失败即返回失败 ToolResponse，两个都成功才返回 entityId 对。
   */
  private async resolveEntityPair(
    context: ToolContext,
    observerType: EntityType,
    observerId: string,
    targetType: EntityType,
    targetId: string,
  ): Promise<{ success: true; observerEntityId: string; targetEntityId: string } | { success: false; response: ToolResponse }> {
    const observerResult = await this.resolveEntityId(context, observerType, observerId);
    if (!observerResult.success) return { success: false, response: observerResult.response };
    const targetResult = await this.resolveEntityId(context, targetType, targetId);
    if (!targetResult.success) return { success: false, response: targetResult.response };
    return { success: true, observerEntityId: observerResult.entityId, targetEntityId: targetResult.entityId };
  }

  private registerMethods(): void {
    // === 模块4 L2-2：业务查询工具（重命名） ===

    this.registerMethod({
      name: 'list_entities_by_type',
      description: '获取指定类型的所有实体',
      parameters: {
        entityType: { type: 'string', required: true, description: '实体类型(character/npc/location/item/skill/quest/event)' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['entityType']);
        const service = await this.createEntityGraphService(context);
        const nodes = await service.getNodesByType(context.saveId, params.entityType as EntityType);
        return { success: true, data: nodes };
      },
    });

    this.registerMethod({
      name: 'list_entities_in_location',
      description: '获取指定地点下的所有实体(通过LOCATED_AT边查询)',
      parameters: {
        locationId: { type: 'string', required: true, description: '地点ID或名称(不含前缀)' },
        includeDescendants: { type: 'boolean', required: false, description: '是否递归包含子地点的实体(默认false)' },
        nodeTypeFilter: { type: 'array', required: false, description: '只返回这些类型的节点(如["npc","item"])' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['locationId']);
        const service = await this.createEntityGraphService(context);
        const locationResult = await this.resolveEntityId(context, 'location', params.locationId as string);
        if (!locationResult.success) return locationResult.response;
        const nodes = await service.getNodesByLocation(
          context.saveId,
          locationResult.entityId,
          {
            includeDescendants: params.includeDescendants as boolean | undefined,
            nodeTypeFilter: params.nodeTypeFilter as string[] | undefined,
          },
        );
        return { success: true, data: nodes };
      },
    });

    // === 模块4 L2-3/L2-4/L2-5：业务聚合查询工具（新增） ===

    this.registerMethod({
      name: 'get_entity_relations',
      description: '查询实体的所有关系(含认识程度和关系倾向,区分结构性关系与感知关系)',
      parameters: {
        entityType: { type: 'string', required: true, description: '实体类型(character/npc/location/item/skill/quest/event)' },
        entityId: { type: 'string', required: true, description: '实体ID或名称' },
        relationType: { type: 'string', required: false, description: '可选:只查特定关系类型(如PERCEIVES/KNOWS/LOCATED_AT)' },
        direction: { type: 'string', required: false, description: '可选:方向过滤 outgoing(出边)/incoming(入边)/both(双向,默认)' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['entityType', 'entityId']);
        const service = await this.createEntityGraphService(context);
        const entityResult = await this.resolveEntityId(context, params.entityType as EntityType, params.entityId as string);
        if (!entityResult.success) return entityResult.response;
        const result = await service.getEntityRelations(
          context.saveId,
          params.entityType as EntityType,
          entityResult.entityId,
          {
            ...(params.relationType ? { relationType: params.relationType as RelationType } : {}),
            ...(params.direction ? { direction: params.direction as 'outgoing' | 'incoming' | 'both' } : {}),
          },
        );
        return { success: true, data: result };
      },
    });

    this.registerMethod({
      name: 'get_npc_profile',
      description: '一次查询返回NPC完整画像(含基本信息+结构性关系+感知关系,消除N+1)',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC的ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['npcId']);
        const service = await this.createEntityGraphService(context);
        const npcResult = await this.resolveEntityId(context, 'npc', params.npcId as string);
        if (!npcResult.success) return npcResult.response;
        const profile = await service.getNpcProfile(context.saveId, npcResult.entityId);
        return { success: true, data: profile };
      },
    });

    this.registerMethod({
      name: 'get_location_summary',
      description: '查询地点概览(含NPC/物品/子地点/连接)',
      parameters: {
        locationId: { type: 'string', required: true, description: '地点的ID或名称' },
        includeDescendants: { type: 'boolean', required: false, description: '是否递归包含所有层级的子地点(默认false,仅直接子地点)' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['locationId']);
        const service = await this.createEntityGraphService(context);
        const locationResult = await this.resolveEntityId(context, 'location', params.locationId as string);
        if (!locationResult.success) return locationResult.response;
        const summary = await service.getLocationSummary(
          context.saveId,
          locationResult.entityId,
          (params.includeDescendants as boolean) ?? false,
        );
        return { success: true, data: summary };
      },
    });

    // === 006 升级：awareness/relationship 工具（delta 语义 + 结构化 source） ===

    this.registerMethod({
      name: 'set_awareness',
      description: '调整元素A对元素B的认识值(delta累加语义,正数提升认识,负数降低)。currentScore=clamp(累加delta,-10,+10)。source结构化记录变更来源,informed_by用于信息传播链追溯。',
      parameters: {
        observerType: { type: 'string', required: true, description: '认识者实体类型(character/npc/location/item/quest/event/faction/skill/goal)' },
        observerId: { type: 'string', required: true, description: '认识者实体ID或名称' },
        targetType: { type: 'string', required: true, description: '被认识者实体类型' },
        targetId: { type: 'string', required: true, description: '被认识者实体ID或名称' },
        scoreDelta: { type: 'number', required: true, description: '本次认识变更量(正数提升,负数降低,如深入交谈+3/玩家撒谎被发现-5/初次见面+1)' },
        sourceType: { type: 'string', required: true, description: '来源类型: direct_observation(亲眼所见)/informed_by(他人告知)/overheard(偶然听到)/rumor(传闻)/player_stated(玩家自述)/inferred(推断)' },
        awarenessNote: { type: 'string', required: false, description: '认识备注(如"村长告知此矮人来调查暗影森林")' },
        informerType: { type: 'string', required: false, description: 'sourceType=informed_by时必填:信息源实体类型(如npc)' },
        informerId: { type: 'string', required: false, description: 'sourceType=informed_by时必填:信息源实体ID或名称(如村长艾德温)' },
        topicType: { type: 'string', required: false, description: '告知主题类型(如quest,可选,用于追溯传播链)' },
        topicId: { type: 'string', required: false, description: '告知主题ID或名称(如调查暗影森林)' },
        sourceNote: { type: 'string', required: false, description: '来源备注(自由文本补充,如"村长在酒馆告知")' },
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId', 'targetType', 'targetId', 'scoreDelta', 'sourceType']);
        // 校验 sourceType=informed_by 时必填 informerType/informerId
        if (params.sourceType === 'informed_by') {
          validateRequired(params, ['informerType', 'informerId']);
        }
        const service = await this.createEntityGraphService(context);
        const pair = await this.resolveEntityPair(
          context,
          params.observerType as EntityType, params.observerId as string,
          params.targetType as EntityType, params.targetId as string,
        );
        if (!pair.success) return pair.response;
        // 解析 informer/topic 实体引用（如传入）
        let resolvedInformerType: EntityType | undefined;
        let resolvedInformerId: string | undefined;
        if (params.informerType && params.informerId) {
          const informerResult = await this.resolveEntityId(
            context,
            params.informerType as EntityType,
            params.informerId as string,
          );
          if (!informerResult.success) return informerResult.response;
          resolvedInformerType = params.informerType as EntityType;
          resolvedInformerId = informerResult.entityId;
        }
        let resolvedTopicType: EntityType | undefined;
        let resolvedTopicId: string | undefined;
        if (params.topicType && params.topicId) {
          const topicResult = await this.resolveEntityId(
            context,
            params.topicType as EntityType,
            params.topicId as string,
          );
          if (!topicResult.success) return topicResult.response;
          resolvedTopicType = params.topicType as EntityType;
          resolvedTopicId = topicResult.entityId;
        }
        const source: AwarenessSource = {
          type: params.sourceType as AwarenessSourceType,
          ...(resolvedInformerType ? { informerType: resolvedInformerType } : {}),
          ...(resolvedInformerId ? { informerId: resolvedInformerId } : {}),
          ...(resolvedTopicType ? { topicType: resolvedTopicType } : {}),
          ...(resolvedTopicId ? { topicId: resolvedTopicId } : {}),
          ...(params.sourceNote ? { note: params.sourceNote as string } : {}),
          occurredAt: Date.now(),
        };
        const result = await service.setAwareness(
          context.saveId,
          params.observerType as EntityType, pair.observerEntityId,
          params.targetType as EntityType, pair.targetEntityId,
          params.scoreDelta as number,
          source,
          params.awarenessNote as string | undefined,
        );
        return { success: true, data: result };
      },
    });

    this.registerMethod({
      name: 'get_awareness',
      description: '查询元素A对元素B的当前认识状态(从states表读取,O(1))。',
      parameters: {
        observerType: { type: 'string', required: true, description: '认识者实体类型' },
        observerId: { type: 'string', required: true, description: '认识者实体ID或名称' },
        targetType: { type: 'string', required: true, description: '被认识者实体类型' },
        targetId: { type: 'string', required: true, description: '被认识者实体ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId', 'targetType', 'targetId']);
        const service = await this.createEntityGraphService(context);
        const pair = await this.resolveEntityPair(
          context,
          params.observerType as EntityType, params.observerId as string,
          params.targetType as EntityType, params.targetId as string,
        );
        if (!pair.success) return pair.response;
        const awareness = await service.getAwareness(
          context.saveId,
          params.observerType as EntityType, pair.observerEntityId,
          params.targetType as EntityType, pair.targetEntityId,
        );
        return { success: true, data: awareness };
      },
    });

    this.registerMethod({
      name: 'get_awareness_history',
      description: '查询A对B的awareness变更历史(全部事件,按时间正序)。用于审核反查信息传播链、剧情回顾。',
      parameters: {
        observerType: { type: 'string', required: true, description: '认识者实体类型' },
        observerId: { type: 'string', required: true, description: '认识者实体ID或名称' },
        targetType: { type: 'string', required: true, description: '被认识者实体类型' },
        targetId: { type: 'string', required: true, description: '被认识者实体ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId', 'targetType', 'targetId']);
        const service = await this.createEntityGraphService(context);
        const pair = await this.resolveEntityPair(
          context,
          params.observerType as EntityType, params.observerId as string,
          params.targetType as EntityType, params.targetId as string,
        );
        if (!pair.success) return pair.response;
        const history = await service.getAwarenessHistory(
          context.saveId,
          params.observerType as EntityType, pair.observerEntityId,
          params.targetType as EntityType, pair.targetEntityId,
        );
        return { success: true, data: history };
      },
    });

    this.registerMethod({
      name: 'set_relationship',
      description: '调整元素A对元素B的关系值(delta累加语义,正数提升喜欢,负数降低)。currentScore=clamp(累加delta,-10,+10)。relationship完全手动,不自动化。',
      parameters: {
        observerType: { type: 'string', required: true, description: '关系持有者实体类型' },
        observerId: { type: 'string', required: true, description: '关系持有者实体ID或名称' },
        targetType: { type: 'string', required: true, description: '关系目标实体类型' },
        targetId: { type: 'string', required: true, description: '关系目标实体ID或名称' },
        scoreDelta: { type: 'number', required: true, description: '本次关系变更量(正数提升喜欢,负数降低,如玩家救命+5/玩家撒谎-3)' },
        sourceType: { type: 'string', required: true, description: '来源类型: direct_observation/informed_by/overheard/rumor/player_stated/inferred' },
        relationshipNote: { type: 'string', required: false, description: '关系备注(如"曾经救过我的命")' },
        informerType: { type: 'string', required: false, description: 'sourceType=informed_by时必填:信息源实体类型' },
        informerId: { type: 'string', required: false, description: 'sourceType=informed_by时必填:信息源实体ID或名称' },
        topicType: { type: 'string', required: false, description: '告知主题类型(可选)' },
        topicId: { type: 'string', required: false, description: '告知主题ID或名称(可选)' },
        sourceNote: { type: 'string', required: false, description: '来源备注(自由文本补充)' },
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId', 'targetType', 'targetId', 'scoreDelta', 'sourceType']);
        if (params.sourceType === 'informed_by') {
          validateRequired(params, ['informerType', 'informerId']);
        }
        const service = await this.createEntityGraphService(context);
        const pair = await this.resolveEntityPair(
          context,
          params.observerType as EntityType, params.observerId as string,
          params.targetType as EntityType, params.targetId as string,
        );
        if (!pair.success) return pair.response;
        let resolvedInformerType: EntityType | undefined;
        let resolvedInformerId: string | undefined;
        if (params.informerType && params.informerId) {
          const informerResult = await this.resolveEntityId(
            context,
            params.informerType as EntityType,
            params.informerId as string,
          );
          if (!informerResult.success) return informerResult.response;
          resolvedInformerType = params.informerType as EntityType;
          resolvedInformerId = informerResult.entityId;
        }
        let resolvedTopicType: EntityType | undefined;
        let resolvedTopicId: string | undefined;
        if (params.topicType && params.topicId) {
          const topicResult = await this.resolveEntityId(
            context,
            params.topicType as EntityType,
            params.topicId as string,
          );
          if (!topicResult.success) return topicResult.response;
          resolvedTopicType = params.topicType as EntityType;
          resolvedTopicId = topicResult.entityId;
        }
        const source: RelationshipSource = {
          type: params.sourceType as RelationshipSourceType,
          ...(resolvedInformerType ? { informerType: resolvedInformerType } : {}),
          ...(resolvedInformerId ? { informerId: resolvedInformerId } : {}),
          ...(resolvedTopicType ? { topicType: resolvedTopicType } : {}),
          ...(resolvedTopicId ? { topicId: resolvedTopicId } : {}),
          ...(params.sourceNote ? { note: params.sourceNote as string } : {}),
          occurredAt: Date.now(),
        };
        const result = await service.setRelationship(
          context.saveId,
          params.observerType as EntityType, pair.observerEntityId,
          params.targetType as EntityType, pair.targetEntityId,
          params.scoreDelta as number,
          source,
          params.relationshipNote as string | undefined,
        );
        return { success: true, data: result };
      },
    });

    this.registerMethod({
      name: 'get_relationship',
      description: '查询元素A对元素B的当前关系状态。',
      parameters: {
        observerType: { type: 'string', required: true, description: '关系持有者实体类型' },
        observerId: { type: 'string', required: true, description: '关系持有者实体ID或名称' },
        targetType: { type: 'string', required: true, description: '关系目标实体类型' },
        targetId: { type: 'string', required: true, description: '关系目标实体ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId', 'targetType', 'targetId']);
        const service = await this.createEntityGraphService(context);
        const pair = await this.resolveEntityPair(
          context,
          params.observerType as EntityType, params.observerId as string,
          params.targetType as EntityType, params.targetId as string,
        );
        if (!pair.success) return pair.response;
        const relationship = await service.getRelationship(
          context.saveId,
          params.observerType as EntityType, pair.observerEntityId,
          params.targetType as EntityType, pair.targetEntityId,
        );
        return { success: true, data: relationship };
      },
    });

    this.registerMethod({
      name: 'get_relationship_history',
      description: '查询A对B的relationship变更历史(全部事件,按时间正序)。用于关系演变回顾、剧情追溯。',
      parameters: {
        observerType: { type: 'string', required: true, description: '关系持有者实体类型' },
        observerId: { type: 'string', required: true, description: '关系持有者实体ID或名称' },
        targetType: { type: 'string', required: true, description: '关系目标实体类型' },
        targetId: { type: 'string', required: true, description: '关系目标实体ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId', 'targetType', 'targetId']);
        const service = await this.createEntityGraphService(context);
        const pair = await this.resolveEntityPair(
          context,
          params.observerType as EntityType, params.observerId as string,
          params.targetType as EntityType, params.targetId as string,
        );
        if (!pair.success) return pair.response;
        const history = await service.getRelationshipHistory(
          context.saveId,
          params.observerType as EntityType, pair.observerEntityId,
          params.targetType as EntityType, pair.targetEntityId,
        );
        return { success: true, data: history };
      },
    });

    this.registerMethod({
      name: 'get_awareness_batch',
      description: '批量查询多个认识者对同一目标的认知(消除N+1查询,供信息边界提示词层使用)。',
      parameters: {
        observerType: { type: 'string', required: true, description: '认识者实体类型' },
        observerIds: { type: 'array', required: true, description: '认识者实体ID或名称列表' },
        targetType: { type: 'string', required: true, description: '被认识者实体类型' },
        targetId: { type: 'string', required: true, description: '被认识者实体ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerIds', 'targetType', 'targetId']);
        const service = await this.createEntityGraphService(context);
        // 批量解析 observerIds（任一失败即返回失败 ToolResponse，与 13.2 单引用失败语义一致）
        const observerIds: string[] = [];
        for (const rawId of (params.observerIds as string[])) {
          const result = await this.resolveEntityId(context, params.observerType as EntityType, rawId);
          if (!result.success) return result.response;
          observerIds.push(result.entityId);
        }
        const targetResult = await this.resolveEntityId(context, params.targetType as EntityType, params.targetId as string);
        if (!targetResult.success) return targetResult.response;
        const batch = await service.getAwarenessBatch(
          context.saveId,
          params.observerType as EntityType, observerIds,
          params.targetType as EntityType, targetResult.entityId,
        );
        return { success: true, data: batch };
      },
    });

    this.registerMethod({
      name: 'get_entity_awareness',
      description: '查询元素A对所有其他元素的认识(业务查询)。',
      parameters: {
        observerType: { type: 'string', required: true, description: '认识者实体类型' },
        observerId: { type: 'string', required: true, description: '认识者实体ID或名称' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['observerType', 'observerId']);
        const service = await this.createEntityGraphService(context);
        const observerResult = await this.resolveEntityId(context, params.observerType as EntityType, params.observerId as string);
        if (!observerResult.success) return observerResult.response;
        const list = await service.getEntityAwareness(
          context.saveId,
          params.observerType as EntityType, observerResult.entityId,
        );
        return { success: true, data: list };
      },
    });
  }
}
