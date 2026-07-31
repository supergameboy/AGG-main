import { ID } from '../../../../shared/src/types/core.js';
import { createChildLogger } from '../../utils/logger.js';
import { LLMService } from '@ai-rpg/ai';
import { EpisodicMemoryService } from './episodic-memory-service.js';
import { ExtractedFact, MemoryFlushResult } from './types.js';
import type { LLMMessage } from '../../../../shared/src/types/agent.js';

const logger = createChildLogger('SemanticContextCompressor');

const COMPRESSION_PROMPT = `将以下游戏对话和操作记录压缩为精炼的叙事摘要。

## 规则
- 保留所有关键剧情转折、NPC交互要点、任务进展
- 保留玩家做出的重要选择和后果
- 保留对后续剧情有影响的信息（物品获取、技能学习、关系变化）
- 保留 tool 调用的关键结果（战斗结果、物品获得、位置变更）
- 使用连贯的叙事风格，而非列表
- 摘要长度控制在 150-300 字
- 只输出摘要文本，不要输出其他内容`;

const FACT_EXTRACTION_PROMPT = `从以下游戏对话和操作记录中提取关键事实。

## 提取规则
- 只提取对后续剧情有影响的事实
- 每条事实包含: content(描述)、type(类型)、importance(重要性1-5)、relatedEntities(关联实体ID)
- type 取值: plot(剧情转折)、relation(关系变化)、quest(任务进展)、item(物品获取)、location(位置变更)、skill(技能学习)
- importance: 5=关键转折不可丢失, 4=重要影响, 3=有影响, 2=轻微影响, 1=背景信息
- 去除纯对话寒暄、重复确认、无实质内容的交互
- 输出 JSON 数组，不要输出其他内容

## 输出格式
[{"content": "...", "type": "plot", "importance": 4, "relatedEntities": ["npc_xxx"]}]`;

export class SemanticContextCompressor {
  private llmService: LLMService;
  private episodicMemoryService: EpisodicMemoryService;

  constructor(llmService: LLMService, episodicMemoryService: EpisodicMemoryService) {
    this.llmService = llmService;
    this.episodicMemoryService = episodicMemoryService;
  }

  /**
   * 压缩前记忆落盘：从待压缩消息中提取关键事实并保存到情景记忆
   * 此方法由 before_compaction Hook 自动调用，无需 LLM 主动调用
   */
  async flushToEpisodicMemory(
    saveId: ID,
    agentKey: string,
    messages: LLMMessage[],
  ): Promise<MemoryFlushResult> {
    // 只处理最后 3 条之前的消息
    const compressZone = this.getCompressZone(messages);
    if (compressZone.length === 0) {
      return { savedCount: 0, skippedDuplicateCount: 0, totalExistingCount: 0 };
    }

    const textContent = compressZone
      .map(m => `[${m.role}] ${m.content ?? ''}`)
      .join('\n');

    if (textContent.trim().length < 50) {
      return { savedCount: 0, skippedDuplicateCount: 0, totalExistingCount: 0 };
    }

    try {
      const facts = await this.extractKeyFacts(textContent);
      if (facts.length === 0) {
        return { savedCount: 0, skippedDuplicateCount: 0, totalExistingCount: 0 };
      }

      return await this.episodicMemoryService.saveBatch(saveId, agentKey, facts);
    } catch (error) {
      logger.error('Failed to flush memories before compression', { error });
      return { savedCount: 0, skippedDuplicateCount: 0, totalExistingCount: 0 };
    }
  }

