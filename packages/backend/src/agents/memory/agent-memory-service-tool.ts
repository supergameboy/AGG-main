import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { EpisodicMemoryService } from './episodic-memory-service.js';
import { ProceduralMemoryService } from './procedural-memory-service.js';

/**
 * AgentMemoryServiceTool — Agent 记忆操作工具
 *
 * 提供 Agent 主动查询和写入记忆的能力。
 * 注意：压缩前记忆落盘由 before_compaction Hook 自动完成，不依赖此工具。
 * 此工具主要用于 Agent 在对话中主动检索记忆或写入特定记忆。
 */
export class AgentMemoryServiceTool extends BaseTool {
  private episodicService: EpisodicMemoryService | null = null;
  private proceduralService: ProceduralMemoryService | null = null;

  constructor() {
    super(
      'memory_service' as ToolType,
      'Memory Service',
      'Agent记忆服务 - 查询和写入情景记忆与程序化记忆',
      '1.0.0',
    );
    this.registerMethods();
  }

  setServices(episodic: EpisodicMemoryService, procedural: ProceduralMemoryService): void {
    this.episodicService = episodic;
    this.proceduralService = procedural;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'save_episodic_memory',
      description: '保存一条情景记忆(发生过什么)',
      summary: '保存情景记忆',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '事实描述' },
          type: {
            type: 'string',
            description: '记忆类型',
            enum: ['plot', 'relation', 'quest', 'item', 'location', 'skill', 'combat', 'dialogue'],
          },
          importance: { type: 'number', description: '重要性1-5', default: 3 },
          related_entities: { type: 'array', items: { type: 'string' }, description: '关联实体ID列表' },
        },
        required: ['content', 'type'],
      },
      isWrite: true,
      handler: async (params, context) => this.handleSaveEpisodic(params, context),
      returns: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          content: { type: 'string' },
          type: { type: 'string' },
          importance: { type: 'number' },
        },
        required: ['id', 'content', 'type', 'importance'],
      },
    });

    this.registerMethod({
      name: 'recall_episodic_memories',
      description: '检索情景记忆(按类型/重要性/关键词)',
      summary: '检索情景记忆',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '按类型过滤',
            enum: ['plot', 'relation', 'quest', 'item', 'location', 'skill', 'combat', 'dialogue'],
          },
          min_importance: { type: 'number', description: '最低重要性', default: 2 },
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '返回数量上限', default: 10 },
        },
      },
      isWrite: false,
      cacheable: true,
      handler: async (params, context) => this.handleRecallEpisodic(params, context),
      returns: {
        type: 'object',
        properties: {
          memories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                type: { type: 'string' },
                importance: { type: 'number' },
              },
            },
          },
        },
        required: ['memories'],
      },
    });

    this.registerMethod({
      name: 'save_procedural_memory',
      description: '保存一条程序化记忆(什么做法有效)',
      summary: '保存程序化记忆',
      parameters: {
        type: 'object',
        properties: {
          condition: { type: 'string', description: '触发条件描述' },
          action: { type: 'string', description: '推荐行为描述' },
          outcome: { type: 'string', description: '预期结果' },
          effectiveness: { type: 'number', description: '有效性1-5', default: 3 },
        },
        required: ['condition', 'action', 'outcome'],
      },
      isWrite: true,
      handler: async (params, context) => this.handleSaveProcedural(params, context),
      returns: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          condition: { type: 'string' },
          action: { type: 'string' },
          effectiveness: { type: 'number' },
        },
        required: ['id', 'condition', 'action', 'effectiveness'],
      },
    });

    this.registerMethod({
      name: 'recall_procedural_memories',
      description: '检索程序化记忆(按有效性/关键词)',
      summary: '检索程序化记忆',
      parameters: {
        type: 'object',
        properties: {
          min_effectiveness: { type: 'number', description: '最低有效性', default: 3 },
          context: { type: 'string', description: '当前上下文(用于匹配条件)' },
          limit: { type: 'number', description: '返回数量上限', default: 5 },
        },
      },
      isWrite: false,
      cacheable: true,
      handler: async (params, context) => this.handleRecallProcedural(params, context),
      returns: {
        type: 'object',
        properties: {
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                condition: { type: 'string' },
                action: { type: 'string' },
                effectiveness: { type: 'number' },
                usage_count: { type: 'number' },
              },
            },
          },
        },
        required: ['rules'],
      },
    });

    this.registerMethod({
      name: 'search_memories',
      description: '语义搜索记忆(情景+程序化)',
      summary: '搜索记忆',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '返回数量上限', default: 10 },
        },
        required: ['query'],
      },
      isWrite: false,
      cacheable: true,
      handler: async (params, context) => this.handleSearchMemories(params, context),
      returns: {
        type: 'object',
        properties: {
          episodic: { type: 'array', items: { type: 'object' } },
          procedural: { type: 'array', items: { type: 'object' } },
        },
        required: ['episodic', 'procedural'],
      },
    });
  }

  private async handleSaveEpisodic(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse> {
    if (!this.episodicService) {
      return { success: false, error: 'EpisodicMemoryService not initialized' };
    }

    const agentKey = context.agentType ?? 'gamemaster';
    const memory = await this.episodicService.save(context.saveId, agentKey, {
      content: params.content as string,
      type: params.type as 'plot' | 'relation' | 'quest' | 'item' | 'location' | 'skill' | 'combat' | 'dialogue',
      importance: params.importance as number | undefined,
      relatedEntities: params.related_entities as string[] | undefined,
    });

    return {
      success: true,
      data: {
        id: memory.id,
        content: memory.content,
        type: memory.type,
        importance: memory.importance,
      },
    };
  }

  private async handleRecallEpisodic(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse> {
    if (!this.episodicService) {
      return { success: false, error: 'EpisodicMemoryService not initialized' };
    }

    const agentKey = context.agentType ?? 'gamemaster';
    const query = params.query as string | undefined;

    let memories;
    if (query) {
      memories = await this.episodicService.search(
        context.saveId, agentKey, query, (params.limit as number) ?? 10,
      );
    } else {
      memories = await this.episodicService.recall(context.saveId, agentKey, {
        type: params.type as 'plot' | 'relation' | 'quest' | 'item' | 'location' | 'skill' | 'combat' | 'dialogue' | undefined,
        minImportance: (params.min_importance as number) ?? 2,
        limit: (params.limit as number) ?? 10,
      });
    }

    return {
      success: true,
      data: {
        memories: memories.map(m => ({
          id: m.id,
          content: m.content,
          type: m.type,
          importance: m.importance,
          relatedEntities: m.relatedEntities,
          createdAt: m.createdAt,
        })),
      },
    };
  }

  private async handleSaveProcedural(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse> {
    if (!this.proceduralService) {
      return { success: false, error: 'ProceduralMemoryService not initialized' };
    }

    const agentKey = context.agentType ?? 'gamemaster';
    const memory = await this.proceduralService.save(context.saveId, agentKey, {
      condition: params.condition as string,
      action: params.action as string,
      outcome: params.outcome as string,
      effectiveness: params.effectiveness as number | undefined,
    });

    return {
      success: true,
      data: {
        id: memory.id,
        condition: memory.condition,
        action: memory.action,
        effectiveness: memory.effectiveness,
      },
    };
  }

  private async handleRecallProcedural(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse> {
    if (!this.proceduralService) {
      return { success: false, error: 'ProceduralMemoryService not initialized' };
    }

    const agentKey = context.agentType ?? 'gamemaster';
    const contextText = params.context as string | undefined;

    let rules;
    if (contextText) {
      rules = await this.proceduralService.findApplicable(
        context.saveId, agentKey, contextText,
        { minEffectiveness: (params.min_effectiveness as number) ?? 3, limit: (params.limit as number) ?? 5 },
      );
    } else {
      rules = await this.proceduralService.recall(context.saveId, agentKey, {
        minEffectiveness: (params.min_effectiveness as number) ?? 3,
        limit: (params.limit as number) ?? 5,
      });
    }

    return {
      success: true,
      data: {
        rules: rules.map(r => ({
          id: r.id,
          condition: r.condition,
          action: r.action,
          outcome: r.outcome,
          effectiveness: r.effectiveness,
          usageCount: r.usageCount,
        })),
      },
    };
  }

  private async handleSearchMemories(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse> {
    if (!this.episodicService || !this.proceduralService) {
      return { success: false, error: 'Memory services not initialized' };
    }

    const agentKey = context.agentType ?? 'gamemaster';
    const query = params.query as string;
    const limit = (params.limit as number) ?? 10;

    const [episodic, procedural] = await Promise.all([
      this.episodicService.search(context.saveId, agentKey, query, limit),
      this.proceduralService.recall(context.saveId, agentKey, { limit: 5 }),
    ]);

    // 简单关键词匹配程序化记忆
    const matchedProcedural = procedural.filter(r => {
      const text = `${r.condition} ${r.action} ${r.outcome}`;
      return query.split(/\s+/).some(kw => text.includes(kw));
    });

    return {
      success: true,
      data: {
        episodic: episodic.map(m => ({
          id: m.id,
          content: m.content,
          type: m.type,
          importance: m.importance,
        })),
        procedural: matchedProcedural.map(r => ({
          id: r.id,
          condition: r.condition,
          action: r.action,
          effectiveness: r.effectiveness,
        })),
      },
    };
  }
}
