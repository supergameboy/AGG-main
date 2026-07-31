import { useEffect, useCallback, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowPathIcon, BookmarkSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { GameLayout } from '@/components/layout/GameLayout';
import { DialogueBox } from '@/components/game/DialogueBox';
import type { DialogueOption } from '@/components/game/DialogueBox';
import { ChatProgressTree } from '@/components/game/ChatProgressTree';
import { DynamicUIRenderer, parseUIDirective } from '@/components/game/dynamic-ui';
import { useGameStore } from '@/stores/gameStore';
import { useMapStore } from '@/stores/mapStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { useCombatStore } from '@/stores/combatStore';
import { useGameTimeStore } from '@/stores/gameTimeStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { wsManager } from '@/services/WebSocketManager';
import { WSRequestBuilder } from '@/services/WSRequestBuilder';
import { useInteractionHandler } from '@/hooks/useInteractionHandler';
import type { CompleteSaveData } from '@/api/saveApi';
import type { StoryHistoryEvent } from '@/api/gameApi';
import type { UIParsedNode } from '@/types';
import type { ConditionContext } from '@/utils/conditionEvaluator';
import { buildSelectOptionPlayerAction, buildDialogueSelectData } from './selectOption';

export default function Game() {
  const { saveId } = useParams<{ saveId?: string }>();

  const gameTime = useGameTimeStore((s) => s.gameTime);
  const storeSaveId = useGameStore((s) => s.saveId);
  const player = useGameStore((s) => s.player);
  const inventory = useGameStore((s) => s.inventory);
  const quests = useGameStore((s) => s.quests);
  const skills = useGameStore((s) => s.skills);
  const dialogueMessages = useDialogueStore((s) => s.dialogueMessages);
  const dialogueOptions = useDialogueStore((s) => s.dialogueOptions);
  const isTyping = useDialogueStore((s) => s.isTyping);
  const combat = useCombatStore((s) => s.combat);
  const dynamicUIMarkdown = useGameStore((s) => s.dynamicUIMarkdown);
  const dynamicUIInteracted = useGameStore((s) => s.dynamicUIInteracted);
  const setDialogueOptions = useDialogueStore((s) => s.setDialogueOptions);
  const storeSendMessage = useGameStore((s) => s.sendMessage);
  const setGameError = useGameStore((s) => s.setError);
  const registerWSHandlers = useGameStore((s) => s.registerWSHandlers);
  const loadSave = useGameStore((s) => s.loadSave);
  const setDynamicUIInteracted = useGameStore((s) => s.setDynamicUIInteracted);
  const clearDynamicUI = useGameStore((s) => s.clearDynamicUI);
  const npcInfoList = useGameStore((s) => s.npcInfoList);
  const targetNpcIds = useGameStore((s) => s.targetNpcIds);
  const toggleTargetNpc = useGameStore((s) => s.toggleTargetNpc);
  const currentLocationId = useMapStore((s) => s.mapState.currentLocationId);
  const specialRules = useGameStore((s) => s.specialRules);
  const chatProgressTree = useGameStore((s) => s.chatProgressTree);
  const uiIntensity = useGameStore((s) => s.uiIntensity);

  const { sendInteraction } = useInteractionHandler();

  const conditionContext: ConditionContext = useMemo(() => ({
    character: player,
    inventory: inventory ?? [],
    quests: quests ?? [],
    skills: skills ?? [],
  }), [player, inventory, quests, skills]);

  const [dynamicUINodes, setDynamicUINodes] = useState<UIParsedNode[]>([]);

  useEffect(() => {
    if (dynamicUIMarkdown) {
      const parsed = parseUIDirective(dynamicUIMarkdown);
      setDynamicUINodes(parsed);
    } else {
      setDynamicUINodes([]);
    }
  }, [dynamicUIMarkdown]);

  const effectiveUIIntensity = useMemo(() => {
    if (uiIntensity !== 'minimal') return uiIntensity;
    const hasContentNodes = dynamicUINodes.some(
      n => n.type === 'component' && !['panel', 'grid', 'columns', 'scroll-box', 'tabs', 'tab-panel'].includes(n.component ?? '')
    );
    if (hasContentNodes) return 'partial' as const;
    const hasContainerWithChildren = dynamicUINodes.some(
      n => n.type === 'component' && ['panel', 'grid', 'columns'].includes(n.component ?? '') && (n.children?.length ?? 0) > 0
    );
    if (hasContainerWithChildren) return 'partial' as const;
    return 'minimal' as const;
  }, [uiIntensity, dynamicUINodes]);

  const handleDynamicUIInteraction = useCallback(
    (interaction: Parameters<typeof sendInteraction>[0]) => {
      setDynamicUIInteracted(true);
      sendInteraction(interaction);
    },
    [sendInteraction, setDynamicUIInteracted]
  );

  const loadSaveData = useCallback(
    async (sid: string) => {
      const currentState = useGameStore.getState();
      if (currentState.isInitialized && currentState.saveId === sid) {
        return;
      }
      try {
        const wsResult = await wsManager.sendRequest(
          WSRequestBuilder.game.load({ saveId: sid }),
        ) as Record<string, unknown>;
        const resultData = (wsResult.data ?? wsResult) as Record<string, unknown>;
        const saveData = resultData.save as CompleteSaveData;
        const storyHistory = resultData.storyHistory as { events: StoryHistoryEvent[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } } | undefined;

        loadSave(saveData);

        // 直接填充故事历史，无需再发 HTTP 请求
        if (storyHistory) {
          useGameStore.setState((s) => {
            s.storyHistory = storyHistory.events;
            s.storyHistoryPagination = storyHistory.pagination;
          });
        }

        useGameStore.getState().addLog({
          id: `system-${Date.now()}`,
          type: 'system',
          message: '存档加载成功',
          timestamp: Date.now(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '加载存档失败';
        useGameStore.getState().setError(message);
        useGameStore.getState().addLog({
          id: `error-${Date.now()}`,
          type: 'system',
          message: `加载失败: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [loadSave]
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const handleManualSave = useCallback(async () => {
    if (!storeSaveId || isSaving) return;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await wsManager.sendRequest(WSRequestBuilder.save.save({ saveId: storeSaveId }));
      setSaveMessage('保存成功');
      useGameStore.getState().addLog({
        id: `save-${Date.now()}`,
        type: 'system',
        message: '游戏已保存',
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setSaveMessage(`保存失败: ${message}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 5000);
    }
  }, [storeSaveId, isSaving]);

  const handleAutoSave = useCallback(async () => {
    if (!storeSaveId || isSaving) return;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.autoSave({ saveId: storeSaveId })) as Record<string, unknown>;
      const result = (wsResult.data ?? wsResult) as { autoSaved?: boolean; reason?: string };
      if (result.autoSaved === false) {
        setSaveMessage(result.reason === 'no_changes' ? '无变化，跳过自动保存' : `自动保存跳过: ${result.reason}`);
        setTimeout(() => setSaveMessage(null), 2000);
      } else {
        setSaveMessage('自动保存成功');
        useGameStore.getState().addLog({
          id: `autosave-${Date.now()}`,
          type: 'system',
          message: '自动保存完成',
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '自动保存失败';
      setSaveMessage(`自动保存失败: ${message}`);
    } finally {
      setIsSaving(false);
      if (!saveMessage?.includes('跳过')) {
        setTimeout(() => setSaveMessage(null), 3000);
      }
    }
  }, [storeSaveId, isSaving]);

  const { isConnected, connectionState } = useWebSocket();

  // 注册 WS 消息处理器
  useEffect(() => {
    const unregister = registerWSHandlers();
    return unregister;
  }, [registerWSHandlers]);

  // 加载存档后 subscribe
  useEffect(() => {
    if (saveId) {
      let cancelled = false;
      loadSaveData(saveId).then(() => {
        if (!cancelled) {
          wsManager.subscribe(saveId);
        }
      });
      return () => {
        cancelled = true;
        wsManager.unsubscribe();
      };
    }
  }, [saveId, loadSaveData]);

  useEffect(() => {
    const handleDevReconnect = () => wsManager.reconnect();
    const handleDevDisconnect = () => wsManager.disconnect();
    window.addEventListener('devtools:ws-reconnect', handleDevReconnect);
    window.addEventListener('devtools:ws-disconnect', handleDevDisconnect);
    return () => {
      window.removeEventListener('devtools:ws-reconnect', handleDevReconnect);
      window.removeEventListener('devtools:ws-disconnect', handleDevDisconnect);
    };
  }, []);

  const sendMessage = useCallback(
    async (
      message: string,
      action?: string,
      data?: Record<string, unknown>,
      playerAction?: {
        type: string;
        targetNpcId?: string;
        selectedOptionId?: string;
      }
    ) => {
      if (!message.trim() || !storeSaveId || isTyping) return;

      const trimmed = message.trim();

      setDialogueOptions([]);

      await storeSendMessage(trimmed, action, data, undefined, playerAction);
    },
    [storeSaveId, isTyping, setDialogueOptions, storeSendMessage]
  );

  const handleOptionSelect = useCallback(
    (option: DialogueOption) => {
      try {
        // dialogue-LLM 直接路径：interactionType='select' → resolveAction → 'dialogue-LLM'
        const selectData = buildDialogueSelectData(option);
        sendMessage(
          option.text,
          'select',
          selectData,
          buildSelectOptionPlayerAction(option)
        );
      } catch (error) {
        setGameError(error instanceof Error ? error.message : '对话选项缺少明确的目标 NPC');
      }
    },
    [sendMessage, setGameError]
  );

  const handleDialogueSend = useCallback(
    (message: string) => {
      sendMessage(message);
    },
    [sendMessage]
  );

  return (
    <GameLayout>
      <div className="flex h-full flex-col">
        {/* 断连提示 Banner */}
        {!isConnected && (
          <div className="bg-yellow-600 text-white px-4 py-2 text-center text-sm">
            {connectionState === 'reconnecting' ? '正在重连...' : '连接已断开，请检查网络'}
          </div>
        )}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <div
            className={`h-2 w-2 rounded-full ${
              connectionState === 'connected'
                ? 'bg-green-500'
                : connectionState === 'reconnecting' || connectionState === 'connecting'
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-[var(--text-muted)]">
            {connectionState === 'connected'
              ? '已连接'
              : connectionState === 'reconnecting' || connectionState === 'connecting'
                ? '重连中'
                : '未连接'}
            {combat.active && ' | ⚔ 战斗中'}
          </span>
          {saveMessage && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium animate-pulse ${
              saveMessage.includes('失败') 
                ? 'text-red-300 bg-red-500/20 border border-red-500/30' 
                : 'text-green-300 bg-green-500/20 border border-green-500/30'
            }`}>
              {saveMessage.includes('失败') ? '✗' : '✓'} {saveMessage}
            </span>
          )}
          {storeSaveId && (
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={handleManualSave}
                disabled={isSaving || specialRules?.save_restriction === 'checkpoint_only' || specialRules?.save_restriction === 'ironman'}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                title={
                  specialRules?.save_restriction === 'checkpoint_only' ? '存档限制：仅检查点存档'
                    : specialRules?.save_restriction === 'ironman' ? '存档限制：铁人模式'
                    : '保存游戏'
                }
              >
                <BookmarkSquareIcon className="h-3.5 w-3.5" />
                <span>{isSaving ? '保存中...' : '保存'}</span>
              </button>
              <button
                onClick={handleAutoSave}
                disabled={isSaving || specialRules?.save_restriction === 'manual_only' || specialRules?.save_restriction === 'ironman'}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                title={
                  specialRules?.save_restriction === 'manual_only' ? '存档限制：仅手动存档'
                    : specialRules?.save_restriction === 'ironman' ? '存档限制：铁人模式'
                    : '自动保存'
                }
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${isSaving ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
          {player && (
            <span className="ml-auto text-xs text-[var(--text-muted)]">
              {gameTime && (
                <span className="mr-2">
                  🕐 第{gameTime.day}天 {gameTime.hour.toString().padStart(2, '0')}:{gameTime.minute.toString().padStart(2, '0')}
                </span>
              )}
              {player.name} Lv.{player.level}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-hidden px-2 pb-2 flex flex-col gap-2">
          {dynamicUINodes.length > 0 && effectiveUIIntensity !== 'none' && (
            <div className="flex-shrink-0 max-h-[40%] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 relative">
              <button
                onClick={clearDynamicUI}
                className="absolute top-2 right-2 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] z-10"
                title="关闭"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
              <div className={dynamicUIInteracted ? 'pointer-events-none opacity-50' : ''}>
                <DynamicUIRenderer nodes={dynamicUINodes} onInteraction={handleDynamicUIInteraction} conditionContext={conditionContext} uiIntensity={effectiveUIIntensity} />
              </div>
            </div>
          )}
          <ChatProgressTree tree={chatProgressTree} />
          <DialogueBox
            messages={dialogueMessages}
            options={dialogueOptions}
            onOptionSelect={handleOptionSelect}
            onSendMessage={handleDialogueSend}
            isTyping={isTyping}
            disabled={!isConnected}
            className="flex-1 min-h-0"
            npcInfoList={npcInfoList}
            targetNpcIds={targetNpcIds}
            onToggleTargetNpc={toggleTargetNpc}
            currentLocationId={currentLocationId ?? undefined}
            hasKp={specialRules?.has_kp ?? false}
          />
        </div>
      </div>
    </GameLayout>
  );
}
