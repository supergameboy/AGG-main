import { useState, useCallback } from 'react';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ArrowPathRoundedSquareIcon,
  BeakerIcon,
  BugAntIcon,
  CircleStackIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  FireIcon,
  LinkIcon,
  LinkSlashIcon,
  ServerIcon,
  SignalIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { GAME_EVENT_TYPES } from '@ai-rpg/shared';
import { cn } from '@/utils/cn';
import { logger } from '@/utils/logger';
import { apiClient } from '@/api/client';
import { getAllStores } from '@/utils/storeInspector';
import { captureAllStores } from '@/utils/snapshotCapture';
import { useConsistencyStore } from '@/stores/consistencyStore';
import { useLogStore } from '@/stores/logStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useGameStore } from '@/stores/gameStore';
import { wsManager } from '@/services/WebSocketManager';
import { useCombatStore } from '@/stores/combatStore';
import { useMapStore } from '@/stores/mapStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { useGameTimeStore } from '@/stores/gameTimeStore';
import { useSaveStore } from '@/stores/saveStore';
import { useTemplateStore } from '@/stores/templateStore';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { useModelConfigStore } from '@/stores/modelConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { LogLevel } from '@/utils/logger';
import type { GameEvent } from '@/types';

interface ToolsTabProps {
  className?: string;
}

type FeedbackType = { type: 'success' | 'error'; message: string } | null;

const WS_EVENT_TYPES = GAME_EVENT_TYPES;

interface EventTemplate {
  label: string;
  json: string;
}

const WS_EVENT_TEMPLATES: Record<string, EventTemplate> = {
  // 统一面板变更推送机制：'dialogue:message' 事件已废弃（设计 5.17），devtools 不再模拟该事件
  'combat:turn_start': { label: '战斗回合', json: JSON.stringify({ turn: 1, playerTurn: true }, null, 2) },
  'quest:update': { label: '任务更新', json: JSON.stringify({ quest: { id: 'quest-1', name: '测试任务', status: 'active' } }, null, 2) },
  'event:triggered': { label: '事件触发', json: JSON.stringify({ description: '测试事件触发', event: { title: '随机事件' } }, null, 2) },
  'agent_progress': { label: '进度事件', json: JSON.stringify({
    phase: 'thinking', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat',
    parentTask: null, detail: { thought: '思考中...' }, timestamp: Date.now(),
  }, null, 2) },
  'config:reloaded': { label: '配置重载', json: JSON.stringify({ config: 'all' }, null, 2) },
  'map:update': { label: '地图更新', json: JSON.stringify({ mapId: 'map-1' }, null, 2) },
  'map:entity_move': { label: '实体移动', json: JSON.stringify({ entityId: 'npc-1', from: 'loc-1', to: 'loc-2' }, null, 2) },
};

