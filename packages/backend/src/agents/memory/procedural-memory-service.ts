import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { createChildLogger } from '../../utils/logger.js';
import type { IProceduralMemoryRepository, ProceduralMemoryRow } from '../../game-systems/memory/types.js';
import {
  AgentProceduralMemory,
  ProceduralRecallOptions,
  ProceduralMonitorConfig,
  DEFAULT_PROCEDURAL_MONITOR_CONFIG,
} from './types.js';

const logger = createChildLogger('ProceduralMemoryService');

function rowToMemory(row: ProceduralMemoryRow): AgentProceduralMemory {
  return {
    id: row.id,
    saveId: row.save_id,
    agentKey: row.agent_key,
    condition: row.condition,
    action: row.action,
    outcome: row.outcome,
    effectiveness: row.effectiveness,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at ?? null,
    tags: JSON.parse(row.tags || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProceduralMemoryService {
  private repo: IProceduralMemoryRepository;
  private monitorConfig: ProceduralMonitorConfig;

  constructor(repo: IProceduralMemoryRepository, monitorConfig?: Partial<ProceduralMonitorConfig>) {
    this.repo = repo;
    this.monitorConfig = { ...DEFAULT_PROCEDURAL_MONITOR_CONFIG, ...monitorConfig };
  }

  async save(
    saveId: ID,
    agentKey: string,
    params: {
      condition: string;
      action: string;
      outcome: string;
      effectiveness?: number;
      tags?: string[];
    }
  ): Promise<AgentProceduralMemory> {
    const id = generateReadableId('proc', agentKey);
    const now = Date.now() as Timestamp;
    const memory: AgentProceduralMemory = {
      id,
      saveId,
      agentKey,
      condition: params.condition,
      action: params.action,
      outcome: params.outcome,
      effectiveness: Math.max(1, Math.min(5, params.effectiveness ?? 3)),
      usageCount: 0,
      lastUsedAt: null,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.insert(saveId, agentKey, {
      id: memory.id,
      condition: memory.condition,
      action: memory.action,
      outcome: memory.outcome,
      effectiveness: memory.effectiveness,
      usage_count: memory.usageCount,
      last_used_at: memory.lastUsedAt,
      tags: JSON.stringify(memory.tags),
      created_at: memory.createdAt,
      updated_at: memory.updatedAt,
    });

    logger.info('Procedural memory saved', { id, agentKey, effectiveness: memory.effectiveness });
    return memory;
  }

  async findApplicable(
    saveId: ID,
    agentKey: string,
    context: string,
    options?: ProceduralRecallOptions
  ): Promise<AgentProceduralMemory[]> {
    if (!(await this.repo.tableExists())) return [];
    const allRules = await this.recall(saveId, agentKey, options);

    // 简单关键词匹配：condition 中的关键词出现在 context 中
    return allRules.filter(rule => {
      const keywords = rule.condition.split(/[,，、\s]+/).filter(k => k.length > 0);
      return keywords.some(kw => context.includes(kw));
    });
  }

  async recall(saveId: ID, agentKey: string, options?: ProceduralRecallOptions): Promise<AgentProceduralMemory[]> {
    if (!(await this.repo.tableExists())) return [];
    const rows = await this.repo.findBySaveIdAndAgent(saveId, agentKey, {
      minEffectiveness: options?.minEffectiveness,
      limit: options?.limit,
    });
    return rows.map(rowToMemory);
  }

  async updateEffectiveness(id: ID, delta: number): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) return false;

    const newEffectiveness = Math.max(1, Math.min(5, existing.effectiveness + delta));
    await this.repo.updateEffectiveness(id, newEffectiveness, Date.now());

    return true;
  }

  async reinforce(id: ID): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) return false;

    const now = Date.now() as Timestamp;
    await this.repo.updateUsage(id, existing.usage_count + 1, now, now);

    return true;
  }

  async prune(saveId: ID, agentKey: string): Promise<{ prunedCount: number }> {
    const toPrune = await this.repo.findPruneCandidates(
      saveId,
      agentKey,
      this.monitorConfig.minEffectivenessToRetain,
      this.monitorConfig.maxUnusedAge,
    );

    if (toPrune.length === 0) {
      return { prunedCount: 0 };
    }

    const idsToDelete = toPrune.map(r => r.id);
    await this.repo.deleteByIds(idsToDelete);

    logger.info('Procedural memories pruned', { agentKey, prunedCount: idsToDelete.length });
    return { prunedCount: idsToDelete.length };
  }

  async getSummary(saveId: ID, agentKey: string, limit: number = 10): Promise<string> {
    const rules = await this.recall(saveId, agentKey, { minEffectiveness: 3, limit });
    if (rules.length === 0) return '';

    const lines = rules.map(r =>
      `- 当${r.condition}时 → ${r.action}（有效性:${r.effectiveness}, 使用${r.usageCount}次）`
    );
    return lines.join('\n');
  }

  async getRuleCount(saveId: ID, agentKey: string): Promise<number> {
    if (!(await this.repo.tableExists())) return 0;
    return this.repo.countBySaveIdAndAgent(saveId, agentKey);
  }

  async checkAndPruneIfNeeded(saveId: ID, agentKey: string): Promise<{ pruned: boolean; count: number }> {
    const count = await this.getRuleCount(saveId, agentKey);
    if (count < this.monitorConfig.pruneThreshold) {
      return { pruned: false, count };
    }

    logger.info('Procedural memory threshold reached, triggering prune', {
      agentKey, count, threshold: this.monitorConfig.pruneThreshold,
    });

    const result = await this.prune(saveId, agentKey);
    return { pruned: true, count: result.prunedCount };
  }

  async delete(saveId: ID, agentKey: string, memoryId: ID): Promise<boolean> {
    return this.repo.deleteById(saveId, agentKey, memoryId);
  }

  async deleteBySaveId(saveId: ID): Promise<number> {
    return this.repo.deleteBySaveId(saveId);
  }
}
