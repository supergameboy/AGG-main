import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { createChildLogger } from '../../utils/logger.js';
import type { IEpisodicMemoryRepository, EpisodicMemoryRow } from '../../game-systems/memory/types.js';
import {
  AgentEpisodicMemory,
  EpisodicMemoryType,
  EpisodicRecallOptions,
  MemoryMonitorConfig,
  DEFAULT_MEMORY_MONITOR_CONFIG,
  MemoryFlushResult,
  ExtractedFact,
} from './types.js';

const logger = createChildLogger('EpisodicMemoryService');

function rowToMemory(row: EpisodicMemoryRow): AgentEpisodicMemory {
  return {
    id: row.id,
    saveId: row.save_id,
    agentKey: row.agent_key,
    content: row.content,
    type: row.type as EpisodicMemoryType,
    importance: row.importance,
    relatedEntities: JSON.parse(row.related_entities || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    turnIndex: row.turn_index,
    createdAt: row.created_at,
  };
}

export class EpisodicMemoryService {
  private repo: IEpisodicMemoryRepository;
  private monitorConfig: MemoryMonitorConfig;

  constructor(repo: IEpisodicMemoryRepository, monitorConfig?: Partial<MemoryMonitorConfig>) {
    this.repo = repo;
    this.monitorConfig = { ...DEFAULT_MEMORY_MONITOR_CONFIG, ...monitorConfig };
  }

  async save(
    saveId: ID,
    agentKey: string,
    params: {
      content: string;
      type: EpisodicMemoryType;
      importance?: number;
      relatedEntities?: string[];
      tags?: string[];
      turnIndex?: number;
    }
  ): Promise<AgentEpisodicMemory> {
    const id = generateReadableId('epi', agentKey);
    const now = Date.now() as Timestamp;
    const memory: AgentEpisodicMemory = {
      id,
      saveId,
      agentKey,
      content: params.content,
      type: params.type,
      importance: Math.max(1, Math.min(5, params.importance ?? 1)),
      relatedEntities: params.relatedEntities ?? [],
      tags: params.tags ?? [],
      turnIndex: params.turnIndex ?? 0,
      createdAt: now,
    };

    await this.repo.insert(saveId, agentKey, {
      id: memory.id,
      content: memory.content,
      type: memory.type,
      importance: memory.importance,
      related_entities: JSON.stringify(memory.relatedEntities),
      tags: JSON.stringify(memory.tags),
      turn_index: memory.turnIndex,
      created_at: memory.createdAt,
    });

    logger.info('Episodic memory saved', { id, agentKey, type: params.type, importance: memory.importance });
    return memory;
  }

  async saveBatch(saveId: ID, agentKey: string, facts: ExtractedFact[]): Promise<MemoryFlushResult> {
    const existingMemories = await this.recall(saveId, agentKey, { limit: 1000 });
    const existingContents = new Set(existingMemories.map(m => m.content));

    let savedCount = 0;
    let skippedDuplicateCount = 0;

    const rows: Array<Omit<EpisodicMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at'> & { id: string; created_at: number }> = [];
    for (const fact of facts) {
      if (existingContents.has(fact.content)) {
        skippedDuplicateCount++;
        continue;
      }
      if (fact.importance < 2) {
        skippedDuplicateCount++;
        continue;
      }
      const id = generateReadableId('epi', agentKey);
      rows.push({
        id,
        content: fact.content,
        type: fact.type,
        importance: Math.max(1, Math.min(5, fact.importance)),
        related_entities: JSON.stringify(fact.relatedEntities),
        tags: JSON.stringify([]),
        turn_index: 0,
        created_at: fact.timestamp || Date.now(),
      });
      savedCount++;
    }

    if (rows.length > 0) {
      await this.repo.insertBatch(saveId, agentKey, rows);
    }

    logger.info('Episodic memory batch saved', { agentKey, savedCount, skippedDuplicateCount });
    return {
      savedCount,
      skippedDuplicateCount,
      totalExistingCount: existingMemories.length,
    };
  }

  async recall(saveId: ID, agentKey: string, options?: EpisodicRecallOptions): Promise<AgentEpisodicMemory[]> {
    if (!(await this.repo.tableExists())) return [];
    const rows = await this.repo.findBySaveIdAndAgent(saveId, agentKey, {
      type: options?.type,
      minImportance: options?.minImportance,
      tags: options?.tags?.[0],
      timeRange: options?.timeRange ? { start: options.timeRange.start, end: options.timeRange.end } : undefined,
      limit: options?.limit,
    });
    return rows.map(rowToMemory);
  }

  async search(saveId: ID, agentKey: string, query: string, limit: number = 10): Promise<AgentEpisodicMemory[]> {
    if (!(await this.repo.tableExists())) return [];
    const rows = await this.repo.searchByContent(saveId, agentKey, query, limit);
    return rows.map(rowToMemory);
  }

  async compress(saveId: ID, agentKey: string): Promise<{ compressedCount: number }> {
    const lowImportance = await this.repo.findLowImportance(saveId, agentKey, this.monitorConfig.retainHighImportance);

    if (lowImportance.length === 0) {
      return { compressedCount: 0 };
    }

    // 按类型分组
    const byType = new Map<string, typeof lowImportance>();
    for (const row of lowImportance) {
      if (!byType.has(row.type)) byType.set(row.type, []);
      byType.get(row.type)!.push(row);
    }

    // 删除低重要性记忆
    const idsToDelete = lowImportance.map(r => r.id);
    await this.repo.deleteByIds(saveId, agentKey, idsToDelete);

    logger.info('Episodic memories compressed', { agentKey, compressedCount: idsToDelete.length });
    return { compressedCount: idsToDelete.length };
  }

  async getSummary(saveId: ID, agentKey: string, limit: number = 20): Promise<string> {
    const memories = await this.recall(saveId, agentKey, { limit });
    if (memories.length === 0) return '';

    const typeLabels: Record<string, string> = {
      plot: '剧情',
      relation: '关系',
      quest: '任务',
      item: '物品',
      location: '位置',
      skill: '技能',
      combat: '战斗',
      dialogue: '对话',
    };

    const lines = memories.map(m =>
      `- [${typeLabels[m.type] ?? m.type}] ${m.content}`
    );
    return lines.join('\n');
  }

  async getMemoryCount(saveId: ID, agentKey: string): Promise<number> {
    if (!(await this.repo.tableExists())) return 0;
    return this.repo.countBySaveIdAndAgent(saveId, agentKey);
  }

  async checkAndCompressIfNeeded(saveId: ID, agentKey: string): Promise<{ compressed: boolean; count: number }> {
    const count = await this.getMemoryCount(saveId, agentKey);
    if (count < this.monitorConfig.compressThreshold) {
      return { compressed: false, count };
    }

    logger.info('Episodic memory threshold reached, triggering compression', {
      agentKey, count, threshold: this.monitorConfig.compressThreshold,
    });

    const result = await this.compress(saveId, agentKey);
    return { compressed: true, count: result.compressedCount };
  }

  async delete(saveId: ID, agentKey: string, memoryId: ID): Promise<boolean> {
    return this.repo.deleteById(saveId, agentKey, memoryId);
  }

  async deleteBySaveId(saveId: ID): Promise<number> {
    return this.repo.deleteBySaveId(saveId);
  }
}
