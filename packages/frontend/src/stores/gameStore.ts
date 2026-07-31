import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Character, NPC, FrontendInventoryItem, Quest, ID, UITheme, UILayout, EquipmentSlotDefinition, SpecialRules, FrontendCharacterSkill, FrontendNPCInfo, ChallengeMode } from '@/types';
import type { DialogueOption } from '@/components/game/DialogueBox';
import { logger } from '@/utils/logger';
import type { InitGameParams, InitGameResponse, ChatResult, ChatParams, StoryHistoryEvent } from '@/api/gameApi';
import type { CompleteSaveData } from '@/api/saveApi';
import type { GameEvent } from '@/types';
import type { PanelUpdates, InitState } from '@ai-rpg/shared';
import type { ProgressEvent, TaskEndDetail, SubAgentDetail, ThinkingDetail, ToolCallDetail, ToolResultDetail, ErrorDetail } from '@ai-rpg/shared';
import { buildTaskNodeId } from '@ai-rpg/shared';
import type { ProgressTreeState, ProgressNode } from '@/types/progress';
import { translateTaskDescription } from '@/types/progress';
import { applyPanelUpdates, isValidEntityIdFor } from '@/utils/panelUpdateMerger';
import type { SubStoreHandlers } from '@/utils/panelUpdateMerger';
import { filterByOwnerType } from '@/utils/entityFilter';
import { useDialogueStore } from '@/stores/dialogueStore';
import type { DialogueMessage } from '@/components/game/DialogueBox';
import { useCombatStore, type CombatEnemy, type CombatLog } from '@/stores/combatStore';
import { useMapStore } from '@/stores/mapStore';
import { useGameTimeStore } from '@/stores/gameTimeStore';
import type { GameTime } from '@/stores/gameTimeStore';
import { useConsistencyStore } from '@/stores/consistencyStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePerformanceStore } from '@/stores/performanceStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { wsManager } from '@/services/WebSocketManager';
import { WSRequestBuilder } from '@/services/WSRequestBuilder';

import { GameDataMapper } from '@/mappers';
import { mapQuestRealtimeUpdate } from '@/mappers';

