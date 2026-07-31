import { cn } from '@/utils/cn';
import type { ProgressNode as ProgressNodeType } from '@/types/progress';

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'map_service__explore_location': '探索周围',
  'map_service__move_to': '移动中',
  'map_service__get_current_location': '确认位置',
  'dialogue_service__add_dialogue_message': '对话中',
  'dialogue_service__get_recent_dialogue': '回忆对话',
  'npc_service__interactWithNPC': '与NPC互动',
  'npc_service__get_npc_full_status': '观察NPC',
  'quest_service__create_quest': '发布任务',
  'quest_service__accept_quest': '接受任务',
  'quest_service__update_objective': '更新任务进度',
  'quest_service__complete_quest': '完成任务',
  'quest_service__get_active_quests': '查看任务',
  'combat_service__start_combat': '进入战斗',
  'combat_service__execute_turn': '战斗行动',
  'combat_service__end_combat': '结束战斗',
  'inventory_service__add_item': '获取物品',
  'inventory_service__remove_item': '使用物品',
  'inventory_service__get_item': '查看物品',
  'character_service__updateStatus': '状态更新',
  'skill_service__use_skill': '使用技能',
  'event_service__check_triggers': '检查事件',
  'game_time_service__advance_time': '时间流逝',
};

export function formatToolDisplayName(raw: string): string {
  if (TOOL_DISPLAY_NAMES[raw]) return TOOL_DISPLAY_NAMES[raw];
  return raw.replace(/^[a-z]+_service__/, '').replace(/_/g, ' ');
}

const PHASE_LABELS_ZH: Record<string, string> = {
  task_start: '开始',
  thinking: '思考中',
  tool_call: '调用工具',
  tool_result: '获取结果',
  iteration: '迭代中',
  sub_agent_start: '委派子任务',
  sub_agent_end: '子任务完成',
  task_end: '完成',
  error: '出错',
};

interface ProgressNodeProps {
  node: ProgressNodeType;
  depth?: number;
  compact?: boolean;
}

export function ProgressNodeComponent({ node, depth = 0, compact = false }: ProgressNodeProps) {
  const isRunning = node.status === 'running';
  const isDone = node.status === 'done';
  const isFailed = node.status === 'failed';

  const recentLogs = node.logs.slice(-3);

  const phaseLabel = node.currentPhase ? PHASE_LABELS_ZH[node.currentPhase] ?? node.currentPhase : '';

  let detailText = '';
  if (node.currentPhase === 'thinking' && (node.latestDetail as { thought?: string })?.thought) {
    detailText = (node.latestDetail as { thought?: string }).thought!;
  } else if (node.currentPhase === 'tool_call' && (node.latestDetail as { toolName?: string })?.toolName) {
    detailText = formatToolDisplayName((node.latestDetail as { toolName?: string }).toolName!);
  } else if (node.currentPhase === 'tool_result' && (node.latestDetail as { toolName?: string })?.toolName) {
    detailText = formatToolDisplayName((node.latestDetail as { toolName?: string }).toolName!);
  }

  if (compact && isDone) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <span className="text-[var(--success)]">✓</span>
        <span>{node.displayDescription}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        depth > 0 ? 'ml-4 border-l-2 border-l-[var(--accent)]/30 border-t-0 border-r-0 border-b-0 bg-transparent pl-3' : 'border border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 p-2.5',
        isFailed && 'border-red-500/30 bg-red-950/10',
      )}
    >
      <div className="flex items-center gap-2">
        {isRunning && (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        )}
        {isDone && (
          <span className="h-3.5 w-3.5 shrink-0 text-[var(--success)]">✓</span>
        )}
        {isFailed && (
          <span className="h-3.5 w-3.5 shrink-0 text-[var(--error)] font-bold">!</span>
        )}
        <span className={cn(
          'text-xs font-medium',
          isRunning ? 'text-[var(--accent)]' : isDone ? 'text-[var(--success)]' : 'text-[var(--error)]',
        )}>
          {node.displayDescription}
        </span>
        {isRunning && phaseLabel && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {phaseLabel}{detailText ? `: ${detailText}` : ''}
          </span>
        )}
      </div>

      {isRunning && !compact && recentLogs.length > 1 && (
        <div className="mt-1.5 space-y-0.5 pl-5.5">
          {recentLogs.slice(0, -1).map((log, i) => {
            const logLabel = PHASE_LABELS_ZH[log.phase] ?? log.phase;
            let logDetail = '';
            if (log.phase === 'tool_call' && (log.detail as { toolName?: string })?.toolName) {
              logDetail = formatToolDisplayName((log.detail as { toolName?: string }).toolName!);
            }
            return (
              <div key={i} className="text-[10px] text-[var(--text-muted)]">
                {logLabel}{logDetail ? `: ${logDetail}` : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
