import type { ProgressEvent, ProgressPhase, ProgressDetail, TaskEndDetail, SubAgentDetail, ThinkingDetail, ToolCallDetail } from '@ai-rpg/shared';
import { buildTaskNodeId } from '@ai-rpg/shared';

export interface ProgressNode {
  id: string;
  agentType: string;
  taskDescription: string;
  displayDescription: string;
  parentId: string | null;
  childIds: string[];
  status: 'running' | 'done' | 'failed';
  fatal: boolean;
  currentPhase: ProgressPhase | null;
  logs: ProgressLogEntry[];
  startedAt: number;
  endedAt: number | null;
  latestDetail: ProgressDetail | null;
}

export interface ProgressLogEntry {
  phase: ProgressPhase;
  detail?: ProgressDetail;
  timestamp: number;
}

export interface ProgressTreeState {
  nodes: Record<string, ProgressNode>;
  rootIds: string[];
  activeNodeIds: string[];
  fadingOut: boolean;
}

export const INTENT_LABELS_ZH: Record<string, string> = {
  chat: '处理玩家对话',
  initialize: '初始化游戏世界',
  dialogue: '处理NPC对话',
  select: '选择对话选项',
  use_item: '使用物品',
  equip_item: '装备物品',
  unequip_item: '卸下装备',
  drop_item: '丢弃物品',
  examine_item: '检查物品',
  use_skill: '使用技能',
  learn_skill: '学习技能',
  view_skill: '查看技能',
  travel: '旅行移动',
  travel_to: '前往目的地',
  talk_npc: '与NPC交谈',
  accept_quest: '接受任务',
  complete_quest: '完成任务',
  abandon_quest: '放弃任务',
  buy_item: '购买物品',
  sell_item: '出售物品',
  craft_item: '制作物品',
  enhance_item: '强化物品',
  deposit_item: '存入物品',
  withdraw_item: '取出物品',
  explore: '探索区域',
  level_up: '等级提升',
  combat_start: '战斗开始',
  combat_turn: '战斗回合',
  combat_end: '战斗结束',
  attack: '发起攻击',
  defend: '进行防御',
  flee: '尝试逃跑',
  generate_pool: '生成数据池',
};

export function translateTaskDescription(agentType: string, taskDescription: string): string {
  if (agentType === 'gamemaster') {
    return INTENT_LABELS_ZH[taskDescription] || taskDescription;
  }
  return taskDescription;
}

export function computeTreeProgress(tree: ProgressTreeState): number {
  const allNodes = Object.values(tree.nodes);
  if (allNodes.length === 0) return 0;
  const doneCount = allNodes.filter(n => n.status === 'done' || n.status === 'failed').length;
  return Math.round((doneCount / allNodes.length) * 100);
}

export type { ProgressEvent, ProgressPhase, ProgressDetail, TaskEndDetail, SubAgentDetail, ThinkingDetail, ToolCallDetail };
export { buildTaskNodeId };