let _msgIdCounter = 0;
function nextMsgId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_msgIdCounter}`;
}

let _chatTreeFadeTimer: ReturnType<typeof setTimeout> | null = null;

interface LogEntry {
  id: string;
  type: 'combat' | 'dialogue' | 'quest' | 'system' | 'event' | 'exploration';
  message: string;
  timestamp: number;
  details?: string;
}

interface StoryHistoryPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type GameCharacterSkill = FrontendCharacterSkill;

type NPCInfo = FrontendNPCInfo;

interface TemplateDefinitionData {
  skills: Record<string, unknown>[];
  items: Record<string, unknown>[];
  npcs: Record<string, unknown>[];
}

interface GameState {
  currentScene: { id: string; name: string; description: string; location?: string; atmosphere?: string } | null;
  player: Character | null;
  npcs: NPC[];
  npcInfoList: NPCInfo[];
  inventory: FrontendInventoryItem[];
  equipment: FrontendInventoryItem[];
  quests: Quest[];
  skills: GameCharacterSkill[];
  logs: LogEntry[];
  storyHistory: StoryHistoryEvent[];
  storyHistoryPagination: StoryHistoryPagination | null;
  isStoryHistoryLoading: boolean;
  isLoading: boolean;
  error: string | null;
  saveId: ID | null;
  templateId: string | null;
  isInitialized: boolean;
  uiTheme: UITheme | null;
  uiLayout: UILayout | null;
  dynamicUIMarkdown: string | null;
  dynamicUIInteracted: boolean;
  uiIntensity: 'full' | 'partial' | 'minimal' | 'none';
  equipmentSlotDefs: EquipmentSlotDefinition[] | null;
  specialRules: SpecialRules | null;
  numericalComplexity: string | null;
  templateData: TemplateDefinitionData | null;
  targetNpcIds: string[];
  initProgressTree: ProgressTreeState | null;
  chatProgressTree: ProgressTreeState | null;
  initFatalError: string | null;
  isInitializing: boolean;
  lastDataChanges: Record<string, { toolType: string; method: string; summary: string }> | null;
  currentRequestId: string | null;
  initState: InitState;

  setCurrentScene: (scene: GameState['currentScene']) => void;
  setPlayer: (player: Character | null) => void;
  updatePlayer: (updates: Partial<Character>) => void;
  setNpcs: (npcs: NPC[]) => void;
  addNpc: (npc: NPC) => void;
  removeNpc: (npcId: ID) => void;
  setNpcInfoList: (npcs: NPCInfo[]) => void;
  setInventory: (inventory: FrontendInventoryItem[]) => void;
  addInventoryItem: (item: FrontendInventoryItem) => void;
  removeInventoryItem: (itemId: ID) => void;
  updateInventoryItem: (itemId: ID, updates: Partial<FrontendInventoryItem>) => void;
  setQuests: (quests: Quest[]) => void;
  addQuest: (quest: Quest) => void;
  updateQuest: (questId: ID, updates: Partial<Quest>) => void;
  removeQuest: (questId: ID) => void;
  setSkills: (skills: GameCharacterSkill[]) => void;
  addLog: (entry: LogEntry) => void;
  addLogs: (entries: LogEntry[]) => void;
  clearLogs: () => void;
  fetchStoryHistory: (options?: { page?: number; pageSize?: number }) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSaveId: (saveId: ID | null) => void;
  setUiLayout: (layout: UILayout | null) => void;
  setDynamicUIInteracted: (interacted: boolean) => void;
  clearDynamicUI: () => void;
  reset: () => void;
  toggleTargetNpc: (npcId: string) => void;
  setTargetNpcIds: (npcIds: string[]) => void;

  initializeGame: (params: InitGameParams) => Promise<InitGameResponse>;
  sendMessage: (
    message: string,
    action?: string,
    data?: Record<string, unknown>,
    npcId?: string,
    playerAction?: ChatParams['playerAction']
  ) => Promise<ChatResult | null>;
  loadSave: (saveData: CompleteSaveData) => void;
  /** @internal 内部方法，处理非进度类 WS 事件 */
  handleWebSocketEvent: (event: GameEvent) => void;
  handleWSMessage: (message: import('@ai-rpg/shared').WSMessage) => void;
  handleProgressEvent: (event: import('@ai-rpg/shared').WSGameEvent) => void;
  handleGameError: (event: import('@ai-rpg/shared').WSGameError) => void;
  processWSInitResult: (resultData: Record<string, unknown>) => Promise<void>;
  registerWSHandlers: () => () => void;
  processChatResponse: (result: ChatResult) => void;
  combatAction: (action: string, targetId?: string) => Promise<void>;
  applyPanelUpdatesAction: (updates: PanelUpdates) => void;
  applyUITheme: () => void;
  clearUITheme: () => void;
  generateDialogueOptionsForCurrentScene: () => void;
  updateProgressTree: (treeType: 'init' | 'chat', event: ProgressEvent) => void;
  startChatTreeFadeOut: () => void;
  syncAgentStore: (event: ProgressEvent) => void;
}

const initialState = {
  currentScene: null as GameState['currentScene'],
  player: null as Character | null,
  npcs: [] as NPC[],
  npcInfoList: [] as NPCInfo[],
  inventory: [] as FrontendInventoryItem[],
  equipment: [] as FrontendInventoryItem[],
  quests: [] as Quest[],
  skills: [] as GameCharacterSkill[],
  logs: [] as LogEntry[],
  storyHistory: [] as StoryHistoryEvent[],
  storyHistoryPagination: null as StoryHistoryPagination | null,
  isStoryHistoryLoading: false,
  isLoading: false,
  error: null as string | null,
  saveId: null as ID | null,
  templateId: null as string | null,
  isInitialized: false,
  uiTheme: null as UITheme | null,
  uiLayout: null as UILayout | null,
  dynamicUIMarkdown: null as string | null,
  dynamicUIInteracted: false,
  uiIntensity: 'full' as 'full' | 'partial' | 'minimal' | 'none',
  equipmentSlotDefs: null as EquipmentSlotDefinition[] | null,
  specialRules: null as SpecialRules | null,
  numericalComplexity: null as string | null,
  templateData: null as TemplateDefinitionData | null,
  targetNpcIds: [] as string[],
  initProgressTree: null as ProgressTreeState | null,
  chatProgressTree: null as ProgressTreeState | null,
  initFatalError: null as string | null,
  isInitializing: false,
  lastDataChanges: null,
  currentRequestId: null as string | null,
  initState: 'idle' as InitState,
};

function sanitizeCustomCss(css: string): string {
  const ALLOWED_PROPERTIES = new Set([
    'color', 'background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'text-indent', 'text-shadow',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-radius', 'border-color', 'border-style', 'border-width', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
    'display', 'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap', 'order', 'flex-grow', 'flex-shrink', 'flex-basis',
    'opacity', 'visibility', 'overflow', 'overflow-x', 'overflow-y',
    'box-shadow', 'text-overflow', 'white-space', 'word-break', 'word-wrap',
    'transition', 'transform', 'animation', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction',
    'cursor', 'list-style', 'list-style-type', 'list-style-position',
    'outline', 'outline-offset', 'outline-style', 'outline-width', 'outline-color',
    'vertical-align', 'float', 'clear', 'position', 'z-index',
    'top', 'right', 'bottom', 'left',
    'filter', 'backdrop-filter', 'mix-blend-mode',
    'grid', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-gap',
  ]);

  const BLOCKED_VALUES = /expression\s*\(|javascript:|vbscript:|data:\s*text\/html|@import|behavior\s*:|binding\s*:|-moz-binding|content\s*:\s*url\s*\(/i;

  return css
    .split(/([;{}])/)
    .map(segment => {
      const trimmed = segment.trim();
      if (trimmed === '' || trimmed === '{' || trimmed === '}' || trimmed === ';') return segment;

      if (trimmed.startsWith('@') || trimmed.startsWith('from') || trimmed.startsWith('to') || trimmed.includes('%')) return segment;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return segment;

      const prop = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const value = trimmed.substring(colonIdx + 1).trim();

      if (!ALLOWED_PROPERTIES.has(prop)) return '';
      if (BLOCKED_VALUES.test(value)) return '';
      if (/url\s*\(/i.test(value) && !/url\s*\(\s*['"]?(https?:|data:image\/)/i.test(value)) return '';

      return segment;
    })
    .join('');
}

function applyThemeToDOM(theme: UITheme): void {
  const root = document.documentElement;

  if (theme.primary_color) {
    root.style.setProperty('--accent', theme.primary_color);
  }

  const fontFamilyMap: Record<string, string> = {
    'system': 'system-ui, sans-serif',
    'serif': 'Georgia, "Times New Roman", serif',
    'sans-serif': 'Helvetica, Arial, sans-serif',
    'monospace': '"Courier New", Courier, monospace',
    'cursive': '"Comic Sans MS", cursive',
    'fantasy': 'Impact, fantasy',
  };
  if (theme.font_family && fontFamilyMap[theme.font_family]) {
    root.style.setProperty('--font-game', fontFamilyMap[theme.font_family]);
  }

  if (theme.background_style === 'solid' && theme.primary_color) {
    root.style.setProperty('--template-bg', theme.primary_color);
  } else if (theme.background_style === 'gradient' && theme.gradient_colors) {
    const gc = theme.gradient_colors;
    const dir = gc.direction || 'to bottom';
    root.style.setProperty('--template-bg', `linear-gradient(${dir}, ${gc.start}, ${gc.end})`);
  } else if (theme.background_style === 'image' && theme.background_image) {
    root.style.setProperty('--template-bg', `url(${theme.background_image}) center/cover no-repeat`);
  }

  if (theme.custom_css) {
    const sanitized = sanitizeCustomCss(theme.custom_css);
    if (sanitized.trim()) {
      let styleEl = document.getElementById('template-custom-css');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'template-custom-css';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = sanitized;
    }
  }
}

function clearThemeFromDOM(): void {
  const root = document.documentElement;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--font-game');
  root.style.removeProperty('--template-bg');
  const styleEl = document.getElementById('template-custom-css');
  if (styleEl) styleEl.remove();
}

function getSubStoreHandlers(): SubStoreHandlers {
  return {
    onCombatUpdate: (update) => {
      const combatStore = useCombatStore.getState();
      if (update.active !== undefined) combatStore.setCombat({ active: update.active });
      if (update.playerHP !== undefined) combatStore.setCombat({ playerHP: update.playerHP });
      if (update.playerMaxHP !== undefined) combatStore.setCombat({ playerMaxHP: update.playerMaxHP });
      if (update.playerMP !== undefined) combatStore.setCombat({ playerMP: update.playerMP });
      if (update.playerMaxMP !== undefined) combatStore.setCombat({ playerMaxMP: update.playerMaxMP });
      if (update.isPlayerTurn !== undefined) combatStore.setCombat({ isPlayerTurn: update.isPlayerTurn });
      if (update.availableActions !== undefined) combatStore.setCombat({ availableActions: update.availableActions });
      if (update.enemies !== undefined) {
        combatStore.setCombat({
          enemies: update.enemies.map((e) => ({
            id: e.id,
            name: e.name,
            hp: e.hp,
            maxHP: e.maxHP,
            mp: e.mp ?? 0,
            maxMP: e.maxMP ?? 0,
            level: e.level,
            status: e.status,
          })),
        });
      }
      if (update.log && update.log.length > 0) {
        const currentLog = useCombatStore.getState().combat.log;
        const currentTurn = useCombatStore.getState().combat.currentTurn;
        const newLogs: CombatLog[] = update.log.map((entry, i) => ({
          turn: entry.turn ?? (currentTurn + i),
          message: entry.message,
          type: entry.type ?? 'info' as const,
        }));
        combatStore.setCombat({ log: [...currentLog, ...newLogs] });
      }
    },
    onLocationUpdate: (update) => {
      const mapStore = useMapStore.getState();

      // 先处理 newLocations，再更新 currentLocationId（避免 find 时新位置尚未加入 locations）
      if (update.newLocations && update.newLocations.length > 0) {
        const existingIds = new Set(mapStore.mapState.locations.map((l) => l.id));
        const newLocs = update.newLocations
          .filter((loc) => !existingIds.has(loc.id))
          .map((loc) => ({
            id: loc.id,
            name: loc.name,
            description: loc.description,
            type: loc.type,
            parentLocationId: loc.parentLocationId,
            locationLevel: loc.locationLevel,
            x: loc.x,
            y: loc.y,
            discovered: true as const,
            dangerLevel: loc.dangerLevel,
            customData: loc.customData as Record<string, unknown> | undefined,
          }));
        if (newLocs.length > 0) {
          mapStore.setMapState({ locations: [...mapStore.mapState.locations, ...newLocs] });
        }
      }
      if (update.currentLocationId !== undefined) {
        mapStore.setMapState({ currentLocationId: update.currentLocationId });
        const location = mapStore.mapState.locations.find(l => l.id === update.currentLocationId);
        if (location) {
          useGameStore.getState().setCurrentScene({
            id: location.id,
            name: location.name,
            description: location.description || '',
            location: location.name,
          });
        } else if (update.currentLocationName) {
          // fallback：新位置尚未加入 locations，使用名称直接设置
          useGameStore.getState().setCurrentScene({
            id: update.currentLocationId,
            name: update.currentLocationName,
            description: '',
            location: update.currentLocationName,
          });
        }
      }
      if (update.discoveredLocationIds && update.discoveredLocationIds.length > 0) {
        const existing = new Set(mapStore.mapState.discoveredLocationIds);
        const newIds = [...update.discoveredLocationIds.filter((id) => !existing.has(id))];
        if (newIds.length > 0) {
          mapStore.setMapState({
            discoveredLocationIds: [...mapStore.mapState.discoveredLocationIds, ...newIds],
          });
        }
      }
      if (update.newConnections && update.newConnections.length > 0) {
        const newConns = update.newConnections.map((conn) => ({
          from: conn.from,
          to: conn.to,
          direction: conn.direction,
          connectionType: conn.connectionType,
          distance: conn.distance,
          travelTime: conn.travelTime,
        }));
        mapStore.setMapState({ connections: [...mapStore.mapState.connections, ...newConns] });
      }
    },
    // 统一面板变更推送机制：dialogue 面板更新回调（设计 5.14）
    // - addedMessages: 逐条添加到 useDialogueStore（按 id 去重）
    //   - messageType === 'player_meta' 跳过（已由 sendMessage 乐观更新添加）
    //   - 其余消息调用 addDialogueMessage，使用后端生成的 id 保证幂等性
    // - options: 调用 setDialogueOptions 覆盖快速选项
    onDialogueUpdate: (update) => {
      if (update.addedMessages && update.addedMessages.length > 0) {
        for (const msg of update.addedMessages) {
          // 玩家消息回声跳过（已由 sendMessage 乐观更新添加到 dialogueStore）
          if (msg.messageType === 'player_meta') continue;
          useDialogueStore.getState().addDialogueMessage({
            id: msg.id,
            speaker: msg.speaker,
            content: msg.content,
            emotion: msg.emotion,
            isPlayer: false,
            messageType: msg.messageType ?? 'npc',
            timestamp: Date.now(),
          });
        }
      }
      if (update.options !== undefined) {
        useDialogueStore.getState().setDialogueOptions(update.options);
      }
    },
  };
}

export const useGameStore = create<GameState>()(
  devtools(
    immer((set, get) => ({
        ...initialState,

        setCurrentScene: (scene) =>
          set((state) => {
            state.currentScene = scene;
          }),

        setPlayer: (player) =>
          set((state) => {
            state.player = player;
          }),

        updatePlayer: (updates) =>
          set((state) => {
            if (state.player) {
              Object.assign(state.player, updates);
            }
          }),

        setNpcs: (npcs) =>
          set((state) => {
            state.npcs = npcs;
          }),

        addNpc: (npc) =>
          set((state) => {
            state.npcs.push(npc);
          }),

        removeNpc: (npcId) =>
          set((state) => {
            const index = state.npcs.findIndex((n) => n.id === npcId);
            if (index !== -1) {
              state.npcs.splice(index, 1);
            }
          }),

        setNpcInfoList: (npcs) =>
          set((state) => {
            state.npcInfoList = npcs;
          }),

        setInventory: (inventory) =>
          set((state) => {
            // §13.3 + 架构提升：统一使用白名单 filterByOwnerType，替代黑名单 !== 'npc'
            // 期望效果：state.inventory 只含 ownerType='character' 的物品
            state.inventory = filterByOwnerType(inventory, 'character');
          }),

        addInventoryItem: (item) =>
          set((state) => {
            const existing = state.inventory.find((i) => i.itemId === item.itemId);
            if (existing) {
              existing.quantity += item.quantity;
            } else {
              state.inventory.push(item);
            }
          }),

        removeInventoryItem: (itemId) =>
          set((state) => {
            const index = state.inventory.findIndex((i) => i.id === itemId);
            if (index !== -1) {
              state.inventory.splice(index, 1);
            }
          }),

        updateInventoryItem: (itemId, updates) =>
          set((state) => {
            const item = state.inventory.find((i) => i.id === itemId);
            if (item) {
              Object.assign(item, updates);
            }
          }),

        setQuests: (quests) =>
          set((state) => {
            state.quests = quests;
          }),

        addQuest: (quest) =>
          set((state) => {
            state.quests.push(quest);
          }),

        updateQuest: (questId, updates) =>
          set((state) => {
            const quest = state.quests.find((q) => q.id === questId);
            if (quest) {
              Object.assign(quest, updates);
            }
          }),

        removeQuest: (questId) =>
          set((state) => {
            const index = state.quests.findIndex((q) => q.id === questId);
            if (index !== -1) {
              state.quests.splice(index, 1);
            }
          }),

        setSkills: (skills) =>
          set((state) => {
            // §13.3 + 架构提升：与 setInventory 对称，使用白名单 filterByOwnerType
            // 期望效果：state.skills 只含 ownerType='character' 的技能
            state.skills = filterByOwnerType(skills, 'character');
          }),

        addLog: (entry) =>
          set((state) => {
            state.logs.push(entry);
          }),

        addLogs: (entries) =>
          set((state) => {
            state.logs.push(...entries);
          }),

        clearLogs: () =>
          set((state) => {
            state.logs = [];
          }),

        fetchStoryHistory: async (options) => {
          const saveId = get().saveId;
          if (!saveId) {
            return;
          }

          set((state) => {
            state.isStoryHistoryLoading = true;
          });

          try {
            const wsResult = await wsManager.sendRequest(
              WSRequestBuilder.save.storyHistory({
                saveId,
                page: options?.page ?? 1,
                pageSize: options?.pageSize ?? get().storyHistoryPagination?.pageSize ?? 20,
              }),
            ) as Record<string, unknown>;
            const history = (wsResult.data ?? wsResult) as { events: StoryHistoryEvent[]; pagination: StoryHistoryPagination };

            set((state) => {
              state.storyHistory = history.events;
              state.storyHistoryPagination = history.pagination;
              state.isStoryHistoryLoading = false;
            });
          } catch (error) {
            logger.error('gameStore', '加载 story history 失败', undefined, error instanceof Error ? error.stack : undefined);
            set((state) => {
              state.isStoryHistoryLoading = false;
            });
          }
        },

        setLoading: (loading) =>
          set((state) => {
            state.isLoading = loading;
          }),

        setError: (error) =>
          set((state) => {
            state.error = error;
          }),

        setSaveId: (saveId) =>
          set((state) => {
            state.saveId = saveId;
          }),

        setUiLayout: (layout) =>
          set((state) => {
            state.uiLayout = layout;
          }),

        setDynamicUIInteracted: (interacted) =>
          set((state) => {
            state.dynamicUIInteracted = interacted;
          }),

        clearDynamicUI: () =>
          set((state) => {
            state.dynamicUIMarkdown = null;
            state.dynamicUIInteracted = false;
          }),

        toggleTargetNpc: (npcId: string) =>
          set((state) => {
            const idx = state.targetNpcIds.indexOf(npcId);
            if (idx >= 0) {
              state.targetNpcIds.splice(idx, 1);
            } else {
              state.targetNpcIds.push(npcId);
            }
          }),

        setTargetNpcIds: (npcIds: string[]) => set({ targetNpcIds: npcIds }),

        initializeGame: async (params: InitGameParams): Promise<InitGameResponse> => {
          get().reset();
          // 同步重置子Store
          useDialogueStore.getState().clearDialogue();
          useCombatStore.getState().clearCombat();
          useMapStore.getState().clearMapState();
          useGameTimeStore.getState().clearGameTime();

          set((state) => {
            state.isInitializing = true;
            state.isLoading = true;
            state.error = null;
            state.initState = 'requesting';
            state.initProgressTree = { nodes: {}, rootIds: [], activeNodeIds: [], fadingOut: false };
            state.initFatalError = null;
          });
          useDialogueStore.getState().setIsTyping(true);

          // WS 单通道：通过 wsManager 发送初始化请求
          try {
            const resultData = await wsManager.sendRequest(
              WSRequestBuilder.game.initialize({
                templateId: params.templateId || '',
                characterData: params.characterData,
                language: params.language,
              }),
            ) as Record<string, unknown>;

            // resultData 已由 messageHandler 中的 handleWSMessage 处理
            // processWSInitResult 已设置 saveId 等状态
            const metadata = resultData.metadata as Record<string, unknown> | undefined;
            const saveId = (metadata?.saveId as string) ?? get().saveId ?? '';

            return { saveId, templateId: params.templateId } as InitGameResponse;
          } catch (error) {
            set((s) => { s.initState = 'failed'; });
            set((state) => {
              state.isInitializing = false;
              state.isLoading = false;
              state.error = error instanceof Error ? error.message : '游戏初始化失败';
            });
            useDialogueStore.getState().setIsTyping(false);
            throw error;
          }
        },

        sendMessage: async (
          message: string,
          _action?: string,
          data?: Record<string, unknown>,
          npcId?: string,
          playerAction?: ChatParams['playerAction']
        ): Promise<ChatResult | null> => {
          const { saveId, targetNpcIds } = get();
          if (!saveId) {
            set((state) => {
              state.error = '没有活跃的存档，无法发送消息';
            });
            return null;
          }

          useDialogueStore.getState().setIsTyping(true);
          // 清除旧的淡出定时器，防止新树被意外清除
          if (_chatTreeFadeTimer) {
            clearTimeout(_chatTreeFadeTimer);
            _chatTreeFadeTimer = null;
          }
          set((state) => {
            state.error = null;
            state.chatProgressTree = { nodes: {}, rootIds: [], activeNodeIds: [], fadingOut: false };
          });

          // 立即显示玩家消息（乐观更新）
          useDialogueStore.getState().addDialogueMessage({
            id: nextMsgId('player'),
            speaker: '你',
            content: message,
            isPlayer: true,
            messageType: 'player',
            timestamp: Date.now(),
          });

          // 三层路由：根据 initialIntentHint 动态选择 action
          // - 前端已知意图（如 use_item、travel）→ 走 -LLM 直接路径
          // - 前端未知意图（自由文本）→ 走 chat 间接路径
          const initialIntentHint = (data?.interactionType as string) || _action || 'chat';

          try {
            const resultData = await wsManager.sendRequest(
              WSRequestBuilder.game.resolve({
                message,
                saveId,
                intentHint: initialIntentHint,
                data: { ...data, npcId, targetNpcIds, playerAction, dataChanges: get().lastDataChanges ?? undefined },
                npcId,
                targetNpcIds,
                playerAction: playerAction as Record<string, unknown>,
              }),
            ) as Record<string, unknown>;

            // resultData 已由 messageHandler 中的 handleWSMessage 处理
            // setIsTyping(false) 由 handleWSMessage 的 game:result 分支处理，此处不重复调用
            return { data: resultData } as unknown as ChatResult;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '发送消息失败';
            useDialogueStore.getState().setIsTyping(false);
            useDialogueStore.getState().addDialogueMessage({
              id: nextMsgId('sys-err'),
              speaker: '系统',
              content: errorMsg,
              isPlayer: false,
              messageType: 'system',
              timestamp: Date.now(),
            });
            set((state) => {
              state.error = errorMsg;
            });
            return null;
          }
        },

        loadSave: async (saveData: CompleteSaveData) => {
          get().reset();

          const mappedData = GameDataMapper.mapSaveData(saveData);

          try {
          set((state) => {
            state.saveId = saveData.id;
            state.templateId = saveData.template_id;
            state.isInitialized = true;
            if (mappedData.player) state.player = mappedData.player;
            if (mappedData.inventory.length > 0) state.inventory = mappedData.inventory;
            if (mappedData.equipment.length > 0) state.equipment = mappedData.equipment;
            if (mappedData.skills.length > 0) state.skills = mappedData.skills;
            if (saveData.location) {
              state.currentScene = {
                id: saveData.location,
                name: saveData.location,
                description: '',
              };
            }

            if (mappedData.quests.length > 0) state.quests = mappedData.quests;

            if (mappedData.npcInfoList.length > 0) state.npcInfoList = mappedData.npcInfoList;
          });
          } catch (error) {
            logger.error('gameStore', 'loadSave数据映射失败', undefined, error instanceof Error ? error.stack : undefined);
          }

          if (saveData.dialogues && Array.isArray(saveData.dialogues) && saveData.dialogues.length > 0) {
            const playerName = saveData.character?.name as string | undefined;
            const messages: DialogueMessage[] = saveData.dialogues.map((d) => {
              const isPlayerMsg = d.messageType === 'player';
              return {
                id: d.id,
                speaker: isPlayerMsg && (d.speaker === 'player' || !d.speaker) && playerName
                  ? playerName
                  : d.speaker,
                content: d.content,
                emotion: d.emotion,
                isPlayer: isPlayerMsg,
                messageType: d.messageType,
                timestamp: d.timestamp,
              };
            });
            useDialogueStore.getState().setDialogueMessages(messages);
          }

          if (Array.isArray(saveData.locations) && saveData.locations.length > 0) {
            const mapped = mappedData.locationData;
            useMapStore.getState().setMapState({
              locations: mapped.locations,
              connections: mapped.connections,
              discoveredLocationIds: mapped.discoveredLocationIds,
            });
          }

          if (saveData.gameTime) {
            const gt = saveData.gameTime;
            useGameTimeStore.getState().setGameTime({
              day: gt.day,
              hour: gt.hour,
              minute: gt.minute,
              period: gt.periodOfDay,
              season: gt.season,
              description: `${gt.periodOfDay} of day ${gt.day}`,
            });
          }

          if (saveData.game_state) {
            const gs = saveData.game_state as Record<string, unknown>;
            const combatState = gs['combat.state'];
            if (combatState && typeof combatState === 'object') {
              const cs = combatState as Record<string, unknown>;
              useCombatStore.getState().setCombat({
                active: (cs.active as boolean) ?? false,
                enemies: (cs.enemies as CombatEnemy[]) ?? [],
                playerHP: (cs.playerHP as number) ?? 0,
                playerMaxHP: (cs.playerMaxHP as number) ?? 0,
                playerMP: (cs.playerMP as number) ?? 0,
                playerMaxMP: (cs.playerMaxMP as number) ?? 0,
                currentTurn: (cs.currentTurn as number) ?? 0,
                isPlayerTurn: (cs.isPlayerTurn as boolean) ?? false,
                log: (cs.log as CombatLog[]) ?? [],
                availableActions: (cs.availableActions as string[]) ?? ['attack', 'skill', 'defend', 'flee'],
              });
            }
          }

          // 阶段五新增：从 saveData.active_challenge_mode 读取 challengeMode 写入 combatStore
          const activeChallengeMode = saveData.active_challenge_mode as ChallengeMode | null | undefined;
          if (activeChallengeMode !== undefined) {
            useCombatStore.getState().setChallengeMode(activeChallengeMode);
          }

          if (saveData.character) {
            const charData = saveData.character as unknown as Record<string, unknown>;
            const locationId = (charData.current_location_id as string) ?? (saveData.location as string);
            if (locationId) {
              useMapStore.getState().setMapState({ currentLocationId: locationId });
            }
          }

          const templateId = saveData.template_id;
          if (templateId) {
            try {
              const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.characterOptions({ templateId })) as Record<string, unknown>;
              const options = (wsResult.data ?? wsResult) as { races: Array<{ id: string; name: string }>; classes: Array<{ id: string; name: string }>; backgrounds: Array<{ id: string; name: string }>; attributes: Array<{ id: string; name: string }> };
              set((state) => {
                if (!state.player) return;
                const race = options.races.find((r) => r.id === state.player!.race);
                const cls = options.classes.find((c) => c.id === state.player!.class);
                const bg = options.backgrounds.find((b) => b.id === state.player!.background);
                state.player.raceName = race?.name || state.player.race;
                state.player.className = cls?.name || state.player.class;
                state.player.backgroundName = bg?.name || state.player.background;
                if (!state.player.attributeNames || Object.keys(state.player.attributeNames).length === 0) {
                  state.player.attributeNames = {};
                  for (const attr of options.attributes) {
                    state.player.attributeNames[attr.id] = attr.name;
                  }
                }
              });
            } catch (error) {
              logger.error('gameStore', '加载存档角色选项失败', undefined, error instanceof Error ? error.stack : undefined);
            }

            try {
              const wsConfigResult = await wsManager.sendRequest(WSRequestBuilder.template.gameConfig({ templateId })) as Record<string, unknown>;
              const config = (wsConfigResult.data ?? wsConfigResult) as Record<string, unknown>;
              const gameRules = config.game_rules as Record<string, unknown> | undefined;
              set((state) => {
                if (gameRules?.inventory_system && typeof gameRules.inventory_system === 'object') {
                  const inventorySystem = gameRules.inventory_system as Record<string, unknown>;
                  if (inventorySystem.equipment_slots) {
                    state.equipmentSlotDefs = inventorySystem.equipment_slots as EquipmentSlotDefinition[];
                  }
                }
                state.specialRules = (config.special_rules as SpecialRules) || null;
                state.numericalComplexity = (config.numerical_complexity as string) || null;
                state.templateData = {
                  skills: (config.skills as Record<string, unknown>[]) ?? [],
                  items: (config.items as Record<string, unknown>[]) ?? [],
                  npcs: (config.npcs as Record<string, unknown>[]) ?? [],
                };
                if (config.ui_theme) {
                  state.uiTheme = config.ui_theme as UITheme;
                }
                if (config.ui_layout) {
                  state.uiLayout = config.ui_layout as UILayout;
                }
              });
              get().applyUITheme();
            } catch (error) {
              logger.error('gameStore', '获取游戏配置失败', undefined, error instanceof Error ? error.stack : undefined);
            }
          }

          // 加载存档后，为当前场景的可见 NPC 生成对话选项
          get().generateDialogueOptionsForCurrentScene();
        },

        registerWSHandlers: () => {
          const unsubMessage = wsManager.onMessage((message) => {
            get().handleWSMessage(message);
          });
          const unsubState = wsManager.onStateChange((state) => {
            if (state === 'disconnected' || state === 'reconnecting') {
              // 断连/重连中时重置可能卡住的状态
              useDialogueStore.getState().setIsTyping(false);
              set((s) => { s.isLoading = false; });
            }
          });
          return () => {
            unsubMessage();
            unsubState();
          };
        },

        handleWSMessage: (message) => {
          switch (message.type) {
            case 'game:event': {
              get().handleProgressEvent(message as import('@ai-rpg/shared').WSGameEvent);
              break;
            }
            case 'game:result': {
              // 仅处理 game 模块的响应；save/template 等其他模块的响应由
              // wsManager.pendingRequests 中的发起方消费，避免误触发对话处理流程
              // 与 fetchStoryHistory 循环（修复 save.story-history 响应触发死循环）
              const module = (message as { module?: string }).module;
              if (module !== undefined && module !== 'game') {
                break;
              }

              const resultData = message.data as Record<string, unknown>;
              const metadata = resultData.metadata as Record<string, unknown> | undefined;

              // 区分初始化结果和对话结果
              if (metadata?.isInitialization) {
                get().processWSInitResult(resultData);
              } else {
                const chatResult = { data: resultData } as unknown as ChatResult;
                get().processChatResponse(chatResult);
              }

              useDialogueStore.getState().setIsTyping(false);
              set((s) => { s.currentRequestId = null; });
              get().fetchStoryHistory();
              break;
            }
            case 'game:error': {
              get().handleGameError(message as import('@ai-rpg/shared').WSGameError);
              break;
            }
          }
        },

        handleProgressEvent: (event) => {
          const { eventType, data } = event;

          if (eventType === 'agent_progress') {
            const progressEvent = data as unknown as ProgressEvent;
            if (get().isInitializing) {
              get().updateProgressTree('init', progressEvent);
            } else {
              get().updateProgressTree('chat', progressEvent);
            }
            get().syncAgentStore(progressEvent);
            useConsistencyStore.getState().markStoreUpdate('agent_progress', ['game']);
            return;
          }

          // 统一面板变更推送机制：panel:update 事件直接调 applyPanelUpdatesAction，
          // 不进入下方 handleWebSocketEvent 转换委托路径（panel:update 是面板数据变更，
          // 不属于 handleWebSocketEvent 处理的领域事件）。
          if (eventType === 'panel:update') {
            const panelUpdates = (data as { panelUpdates?: PanelUpdates }).panelUpdates;
            if (panelUpdates) {
              get().applyPanelUpdatesAction(panelUpdates);
              useConsistencyStore.getState().markStoreUpdate('panel:update', ['game']);
            }
            return;
          }

          // 非进度事件：转换为传统 GameEvent 格式，委托给 handleWebSocketEvent
          const gameEvent: GameEvent = {
            type: eventType as GameEvent['type'],
            payload: { ...data, save_id: data.saveId || data.save_id },
            timestamp: Date.now(),
          };
          get().handleWebSocketEvent(gameEvent);
        },

        handleGameError: (event) => {
          useDialogueStore.getState().setIsTyping(false);
          useDialogueStore.getState().addDialogueMessage({
            id: nextMsgId('sys-err'),
            speaker: '系统',
            content: event.error || '处理请求时出错',
            isPlayer: false,
            messageType: 'system',
            timestamp: Date.now(),
          });
          set((s) => {
            s.error = event.error;
            s.currentRequestId = null;
            if (s.initState === 'requesting' || s.initState === 'progressing') {
              s.initState = 'failed';
            }
          });
        },

        /** 处理 WS 初始化结果 */
        processWSInitResult: async (resultData: Record<string, unknown>) => {
          const metadata = resultData.metadata as Record<string, unknown> | undefined;
          const innerData = resultData.data as Record<string, unknown> | undefined;
          const saveId = metadata?.saveId as string | undefined;

          if (!saveId) {
            set((s) => {
              s.isInitializing = false;
              s.isLoading = false;
              s.error = '初始化结果缺少 saveId';
            });
            return;
          }

          set((state) => {
            state.saveId = saveId;
            state.isInitialized = true;
            state.logs.push({
              id: `system-init-${Date.now()}`,
              type: 'system',
              message: '游戏初始化完成，冒险开始！',
              timestamp: Date.now(),
            });

            if (innerData) {
              const startingScene = innerData.startingScene as Record<string, unknown> | undefined;
              if (startingScene) {
                state.currentScene = {
                  id: 'starting',
                  name: (startingScene.title as string) || '起始场景',
                  description: (startingScene.content as string) || '',
                  atmosphere: startingScene.atmosphere as string | undefined,
                };
              }

              const uiDirective = innerData.uiDirective as string | undefined
                ?? (innerData.dynamicUI as Record<string, unknown> | undefined)?.uiDirective as string | undefined;
              if (uiDirective) {
                state.dynamicUIMarkdown = uiDirective;
                state.dynamicUIInteracted = false;
              }

              const uiIntensity = innerData.uiIntensity as 'full' | 'partial' | 'minimal' | 'none' | undefined;
              if (uiIntensity) {
                state.uiIntensity = uiIntensity;
              }

              // 统一面板变更推送机制：processWSInitResult 不再解析 panelUpdates
              // 初始化场景的 panelUpdates 由服务端通过独立的 'panel:update' 事件推送
              // （handleProgressEvent 内 eventType === 'panel:update' 分支处理）

              if (innerData.uiTheme) state.uiTheme = innerData.uiTheme as UITheme;
              if (innerData.uiLayout) state.uiLayout = innerData.uiLayout as UILayout;
            }

            state.isLoading = false;
          });

          // 处理对话数据
          // 统一面板变更推送机制：dialogue 数据由 'panel:update' 事件推送（设计 5.15）
          // processWSInitResult 不再读取 innerData.dialogue，由 applyPanelUpdatesAction 处理

          // 处理游戏时间
          const timeData = innerData?.time as { currentTime?: GameTime } | undefined;
          if (timeData?.currentTime) {
            useGameTimeStore.getState().setGameTime(timeData.currentTime);
          }

          get().applyUITheme();

          // 加载完整存档数据（WS 路径）
          try {
            const wsSaveResult = await wsManager.sendRequest(WSRequestBuilder.save.get({ saveId }));
            const saveResult = (wsSaveResult as Record<string, unknown>)?.data ?? wsSaveResult;
            const saveData = saveResult as unknown as Record<string, unknown>;
            if (saveData) {
              const mappedData = GameDataMapper.mapInitResponseData(
                saveData,
                saveId,
                {
                  race: (innerData?.characterData as Record<string, unknown>)?.race as string ?? '',
                  class: (innerData?.characterData as Record<string, unknown>)?.classType as string ?? '',
                  background: (innerData?.characterData as Record<string, unknown>)?.background as string ?? '',
                }
              );

              set((state) => {
                if (mappedData.player) state.player = mappedData.player;
                if (mappedData.inventory.length > 0) state.inventory = mappedData.inventory;
                if (mappedData.skills.length > 0) state.skills = mappedData.skills;
                if (mappedData.quests.length > 0) state.quests = mappedData.quests;
                if (mappedData.npcInfoList.length > 0) state.npcInfoList = mappedData.npcInfoList;

                if (saveData.character) {
                  const raw = saveData.character as Record<string, unknown>;
                  const locationId = (raw.current_location_id as string) ?? (saveData.location as string);
                  if (locationId) {
                    state.currentScene = {
                      id: locationId,
                      name: (innerData?.startingScene as Record<string, unknown>)?.title as string ?? locationId,
                      description: (innerData?.startingScene as Record<string, unknown>)?.content as string ?? '',
                      atmosphere: (innerData?.startingScene as Record<string, unknown> | undefined)?.atmosphere as string | undefined,
                    };
                  }
                }
              });

              if (mappedData.locationData.locations.length > 0) {
                useMapStore.getState().setMapState({
                  locations: mappedData.locationData.locations,
                  connections: mappedData.locationData.connections,
                  discoveredLocationIds: mappedData.locationData.discoveredLocationIds,
                });
              }

              if (saveData.character) {
                const raw = saveData.character as Record<string, unknown>;
                const locationId = (raw.current_location_id as string) ?? (saveData.location as string);
                if (locationId) {
                  useMapStore.getState().setMapState({ currentLocationId: locationId });
                }
              }
            }
          } catch (error) {
            logger.error('gameStore', 'WS初始化后加载存档数据失败', undefined, error instanceof Error ? error.stack : undefined);
          }

          // 加载角色选项和游戏配置
          const templateId = get().templateId;
          if (templateId) {
            try {
              const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.characterOptions({ templateId })) as Record<string, unknown>;
              const options = (wsResult.data ?? wsResult) as { races: Array<{ id: string; name: string }>; classes: Array<{ id: string; name: string }>; backgrounds: Array<{ id: string; name: string }>; attributes: Array<{ id: string; name: string }> };
              set((state) => {
                if (!state.player) return;
                const race = options.races.find((r) => r.id === state.player!.race);
                const cls = options.classes.find((c) => c.id === state.player!.class);
                const bg = options.backgrounds.find((b) => b.id === state.player!.background);
                state.player.raceName = race?.name || state.player.race;
                state.player.className = cls?.name || state.player.class;
                state.player.backgroundName = bg?.name || state.player.background;
                if (!state.player.attributeNames || Object.keys(state.player.attributeNames).length === 0) {
                  state.player.attributeNames = {};
                  for (const attr of options.attributes) {
                    state.player.attributeNames[attr.id] = attr.name;
                  }
                }
              });
            } catch (error) {
              logger.error('gameStore', 'WS初始化后加载角色选项失败', undefined, error instanceof Error ? error.stack : undefined);
            }

            try {
              const wsConfigResult = await wsManager.sendRequest(WSRequestBuilder.template.gameConfig({ templateId })) as Record<string, unknown>;
              const config = (wsConfigResult.data ?? wsConfigResult) as Record<string, unknown>;
              const gameRules = config.game_rules as Record<string, unknown> | undefined;
              set((state) => {
                if (gameRules?.inventory_system && typeof gameRules.inventory_system === 'object') {
                  const inventorySystem = gameRules.inventory_system as Record<string, unknown>;
                  if (inventorySystem.equipment_slots) {
                    state.equipmentSlotDefs = inventorySystem.equipment_slots as EquipmentSlotDefinition[];
                  }
                }
                state.specialRules = (config.special_rules as SpecialRules) || null;
                state.numericalComplexity = (config.numerical_complexity as string) || null;
                state.templateData = {
                  skills: (config.skills as Record<string, unknown>[]) ?? [],
                  items: (config.items as Record<string, unknown>[]) ?? [],
                  npcs: (config.npcs as Record<string, unknown>[]) ?? [],
                };
              });
            } catch (error) {
              logger.error('gameStore', 'WS初始化后获取游戏配置失败', undefined, error instanceof Error ? error.stack : undefined);
            }
          }

          set((state) => {
            state.isInitializing = false;
            state.initState = 'done';
            // 不立即清空 initProgressTree，延迟1秒让最后的进度事件到达
          });
          setTimeout(() => {
            set((state) => {
              if (state.initState === 'done') {
                state.initProgressTree = null;
              }
            });
          }, 1000);
        },

        handleWebSocketEvent: (event: GameEvent) => {
          const state = get();

          // 进度类事件已迁移到 handleProgressEvent，此处仅处理非进度事件
          if (!state.saveId) return;

          try {
          switch (event.type) {
            // 统一面板变更推送机制：'dialogue:message' 事件已废弃（设计 5.17）
            // dialogue 数据由 'panel:update' 事件推送，前端通过 applyPanelUpdatesAction 处理
            case 'combat:turn_start': {
              const payload = event.payload as Record<string, unknown>;
              useCombatStore.getState().setCombat({
                isPlayerTurn: payload.playerTurn === true,
                currentTurn: typeof payload.turn === 'number' ? payload.turn : useCombatStore.getState().combat.currentTurn,
              });
              useConsistencyStore.getState().markStoreUpdate('combat:turn_start', ['combat']);
              get().addLog({
                id: `combat-${Date.now()}`,
                type: 'combat',
                message: `回合 ${payload.turn} - ${payload.playerTurn ? '你的回合' : '敌方回合'}`,
                timestamp: Date.now(),
              });
              break;
            }
            case 'quest:update': {
              const payload = event.payload as Record<string, unknown>;
              if (payload.quest && typeof payload.quest === 'object') {
                const quest = payload.quest as Record<string, unknown>;
                const questId = quest.id as string;
                if (questId) {
                  const { normalized, patch } = mapQuestRealtimeUpdate(quest, get().saveId ?? '');
                  set((s) => {
                    const existing = s.quests.find((q) => q.id === questId);
                    if (existing) {
                      Object.assign(existing, patch);
                    } else if (normalized.description.trim() === '') {
                      console.warn('[gameStore] quest:update rejected missing description for new quest:', questId);
                    } else if (isValidEntityIdFor('quest', questId)) {
                      s.quests.push(normalized);
                    } else {
                      console.warn('[gameStore] quest:update rejected invalid ID:', questId);
                    }
                  });
                }
              }
              get().addLog({
                id: `quest-${Date.now()}`,
                type: 'quest',
                message: `任务更新: ${(payload.quest as Record<string, unknown>)?.name ?? '未知任务'}`,
                timestamp: Date.now(),
              });
              useConsistencyStore.getState().markStoreUpdate('quest:update', ['game']);
              break;
            }
            case 'event:triggered': {
              const payload = event.payload as Record<string, unknown>;
              set((s) => {
                s.logs.push({
                  id: `event-${Date.now()}`,
                  type: 'event',
                  message: typeof payload.description === 'string' ? payload.description : ((payload.event as Record<string, unknown>)?.title as string) ?? '事件触发',
                  timestamp: Date.now(),
                });
              });
              useConsistencyStore.getState().markStoreUpdate('event:triggered', ['game']);
              break;
            }
            case 'dev:staging_write':
            case 'dev:staging_commit':
            case 'dev:event_bus_publish':
            case 'dev:audit_decision':
            case 'dev:runtime_snapshot':
            case 'dev:graph_change': {
              useRuntimeStore.getState().addLiveEvent({
                type: event.type,
                data: event.payload,
                timestamp: Date.now(),
              });
              break;
            }
          }
          } catch (err) {
            logger.error('gameStore', '处理WebSocket事件失败', undefined, err instanceof Error ? err.stack : undefined);
          }
        },

        processChatResponse: (result: ChatResult) => {
          const { data } = result;
          if (!data) return;

          try {
            const gm = data.gm as { processedAt: number; duration: number; reactIterations: number; agentsInvolved: string[] } | undefined;
            const writeOperations = data.writeOperations as Array<{ toolType: string; method: string; timestamp: number }> | undefined;
            const dataChanges = data.dataChanges as Record<string, { toolType: string; method: string; summary: string }> | undefined;
            const agentOutputs: Record<string, unknown> = {};
            if (data.agentOutputs && typeof data.agentOutputs === 'object') {
              Object.entries(data.agentOutputs as Record<string, unknown>).forEach(([key, value]) => {
                if (value !== undefined && value !== null) agentOutputs[key] = value;
              });
            }
            const hasAgentOutputs = Object.keys(agentOutputs).length > 0;

            useAgentStore.getState().endChain({
              gm,
              metadata: result.metadata,
              writeOperations,
              agentOutputs: hasAgentOutputs ? agentOutputs : undefined,
              messages: result.messages,
              toolCalls: result.toolCalls,
            });

            // 阶段五新增：读取 metadata.challengeMode 并写入 combatStore
            // 挑战结束后（challengeEnded=true）后端会传 challengeMode=当前模式 + challengeEnded=true，
            // 前端在 challengeEnded=true 时清空 challengeMode（挑战已结束，下一次响应不再有挑战模式）
            try {
              const challengeMode = result.metadata?.challengeMode;
              if (challengeMode !== undefined) {
                if (result.metadata?.challengeEnded) {
                  useCombatStore.getState().setChallengeMode(null);
                } else {
                  useCombatStore.getState().setChallengeMode(challengeMode);
                }
              }
            } catch (err) {
              logger.error('gameStore', '写入 challengeMode 失败', undefined, err instanceof Error ? err.stack : undefined);
            }

            if (dataChanges && Object.keys(dataChanges).length > 0) {
              set((s) => { s.lastDataChanges = dataChanges; });
            }

            if (result.metadata?.processingTime) {
              usePerformanceStore.getState().recordChatMetric({
                processingTime: result.metadata.processingTime,
                gmDuration: gm?.duration,
                reactIterations: gm?.reactIterations,
                agentsInvolved: gm?.agentsInvolved ?? [],
              });
            }
          } catch (err) {
            logger.error('gameStore', '写入Agent推理数据失败', undefined, err instanceof Error ? err.stack : undefined);
          }

          try {
            const npcWarnings = data.npcWarnings as {
              warningType: string;
              filteredOutNpcs: Array<{ id: string; name: string }>;
              currentLocationName: string;
            } | undefined;
            if (npcWarnings && npcWarnings.filteredOutNpcs?.length > 0) {
              const npcNames = npcWarnings.filteredOutNpcs.map(n => n.name).join('、');
              useDialogueStore.getState().addDialogueMessage({
                id: nextMsgId('npc-warn'),
                speaker: '系统',
                content: `${npcNames}不在这里。你当前在${npcWarnings.currentLocationName}。`,
                isPlayer: false,
                messageType: 'system',
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            logger.error('gameStore', '处理NPC警告失败', undefined, err instanceof Error ? err.stack : undefined);
          }

          // 处理对话数据 -> dialogueStore
          // 统一面板变更推送机制：dialogue 数据由 'panel:update' 事件推送（设计 5.16）
          // processChatResponse 不再读取 data.dialogue，由 applyPanelUpdatesAction 处理

          // 处理面板更新和UI指令（try-catch保护）
          try {
            set((state) => {
              // 扁平化GameResponse：优先使用顶层uiDirective，兼容旧dynamicUI嵌套
              const uiDirective = data.uiDirective ?? (data.dynamicUI as { uiDirective?: string } | undefined)?.uiDirective;
              if (uiDirective) {
                state.dynamicUIMarkdown = uiDirective;
                state.dynamicUIInteracted = false;
              }

              const uiIntensity = data.uiIntensity as 'full' | 'partial' | 'minimal' | 'none' | undefined;
              if (uiIntensity) {
                state.uiIntensity = uiIntensity;
              }

              // 统一面板变更推送机制：processChatResponse 不再解析 panelUpdates
              // chat 流程的 panelUpdates 由服务端通过独立的 'panel:update' 事件推送
              // （handleProgressEvent 内 eventType === 'panel:update' 分支处理）

              if (data.saveId) {
                state.saveId = data.saveId;
              }

              if (result.metadata?.partialSuccess) {
                state.logs.push({
                  id: `warn-${Date.now()}`,
                  type: 'system',
                  message: '部分Agent处理失败，部分数据可能不完整',
                  timestamp: Date.now(),
                });
              }
            });
          } catch (err) {
            logger.error('gameStore', '处理面板更新失败', undefined, err instanceof Error ? err.stack : undefined);
          }

          // 处理游戏时间 -> gameTimeStore（try-catch保护）
          try {
            const timeData = data.time as { currentTime?: GameTime } | undefined;
            if (timeData?.currentTime) {
              useGameTimeStore.getState().setGameTime(timeData.currentTime);
            }
          } catch (err) {
            logger.error('gameStore', '处理时间数据失败', undefined, err instanceof Error ? err.stack : undefined);
          }

          // 所有数据处理完成后启动 chat tree 淡出
          get().startChatTreeFadeOut();
        },

        combatAction: async (action: string, targetId?: string) => {
          const { saveId, player } = get();
          if (!saveId) return;

          useCombatStore.getState().setCombat({ isPlayerTurn: false });

          let message = '';
          switch (action) {
            case 'attack':
              message = targetId ? `攻击目标 ${targetId}` : '攻击';
              break;
            case 'skill':
              message = targetId ? `对目标 ${targetId} 使用技能` : '使用技能';
              break;
            case 'defend':
              message = '防御';
              break;
            case 'flee':
              message = '逃跑';
              break;
            default:
              message = action;
          }

          const { player: combatPlayer } = get();
          useDialogueStore.getState().addDialogueMessage({
            id: nextMsgId('combat'),
            speaker: combatPlayer?.name || '你',
            content: message,
            isPlayer: true,
            messageType: 'player',
            timestamp: Date.now(),
          });

          // 根据 combatMode 解析请求参数（code-design §7.2.1 getActionRequest）
          // - turn_based_combat / dynamic_combat → combat-program 走 G2 快速路径
          // - narrative_combat / null / 其他 → combat-LLM 走 Agent G 路径
          const actorId = player?.id ?? 'player';
          const actionRequest = useCombatStore.getState().getActionRequest(action, { actorId, targetId });
          const requestPayload = {
            ...actionRequest.payload,
            saveId,
          } as Record<string, unknown>;

          try {
            const resultData = await wsManager.sendRequest({
              module: 'game',
              action: actionRequest.action,
              intentHint: actionRequest.intentHint,
              payload: requestPayload,
            }) as Record<string, unknown>;

            if (resultData) {
              // G2 路径响应：data.challengeStep（formatOrchestratorResult 返回结构）
              const challengeStep = resultData.challengeStep as Record<string, unknown> | undefined;
              if (challengeStep) {
                const actionResult = challengeStep.actionResult as Record<string, unknown> | undefined;
                const combatEnded = Boolean(challengeStep.combatEnded);
                const description = (actionResult?.description as string) || '';
                if (description) {
                  useDialogueStore.getState().addDialogueMessage({
                    id: nextMsgId('combat'),
                    speaker: '战斗',
                    content: description,
                    isPlayer: false,
                    messageType: 'system',
                    timestamp: Date.now(),
                  });
                }
                // G2 路径不返回完整 combatState，仅更新 isPlayerTurn，等待 panelUpdate 推送或下一轮请求
                if (!combatEnded) {
                  useCombatStore.getState().setCombat({ isPlayerTurn: true });
                } else {
                  useCombatStore.getState().setCombat({ active: false });
                }
              } else {
                // Agent G 路径响应：data.combat.combatState（兼容旧契约）
                const combatData = resultData.combat as Record<string, unknown> | undefined;
                if (combatData) {
                  const combatState = combatData.combatState as Record<string, unknown> | undefined;
                  if (combatState) {
                    const playerCur = get().player;
                    const enemies = (combatState.enemies as CombatEnemy[]) || [];
                    const isActive = (combatState.status as string) === 'ongoing' && enemies.length > 0;
                    if (isActive && enemies.length > 0) {
                      useCombatStore.getState().startCombat(
                        enemies,
                        (combatState.playerHP as number) ?? playerCur?.currentHP ?? 0,
                        (combatState.playerMaxHP as number) ?? playerCur?.maxHP ?? 0,
                        (combatState.playerMP as number) ?? playerCur?.currentMP ?? 0,
                        (combatState.playerMaxMP as number) ?? playerCur?.maxMP ?? 0,
                      );
                    } else {
                      useCombatStore.getState().setCombat({
                        active: false,
                        playerHP: (combatState.playerHP as number) ?? playerCur?.currentHP ?? 0,
                        playerMaxHP: (combatState.playerMaxHP as number) ?? playerCur?.maxHP ?? 0,
                        playerMP: (combatState.playerMP as number) ?? playerCur?.currentMP ?? 0,
                        playerMaxMP: (combatState.playerMaxMP as number) ?? playerCur?.maxMP ?? 0,
                      });
                    }
                  }
                  const narrative = combatData.narrativeText as string | undefined;
                  if (narrative) {
                    useDialogueStore.getState().addDialogueMessage({
                      id: nextMsgId('combat'),
                      speaker: '战斗',
                      content: narrative,
                      isPlayer: false,
                      messageType: 'system',
                      timestamp: Date.now(),
                    });
                  }
                }

                if (action === 'flee') {
                  useCombatStore.getState().setCombat({ active: false });
                }
              }
            }
          } catch {
            useCombatStore.getState().setCombat({ isPlayerTurn: true });
            if (action === 'flee') {
              useCombatStore.getState().setCombat({ active: false });
            }
          }
        },

        applyPanelUpdatesAction: (updates: PanelUpdates) => {
          set((state) => {
            applyPanelUpdates(state, updates, getSubStoreHandlers());
          });
        },

        reset: () => {
          get().clearUITheme();
          set(initialState);
          // 重置子Store
          useDialogueStore.getState().clearDialogue();
          useDialogueStore.getState().setIsTyping(false);
          useCombatStore.getState().clearCombat();
          useMapStore.getState().clearMapState();
          useGameTimeStore.getState().clearGameTime();
        },

        applyUITheme: () => {
          const theme = get().uiTheme;
          if (!theme) return;
          applyThemeToDOM(theme);
        },

        clearUITheme: () => {
          clearThemeFromDOM();
          set({ uiTheme: null, uiLayout: null });
        },

        generateDialogueOptionsForCurrentScene: () => {
          const state = get();
          const currentLocationId = useMapStore.getState().mapState.currentLocationId;
          if (!currentLocationId) return;

          const visibleNpcs = state.npcInfoList.filter(
            (npc) => npc.visible && npc.locationId === currentLocationId
          );
          if (visibleNpcs.length === 0) return;

          const options: DialogueOption[] = [];
          for (const npc of visibleNpcs) {
            const affinity = npc.affinity ?? 0;
            options.push({
              id: `${npc.id}:situation`,
              text: `询问${npc.name}关于当前的情况`,
              npcId: npc.id,
            });
            if (affinity >= 20) {
              options.push({
                id: `${npc.id}:deep-talk`,
                text: `与${npc.name}深入交谈`,
                npcId: npc.id,
              });
            }
            if (affinity >= 50) {
              options.push({
                id: `${npc.id}:help-request`,
                text: `请求${npc.name}的帮助或建议`,
                npcId: npc.id,
              });
            }
            options.push({
              id: `${npc.id}:farewell`,
              text: '告别',
              npcId: npc.id,
            });
          }

          useDialogueStore.getState().setDialogueOptions(options);
        },

        updateProgressTree: (treeType, event) => {
          const nodeId = buildTaskNodeId(event.agentRunId);
          const parentId = event.parentTask ?? null;

          set((state) => {
            const treeField = treeType === 'init' ? 'initProgressTree' : 'chatProgressTree';
            const tree = state[treeField];
            if (!tree) return;

            if (event.phase === 'task_start') {
              const existingNode = tree.nodes[nodeId];
              const displayDescription = translateTaskDescription(event.agentType, event.taskDescription);
              const newNode: ProgressNode = {
                id: nodeId,
                agentType: event.agentType,
                taskDescription: event.taskDescription,
                displayDescription,
                parentId,
                childIds: existingNode?.childIds ?? [],
                status: 'running',
                fatal: false,
                currentPhase: 'task_start',
                logs: [{ phase: 'task_start', timestamp: event.timestamp }],
                startedAt: event.timestamp,
                endedAt: null,
                latestDetail: null,
              };
              tree.nodes[nodeId] = newNode;

              if (parentId && tree.nodes[parentId]) {
                if (!tree.nodes[parentId].childIds.includes(nodeId)) {
                  tree.nodes[parentId].childIds.push(nodeId);
                }
              } else if (parentId && !tree.nodes[parentId]) {
                // 幽灵父节点：WS断连导致父节点事件丢失，自动创建以保持树完整性
                const ghostParts = parentId.split('::');
                const ghostAgentType = ghostParts[0];
                const ghostTaskDesc = ghostParts.length > 2 ? ghostParts.slice(1, -1).join('::') : parentId;
                const ghostNode: ProgressNode = {
                  id: parentId,
                  agentType: ghostAgentType,
                  taskDescription: ghostTaskDesc,
                  displayDescription: translateTaskDescription(ghostAgentType, ghostTaskDesc),
                  parentId: null,
                  childIds: [nodeId],
                  status: 'running',
                  fatal: false,
                  currentPhase: null,
                  logs: [],
                  startedAt: event.timestamp,
                  endedAt: null,
                  latestDetail: null,
                };
                tree.nodes[parentId] = ghostNode;
                if (!tree.rootIds.includes(parentId)) {
                  tree.rootIds.push(parentId);
                }
              } else {
                if (!tree.rootIds.includes(nodeId)) {
                  tree.rootIds.push(nodeId);
                }
              }

              if (!tree.activeNodeIds.includes(nodeId)) {
                tree.activeNodeIds.push(nodeId);
              }

              if (treeType === 'init') {
                state.initState = 'progressing';
              }
            } else if (event.phase === 'task_end') {
              const node = tree.nodes[nodeId];
              if (!node) return;

              const detail = event.detail as TaskEndDetail | undefined;
              node.status = detail?.success ? 'done' : 'failed';
              node.fatal = detail?.fatal ?? false;
              node.currentPhase = 'task_end';
              node.endedAt = event.timestamp;
              node.latestDetail = event.detail ?? null;
              node.logs.push({ phase: 'task_end', detail: event.detail, timestamp: event.timestamp });
              if (treeType === 'init' && node.logs.length > 3) {
                node.logs = node.logs.slice(-3);
              }

              tree.activeNodeIds = tree.activeNodeIds.filter(id => id !== nodeId);

              if (treeType === 'init' && !detail?.success && detail?.fatal) {
                state.initFatalError = detail?.summary || '初始化失败';
              }
            } else if (event.phase === 'error') {
              const node = tree.nodes[nodeId];
              if (!node) return;

              const errorDetail = event.detail as ErrorDetail | undefined;
              node.currentPhase = 'error';
              node.latestDetail = event.detail ?? null;
              node.logs.push({ phase: 'error', detail: event.detail, timestamp: event.timestamp });
              if (treeType === 'init' && node.logs.length > 3) {
                node.logs = node.logs.slice(-3);
              }

              if (errorDetail?.recoverable === false) {
                node.status = 'failed';
                node.fatal = true;
                node.endedAt = event.timestamp;
                tree.activeNodeIds = tree.activeNodeIds.filter(id => id !== nodeId);
                if (treeType === 'init') {
                  state.initFatalError = errorDetail.error || '初始化失败';
                }
              }
            } else {
              // tool_call/tool_result/thinking/iteration/sub_agent_start/sub_agent_end
              let node = tree.nodes[nodeId];
              if (!node) {
                // 幽灵节点：WS断连导致 task_start 丢失，自动创建节点保持树完整性
                const displayDescription = translateTaskDescription(event.agentType, event.taskDescription);
                node = {
                  id: nodeId,
                  agentType: event.agentType,
                  taskDescription: event.taskDescription,
                  displayDescription,
                  parentId,
                  childIds: [],
                  status: 'running',
                  fatal: false,
                  currentPhase: event.phase,
                  logs: [],
                  startedAt: event.timestamp,
                  endedAt: null,
                  latestDetail: event.detail ?? null,
                };
                tree.nodes[nodeId] = node;
                if (parentId && tree.nodes[parentId]) {
                  if (!tree.nodes[parentId].childIds.includes(nodeId)) {
                    tree.nodes[parentId].childIds.push(nodeId);
                  }
                } else if (!tree.rootIds.includes(nodeId)) {
                  tree.rootIds.push(nodeId);
                }
                if (!tree.activeNodeIds.includes(nodeId)) {
                  tree.activeNodeIds.push(nodeId);
                }
              }

              node.currentPhase = event.phase;
              node.latestDetail = event.detail ?? null;
              if (treeType === 'init') {
                node.logs.push({ phase: event.phase, detail: event.detail, timestamp: event.timestamp });
                if (node.logs.length > 3) {
                  node.logs = node.logs.slice(-3);
                }
              }
            }
          });
        },

        startChatTreeFadeOut: () => {
          if (_chatTreeFadeTimer) {
            clearTimeout(_chatTreeFadeTimer);
          }
          // 2秒后开始淡出（设fadingOut=true，触发CSS transition）
          _chatTreeFadeTimer = setTimeout(() => {
            set((state) => {
              if (state.chatProgressTree) {
                state.chatProgressTree.fadingOut = true;
              }
            });
            // 0.5秒CSS transition完成后清空树
            _chatTreeFadeTimer = setTimeout(() => {
              set((state) => {
                state.chatProgressTree = null;
              });
              _chatTreeFadeTimer = null;
            }, 500);
          }, 2000);
        },

        syncAgentStore: (event) => {
          const agentStore = useAgentStore.getState();
          switch (event.phase) {
            case 'task_start':
              if (!agentStore.activeChainId) agentStore.startChain();
              break;
            case 'thinking':
              if (!agentStore.activeChainId) agentStore.startChain();
              agentStore.addStep({ phase: 'thinking', agentName: event.agentType, thought: (event.detail as ThinkingDetail)?.thought, timestamp: Date.now() });
              break;
            case 'tool_call':
              agentStore.addStep({ phase: 'tool_call', agentName: event.agentType, toolName: (event.detail as ToolCallDetail)?.toolName, timestamp: Date.now() });
              break;
            case 'tool_result':
              agentStore.addStep({ phase: 'observation', agentName: event.agentType, toolName: (event.detail as ToolResultDetail)?.toolName, timestamp: Date.now() });
              break;
            case 'task_end': {
              const detail = event.detail as TaskEndDetail | undefined;
              if (detail?.success) {
                agentStore.addStep({ phase: 'final_answer', agentName: event.agentType, timestamp: Date.now() });
              } else {
                agentStore.addStep({ phase: 'error', agentName: event.agentType, error: detail?.summary, timestamp: Date.now() });
              }
              if (!event.parentTask) {
                agentStore.endChain({});
              }
              break;
            }
            case 'sub_agent_start':
              agentStore.addStep({ phase: 'thinking', agentName: (event.detail as SubAgentDetail)?.subAgentType || event.agentType, timestamp: Date.now() });
              break;
            case 'error':
              agentStore.addStep({ phase: 'error', agentName: event.agentType, error: (event.detail as ErrorDetail)?.error, timestamp: Date.now() });
              break;
            case 'iteration':
              break;
          }
        },
      })),
    { name: 'GameStore' }
  )
);