const AGENT_PROGRESS_SUB_TEMPLATES: Record<string, EventTemplate> = {
  task_start: { label: '任务开始', json: JSON.stringify({ phase: 'task_start', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, timestamp: Date.now() }, null, 2) },
  thinking: { label: '思考中', json: JSON.stringify({ phase: 'thinking', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, detail: { thought: '分析玩家意图...' }, timestamp: Date.now() }, null, 2) },
  tool_call: { label: '工具调用', json: JSON.stringify({ phase: 'tool_call', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, detail: { toolName: 'npc_service__move_npc' }, timestamp: Date.now() }, null, 2) },
  tool_result: { label: '工具结果', json: JSON.stringify({ phase: 'tool_result', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, detail: { toolName: 'npc_service__move_npc', success: true }, timestamp: Date.now() }, null, 2) },
  task_end: { label: '任务完成', json: JSON.stringify({ phase: 'task_end', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, detail: { success: true }, timestamp: Date.now() }, null, 2) },
  sub_agent_start: { label: '子Agent启动', json: JSON.stringify({ phase: 'sub_agent_start', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, detail: { subAgentType: 'skill', subTaskDescription: '创建技能体系' }, timestamp: Date.now() }, null, 2) },
  error: { label: '错误', json: JSON.stringify({ phase: 'error', agentType: 'gamemaster', agentRunId: 'gamemaster:demo-0001', taskDescription: 'chat', parentTask: null, detail: { error: '工具调用失败', recoverable: true }, timestamp: Date.now() }, null, 2) },
};

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const STORE_RESET_MAP: Record<string, () => void> = {
  gameStore: () => useGameStore.getState().reset(),
  combatStore: () => useCombatStore.getState().clearCombat(),
  mapStore: () => useMapStore.getState().clearMapState(),
  dialogueStore: () => useDialogueStore.getState().clearDialogue(),
  settingsStore: () => useSettingsStore.getState().reset(),
  logStore: () => useLogStore.getState().clearEntries(),
  uiStore: () => useUIStore.getState().reset(),
  saveStore: () => useSaveStore.getState().reset(),
  gameTimeStore: () => useGameTimeStore.getState().clearGameTime(),
  templateStore: () => useTemplateStore.getState().reset(),
  agentProfileStore: () => useAgentProfileStore.getState().reset(),
  modelConfigStore: () => useModelConfigStore.getState().reset(),
};

function downloadJson(data: string, filename: string): void {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function FeedbackToast({ feedback }: { feedback: FeedbackType }) {
  if (!feedback) return null;
  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-all',
        feedback.type === 'success'
          ? 'bg-green-600/90 text-white'
          : 'bg-red-600/90 text-white'
      )}
    >
      {feedback.message}
    </div>
  );
}