  /**
   * 语义压缩：用 LLM 对上下文进行语义压缩，保留最后 3 条消息
   */
  async compress(messages: LLMMessage[]): Promise<LLMMessage[]> {
    if (messages.length <= 6) return messages;

    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // 保留最后 3 条非 system 消息
    const retainCount = 3;
    if (nonSystemMessages.length <= retainCount) return messages;

    const retainZone = nonSystemMessages.slice(-retainCount);
    const compressZone = nonSystemMessages.slice(0, -retainCount);

    // 保护 tool_call/tool_result 配对
    const { protectedMessages, toCompress } = this.protectToolPairs(compressZone, retainZone);

    if (toCompress.length === 0) {
      return [...systemMessages, ...protectedMessages, ...retainZone];
    }

    // 分组压缩
    const groupSize = 8;
    const summaries: LLMMessage[] = [];

    for (let i = 0; i < toCompress.length; i += groupSize) {
      const group = toCompress.slice(i, i + groupSize);
      const textContent = group
        .map(m => `[${m.role}] ${m.content ?? ''}`)
        .join('\n');

      try {
        const summary = await this.generateSummary(textContent);
        if (summary) {
          summaries.push({
            role: 'system',
            content: `[上下文摘要] ${summary}`,
          });
        }
      } catch (error) {
        logger.error('Failed to compress message group', { groupIndex: i, error });
        // 压缩失败时保留原始消息
        summaries.push(...group);
      }
    }

    return [...systemMessages, ...summaries, ...protectedMessages, ...retainZone];
  }

  /**
   * 从消息中提取关键事实
   */
  private async extractKeyFacts(textContent: string): Promise<ExtractedFact[]> {
    const response = await this.llmService.chatWithFastModel(
      [
        { role: 'system', content: FACT_EXTRACTION_PROMPT },
        { role: 'user', content: textContent },
      ],
      { maxTokens: 2000, temperature: 0.1 },
    );

    const content = response.content?.trim() ?? '';
    try {
      // 提取 JSON 数组
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const facts = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(facts)) return [];

      return facts
        .filter((f: Record<string, unknown>) =>
          typeof f.content === 'string' &&
          typeof f.type === 'string' &&
          typeof f.importance === 'number'
        )
        .map((f: Record<string, unknown>) => ({
          content: f.content as string,
          type: f.type as ExtractedFact['type'],
          importance: Math.max(1, Math.min(5, f.importance as number)),
          relatedEntities: Array.isArray(f.relatedEntities)
            ? (f.relatedEntities as string[])
            : [],
          timestamp: Date.now(),
        }));
    } catch {
      logger.warn('Failed to parse extracted facts', { content: content.substring(0, 200) });
      return [];
    }
  }

  /**
   * 用 LLM 生成摘要
   */
  private async generateSummary(textContent: string): Promise<string | null> {
    const response = await this.llmService.chatWithFastModel(
      [
        { role: 'system', content: COMPRESSION_PROMPT },
        { role: 'user', content: textContent },
      ],
      { maxTokens: 500, temperature: 0.3 },
    );

    return response.content?.trim() ?? null;
  }

  /**
   * 获取待压缩区域（最后 3 条之前的非 system 消息）
   */
  private getCompressZone(messages: LLMMessage[]): LLMMessage[] {
    const nonSystem = messages.filter(m => m.role !== 'system');
    if (nonSystem.length <= 3) return [];
    return nonSystem.slice(0, -3);
  }

  /**
   * 保护 tool_call/tool_result 配对完整性
   * 如果 tool_result 在 retainZone，对应的 tool_call 也移入 retainZone
   */
  private protectToolPairs(
    compressZone: LLMMessage[],
    retainZone: LLMMessage[],
  ): { protectedMessages: LLMMessage[]; toCompress: LLMMessage[] } {
    // 收集 retainZone 中的 tool_call_id
    const retainedToolCallIds = new Set<string>();
    for (const msg of retainZone) {
      if (msg.toolCallId) {
        retainedToolCallIds.add(msg.toolCallId);
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls as Array<{ id?: string }>) {
          if (tc.id) retainedToolCallIds.add(tc.id);
        }
      }
    }

    const protectedMessages: LLMMessage[] = [];
    const toCompress: LLMMessage[] = [];

    for (const msg of compressZone) {
      // 如果此消息的 toolCallId 在 retainZone 中，保护它
      if (msg.toolCallId && retainedToolCallIds.has(msg.toolCallId)) {
        protectedMessages.push(msg);
        continue;
      }
      // 如果此消息包含 toolCalls，且其 id 在 retainZone 中，保护它
      if (msg.toolCalls) {
        const hasRetainedCall = (msg.toolCalls as Array<{ id?: string }>).some(
          tc => tc.id && retainedToolCallIds.has(tc.id),
        );
        if (hasRetainedCall) {
          protectedMessages.push(msg);
          continue;
        }
      }
      toCompress.push(msg);
    }

    return { protectedMessages, toCompress };
  }
}
