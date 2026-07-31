// 领域实体类型已迁移至 game-systems/memory/types.ts（业务层）
// Agent 层通过 re-export 引用，保持现有 import 路径兼容
export type {
  EpisodicMemoryType,
  AgentEpisodicMemory,
  EpisodicRecallOptions,
  AgentProceduralMemory,
  ProceduralRecallOptions,
} from '../../game-systems/memory/types.js';

// ─── 压缩前落盘（Agent 层特定） ───

export type ExtractedFactType = 'plot' | 'relation' | 'quest' | 'item' | 'location' | 'skill';

export interface ExtractedFact {
  content: string;
  type: ExtractedFactType;
  importance: number;
  relatedEntities: string[];
  timestamp: number;
}

export interface MemoryFlushResult {
  savedCount: number;
  skippedDuplicateCount: number;
  totalExistingCount: number;
}

// ─── 预算监控（Agent 层特定） ───

export interface BudgetCheckResult {
  totalTokens: number;
  budgetLimit: number;
  utilizationRatio: number;
  warnings: BudgetWarning[];
  shouldCompress: boolean;
  compressionUrgency: 'none' | 'low' | 'medium' | 'high';
}

export interface BudgetWarning {
  layer: string;
  tokenCount: number;
  budgetShare: number;
  truncated: boolean;
}

// ─── 记忆表监控配置（Agent 层特定） ───

export interface MemoryMonitorConfig {
  maxMemoriesPerAgent: number;
  compressThreshold: number;
  retainHighImportance: number;
  summaryMaxLength: number;
}

export interface ProceduralMonitorConfig {
  maxRulesPerAgent: number;
  pruneThreshold: number;
  minEffectivenessToRetain: number;
  maxUnusedAge: number;
}

export const DEFAULT_MEMORY_MONITOR_CONFIG: MemoryMonitorConfig = {
  maxMemoriesPerAgent: 200,
  compressThreshold: 150,
  retainHighImportance: 4,
  summaryMaxLength: 200,
};

export const DEFAULT_PROCEDURAL_MONITOR_CONFIG: ProceduralMonitorConfig = {
  maxRulesPerAgent: 50,
  pruneThreshold: 40,
  minEffectivenessToRetain: 2,
  maxUnusedAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