export function ToolsTab({ className }: ToolsTabProps) {
  const [feedback, setFeedback] = useState<FeedbackType>(null);
  const [selectedStoreName, setSelectedStoreName] = useState<string>('');
  const [wsEventType, setWsEventType] = useState<string>(WS_EVENT_TYPES[0]);
  const [wsPayload, setWsPayload] = useState<string>(WS_EVENT_TEMPLATES[WS_EVENT_TYPES[0]]?.json ?? '{}');
  const [logLevel, setLogLevel] = useState<LogLevel>('debug');
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [selectedSubTemplate, setSelectedSubTemplate] = useState<string>('');

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3000);
  }, []);

  const wsConnectionStatus = wsManager.state;

  const stores = getAllStores();

  const handleResetAllStores = useCallback(() => {
    if (confirmAction !== 'reset-all') {
      setConfirmAction('reset-all');
      return;
    }
    setConfirmAction(null);
    try {
      let resetCount = 0;
      for (const [name, resetFn] of Object.entries(STORE_RESET_MAP)) {
        try {
          resetFn();
          resetCount++;
          logger.info('ToolsTab', `Reset store: ${name}`);
        } catch (e) {
          logger.error('ToolsTab', `Failed to reset store: ${name}`, e instanceof Error ? e.message : String(e));
        }
      }
      showFeedback('success', `已重置 ${resetCount} 个Store`);
    } catch (e) {
      logger.error('ToolsTab', 'Reset all stores failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', '重置所有Store失败');
    }
  }, [confirmAction, showFeedback]);

  const handleResetSingleStore = useCallback(() => {
    if (!selectedStoreName) {
      showFeedback('error', '请选择要重置的Store');
      return;
    }
    if (confirmAction !== `reset-${selectedStoreName}`) {
      setConfirmAction(`reset-${selectedStoreName}`);
      return;
    }
    setConfirmAction(null);
    try {
      const resetFn = STORE_RESET_MAP[selectedStoreName];
      if (resetFn) {
        resetFn();
        logger.info('ToolsTab', `Reset store: ${selectedStoreName}`);
        showFeedback('success', `已重置 ${selectedStoreName}`);
      } else {
        logger.warn('ToolsTab', `No reset method for store: ${selectedStoreName}`);
        showFeedback('error', `${selectedStoreName} 没有重置方法`);
      }
    } catch (e) {
      logger.error('ToolsTab', `Reset store ${selectedStoreName} failed`, e instanceof Error ? e.message : String(e));
      showFeedback('error', `重置 ${selectedStoreName} 失败`);
    }
  }, [selectedStoreName, confirmAction, showFeedback]);

  const handleWsEventTypeChange = useCallback((type: string) => {
    setWsEventType(type);
    setWsPayload(WS_EVENT_TEMPLATES[type]?.json ?? '{}');
    setSelectedSubTemplate('');
  }, []);

  const handleSubTemplateChange = useCallback((subKey: string) => {
    setSelectedSubTemplate(subKey);
    setWsPayload(AGENT_PROGRESS_SUB_TEMPLATES[subKey]?.json ?? '{}');
  }, []);

  const handleSendWsEvent = useCallback(() => {
    try {
      const payload = JSON.parse(wsPayload);
      const event: GameEvent = {
        type: wsEventType as GameEvent['type'],
        payload,
        timestamp: Date.now(),
      };
      useGameStore.getState().handleWebSocketEvent(event);
      useConsistencyStore.getState().addWSEvent({ type: wsEventType, payload });
      logger.info('ToolsTab', `Simulated WS event: ${wsEventType}`, payload);
      showFeedback('success', `已发送模拟事件: ${wsEventType}`);
    } catch (e) {
      logger.error('ToolsTab', 'Invalid JSON payload', e instanceof Error ? e.message : String(e));
      showFeedback('error', 'Payload JSON格式错误');
    }
  }, [wsEventType, wsPayload, showFeedback]);

  const handleClearLogs = useCallback(() => {
    try {
      useLogStore.getState().clearEntries();
      logger.info('ToolsTab', 'Cleared all log entries');
      showFeedback('success', '已清除所有日志');
    } catch (e) {
      logger.error('ToolsTab', 'Clear logs failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', '清除日志失败');
    }
  }, [showFeedback]);

  const handleLogLevelChange = useCallback((level: LogLevel) => {
    setLogLevel(level);
    useLogStore.getState().setFilter({ level });
    logger.info('ToolsTab', `Log level changed to: ${level}`);
    showFeedback('success', `日志级别已切换为: ${level}`);
  }, [showFeedback]);

  const handleTogglePersistToBackend = useCallback(() => {
    const current = useLogStore.getState().persistToBackend;
    useLogStore.getState().setPersistToBackend(!current);
    logger.info('ToolsTab', `Persist to backend: ${!current}`);
    showFeedback('success', `后端持久化已${!current ? '开启' : '关闭'}`);
  }, [showFeedback]);

  const handleWsReconnect = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent('devtools:ws-reconnect'));
      logger.info('ToolsTab', 'WS reconnect requested');
      showFeedback('success', '已请求WS重连');
    } catch (e) {
      logger.error('ToolsTab', 'WS reconnect failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', 'WS重连请求失败');
    }
  }, [showFeedback]);

  const handleWsDisconnect = useCallback(() => {
    if (confirmAction !== 'ws-disconnect') {
      setConfirmAction('ws-disconnect');
      return;
    }
    setConfirmAction(null);
    try {
      window.dispatchEvent(new CustomEvent('devtools:ws-disconnect'));
      logger.info('ToolsTab', 'WS disconnect requested');
      showFeedback('success', '已请求WS断开');
    } catch (e) {
      logger.error('ToolsTab', 'WS disconnect failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', 'WS断开请求失败');
    }
  }, [confirmAction, showFeedback]);

  const handleExportDebugInfo = useCallback(async () => {
    try {
      const snapshot = captureAllStores();
      const logEntries = useLogStore.getState().getFilteredEntries();
      const consistencyReport = useConsistencyStore.getState().exportReport();

      const debugData = {
        exportedAt: new Date().toISOString(),
        stores: snapshot.stores,
        recentLogs: logEntries.slice(-100).map((e) => ({
          timestamp: new Date(e.timestamp).toISOString(),
          level: e.level,
          category: e.category,
          source: e.source,
          message: e.message,
        })),
        consistencyReport: JSON.parse(consistencyReport),
        wsConnectionStatus,
        userAgent: navigator.userAgent,
        url: window.location.href,
      };

      const jsonStr = JSON.stringify(debugData, null, 2);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJson(jsonStr, `debug-export-${timestamp}.json`);

      try {
        await apiClient.post('/dev/debug-export', debugData);
        logger.info('ToolsTab', 'Debug info exported and posted to backend');
      } catch (e) {
        logger.warn('ToolsTab', 'Failed to post debug info to backend', e instanceof Error ? e.message : String(e));
      }

      showFeedback('success', '调试信息已导出');
    } catch (e) {
      logger.error('ToolsTab', 'Export debug info failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', '导出调试信息失败');
    }
  }, [wsConnectionStatus, showFeedback]);

  const handleExportStoreSnapshot = useCallback(() => {
    try {
      const snapshot = captureAllStores();
      const jsonStr = JSON.stringify(snapshot, null, 2);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJson(jsonStr, `store-snapshot-${timestamp}.json`);
      logger.info('ToolsTab', 'Store snapshot exported');
      showFeedback('success', 'Store快照已导出');
    } catch (e) {
      logger.error('ToolsTab', 'Export store snapshot failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', '导出Store快照失败');
    }
  }, [showFeedback]);

  const handleForceReload = useCallback(() => {
    if (confirmAction !== 'force-reload') {
      setConfirmAction('force-reload');
      return;
    }
    setConfirmAction(null);
    logger.info('ToolsTab', 'Force reloading page');
    window.location.reload();
  }, [confirmAction]);

  const handleClearSessionStorage = useCallback(() => {
    try {
      const devKeys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith('ai-rpg') || key.startsWith('dev-'))) {
          devKeys.push(key);
        }
      }
      for (const key of devKeys) {
        sessionStorage.removeItem(key);
      }
      logger.info('ToolsTab', `Cleared ${devKeys.length} dev sessionStorage keys`);
      showFeedback('success', `已清除 ${devKeys.length} 个开发者存储项`);
    } catch (e) {
      logger.error('ToolsTab', 'Clear sessionStorage failed', e instanceof Error ? e.message : String(e));
      showFeedback('error', '清除sessionStorage失败');
    }
  }, [showFeedback]);

  const wsStatusColor = wsConnectionStatus === 'connected'
    ? 'bg-green-500'
    : wsConnectionStatus === 'connecting'
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const wsStatusLabel = wsConnectionStatus === 'connected'
    ? '已连接'
    : wsConnectionStatus === 'connecting'
      ? '连接中'
      : '未连接';

  return (
    <div className={cn('flex h-full flex-col gap-3 overflow-y-auto p-1', className)}>
      <FeedbackToast feedback={feedback} />

      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <CircleStackIcon className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">Store 管理</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              icon={<ArrowPathIcon className="h-3.5 w-3.5" />}
              onClick={handleResetAllStores}
              className="flex-1"
            >
              {confirmAction === 'reset-all' ? '确认重置所有?' : '重置所有Store状态'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedStoreName}
              onChange={(e) => setSelectedStoreName(e.target.value)}
              className={cn(
                'h-8 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                'text-xs text-[var(--text-primary)]',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20'
              )}
            >
              <option value="">选择Store...</option>
              {stores.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              icon={<ArrowPathIcon className="h-3.5 w-3.5" />}
              onClick={handleResetSingleStore}
              disabled={!selectedStoreName}
            >
              {confirmAction === `reset-${selectedStoreName}` ? '确认?' : '重置'}
            </Button>
          </div>
        </div>
      </Card>

      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <BeakerIcon className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">WS 事件模拟</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-14 shrink-0">事件类型</span>
            <select
              value={wsEventType}
              onChange={(e) => handleWsEventTypeChange(e.target.value)}
              className={cn(
                'h-8 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                'text-xs text-[var(--text-primary)]',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20'
              )}
            >
              {WS_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>{WS_EVENT_TEMPLATES[type]?.label ?? type}</option>
              ))}
            </select>
          </div>
          {wsEventType === 'agent_progress' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--text-muted)] w-14 shrink-0">子模板</span>
              <select
                value={selectedSubTemplate}
                onChange={(e) => handleSubTemplateChange(e.target.value)}
                className={cn(
                  'h-8 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                  'text-xs text-[var(--text-primary)]',
                  'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20'
                )}
              >
                <option value="">自定义...</option>
                {Object.entries(AGENT_PROGRESS_SUB_TEMPLATES).map(([key, tmpl]) => (
                  <option key={key} value={key}>{tmpl.label}</option>
                ))}
              </select>
            </div>
          )}
          <textarea
            value={wsPayload}
            onChange={(e) => setWsPayload(e.target.value)}
            rows={6}
            spellCheck={false}
            className={cn(
              'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-2',
              'text-xs font-mono text-[var(--text-primary)]',
              'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20',
              'resize-y'
            )}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<SignalIcon className="h-3.5 w-3.5" />}
            onClick={handleSendWsEvent}
          >
            发送模拟事件
          </Button>
        </div>
      </Card>

      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <BugAntIcon className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">日志管理</span>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<TrashIcon className="h-3.5 w-3.5" />}
            onClick={handleClearLogs}
          >
            清除所有日志
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-14 shrink-0">日志级别</span>
            <select
              value={logLevel}
              onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
              className={cn(
                'h-8 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                'text-xs text-[var(--text-primary)]',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20'
              )}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>{level.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">后端持久化</span>
            <button
              onClick={handleTogglePersistToBackend}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
                useLogStore.getState().persistToBackend ? 'bg-[var(--accent)]' : 'bg-[var(--border-primary)]'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                  'translate-y-0.5',
                  useLogStore.getState().persistToBackend ? 'translate-x-[18px]' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>
      </Card>

      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <LinkIcon className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">连接管理</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-14 shrink-0">WS状态</span>
            <div className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', wsStatusColor)} />
              <Badge variant="default" size="sm">{wsStatusLabel}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<ArrowPathRoundedSquareIcon className="h-3.5 w-3.5" />}
              onClick={handleWsReconnect}
              className="flex-1"
            >
              重连WS
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<LinkSlashIcon className="h-3.5 w-3.5" />}
              onClick={handleWsDisconnect}
              className="flex-1"
            >
              {confirmAction === 'ws-disconnect' ? '确认断开?' : '断开WS'}
            </Button>
          </div>
        </div>
      </Card>

      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <DocumentArrowDownIcon className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">数据导出</span>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<ArrowDownTrayIcon className="h-3.5 w-3.5" />}
            onClick={handleExportDebugInfo}
            fullWidth
          >
            导出完整调试信息
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<ServerIcon className="h-3.5 w-3.5" />}
            onClick={handleExportStoreSnapshot}
            fullWidth
          >
            导出Store快照
          </Button>
        </div>
      </Card>

      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <WrenchScrewdriverIcon className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">页面操作</span>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="danger"
            size="sm"
            icon={<FireIcon className="h-3.5 w-3.5" />}
            onClick={handleForceReload}
            fullWidth
          >
            {confirmAction === 'force-reload' ? '确认刷新?' : '强制刷新页面'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<TrashIcon className="h-3.5 w-3.5" />}
            onClick={handleClearSessionStorage}
            fullWidth
          >
            清除开发者sessionStorage
          </Button>
        </div>
      </Card>

      {confirmAction && (
        <div className="fixed bottom-16 right-4 z-50 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500" />
            <span className="text-xs font-medium text-[var(--text-primary)]">确认操作</span>
          </div>
          <p className="text-[10px] text-[var(--text-secondary)] mb-2">此操作不可撤销，再次点击按钮确认执行</p>
          <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)} fullWidth>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}
