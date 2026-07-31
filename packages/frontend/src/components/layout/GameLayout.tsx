import { type CSSProperties, type ReactNode, useRef, useCallback, useState, useMemo, lazy, Suspense } from 'react';
import {
  UserIcon,
  SparklesIcon,
  ShieldCheckIcon,
  CubeIcon,
  MapIcon,
  ClipboardDocumentListIcon,
  UsersIcon,
  DocumentTextIcon,
  FireIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommandLineIcon,
  ArrowsPointingOutIcon,
} from '@heroicons/react/24/outline';
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useGameStore } from '@/stores/gameStore';
import { useCombatStore } from '@/stores/combatStore';
import { useMapStore } from '@/stores/mapStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useInteractionHandler } from '@/hooks/useInteractionHandler';
import { cn } from '@/utils/cn';
import type { PanelType, FrontendInventoryItem, Quest } from '@/types';
import { CharacterStatusCard } from '@/components/game/CharacterStatusCard';
import { MiniMapFlow } from '@/components/game/mini-map-flow/MiniMapFlow';
import { NPCCompactList } from '@/components/game/NPCCompactList';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ReactFlowProvider } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

const LazyInventoryPanel = lazy(() => import('@/components/game/InventoryPanel').then((m) => ({ default: m.InventoryPanel })));
const LazyEquipmentPanel = lazy(() => import('@/components/game/EquipmentPanel').then((m) => ({ default: m.EquipmentPanel })));
const LazyCombatPanel = lazy(() => import('@/components/game/CombatPanel').then((m) => ({ default: m.CombatPanel })));
const LazyQuestPanel = lazy(() => import('@/components/game/QuestPanel').then((m) => ({ default: m.QuestPanel })));
const LazyMapPanel = lazy(() => import('@/components/game/MapPanel').then((m) => ({ default: m.MapPanel })));
const LazySkillPanel = lazy(() => import('@/components/game/SkillPanel').then((m) => ({ default: m.SkillPanel })));
const LazyNPCPanel = lazy(() => import('@/components/game/NPCPanel').then((m) => ({ default: m.NPCPanel })));
const LazyLogPanel = lazy(() => import('@/components/game/LogPanel').then((m) => ({ default: m.LogPanel })));
const LazyDevToolsPanel = lazy(() => import('@/components/game/DevToolsPanel').then((m) => ({ default: m.DevToolsPanel })));

const PanelLoader = () => (
  <div className="flex h-full items-center justify-center">
    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
  </div>
);

const baseBottomTabs: { type: PanelType; label: string; icon: React.ForwardRefExoticComponent<React.SVGProps<SVGSVGElement> & { title?: string; titleId?: string }> }[] = [
  { type: 'character', label: '角色', icon: UserIcon },
  { type: 'skills', label: '技能', icon: SparklesIcon },
  { type: 'equipment', label: '装备', icon: ShieldCheckIcon },
  { type: 'inventory', label: '背包', icon: CubeIcon },
  { type: 'quests', label: '任务', icon: ClipboardDocumentListIcon },
  { type: 'npc', label: 'NPC', icon: UsersIcon },
  { type: 'log', label: '记录', icon: DocumentTextIcon },
  { type: 'map', label: '地图', icon: MapIcon },
];

const partyTab: { type: PanelType; label: string; icon: React.ForwardRefExoticComponent<React.SVGProps<SVGSVGElement> & { title?: string; titleId?: string }> } = {
  type: 'party',
  label: '队伍',
  icon: UsersIcon,
};

const devtoolsTab: { type: PanelType; label: string; icon: React.ForwardRefExoticComponent<React.SVGProps<SVGSVGElement> & { title?: string; titleId?: string }> } = {
  type: 'devtools',
  label: 'DevTools',
  icon: CommandLineIcon,
};

interface GameLayoutProps {
  children?: ReactNode;
}

function mapInventoryItem(item: FrontendInventoryItem) {
  return item;
}

function mapQuest(q: Quest) {
  return q;
}

export type MinimapPosition = 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right';
export type MinimapSize = 'small' | 'medium' | 'large';

export function normalizeMinimapPosition(position?: string): MinimapPosition {
  switch (position) {
    case 'bottom-left':
    case 'top-right':
    case 'bottom-right':
      return position;
    case 'top-left':
    default:
      return 'top-left';
  }
}

export function normalizeMinimapSize(size?: string): MinimapSize {
  switch (size) {
    case 'small':
    case 'large':
      return size;
    case 'medium':
    default:
      return 'medium';
  }
}

export function getMinimapMetrics(mode: 'left' | 'floating', size: MinimapSize): CSSProperties {
  if (mode === 'left') {
    return {
      height: size === 'small' ? 160 : size === 'large' ? 240 : 200,
    };
  }

  if (size === 'small') {
    return { width: 288, height: 208 };
  }
  if (size === 'large') {
    return { width: 384, height: 280 };
  }
  return { width: 336, height: 240 };
}

export function getFloatingMinimapPositionClass(position: MinimapPosition): string {
  return position === 'bottom-right' ? 'bottom-2 right-2' : 'top-2 right-2';
}

export function GameLayout({ children }: GameLayoutProps) {
  const { t } = useTranslation('game');
  const activeRightPanel = useUIStore((s) => s.activeRightPanel);
  const setActiveRightPanel = useUIStore((s) => s.setActiveRightPanel);

  const player = useGameStore((s) => s.player);
  const inventory = useGameStore((s) => s.inventory);
  const combat = useCombatStore((s) => s.combat);
  const quests = useGameStore((s) => s.quests);
  const mapState = useMapStore((s) => s.mapState);
  const skills = useGameStore((s) => s.skills);
  const npcInfoList = useGameStore((s) => s.npcInfoList);
  const logs = useGameStore((s) => s.logs);
  const storyHistory = useGameStore((s) => s.storyHistory);
  const storyHistoryPagination = useGameStore((s) => s.storyHistoryPagination);
  const isStoryHistoryLoading = useGameStore((s) => s.isStoryHistoryLoading);
  const fetchStoryHistory = useGameStore((s) => s.fetchStoryHistory);
  const combatAction = useGameStore((s) => s.combatAction);
  const equipmentSlotDefs = useGameStore((s) => s.equipmentSlotDefs);
  const numericalComplexity = useGameStore((s) => s.numericalComplexity);
  const targetNpcIds = useGameStore((s) => s.targetNpcIds);
  const toggleTargetNpc = useGameStore((s) => s.toggleTargetNpc);
  const specialRules = useGameStore((s) => s.specialRules);
  const { sendInteraction } = useInteractionHandler();

  const uiLayout = useGameStore((s) => s.uiLayout);

  const isPartyInLeftPanel = uiLayout?.party_panel_position !== 'right';
  const minimapPosition = normalizeMinimapPosition(uiLayout?.minimap_position);
  const minimapSize = normalizeMinimapSize(uiLayout?.minimap_size);
  const isMinimapInLeftPanel = minimapPosition === 'top-left' || minimapPosition === 'bottom-left';
  const isFloatingMinimap = minimapPosition === 'top-right' || minimapPosition === 'bottom-right';

  const handleSkillUse = useCallback(
    (skillId: string) => {
      const skill = skills.find(s => s.id === skillId);
      sendInteraction({
        interactionType: 'use_skill',
        target: skillId,
        params: { skillName: skill?.name },
      });
    },
    [sendInteraction, skills]
  );

  const handleItemUse = useCallback(
    (itemId: string) => sendInteraction({ interactionType: 'use_item', target: itemId }),
    [sendInteraction]
  );

  const handleItemEquip = useCallback(
    (itemId: string) => sendInteraction({ interactionType: 'equip_item', target: itemId }),
    [sendInteraction]
  );

  const handleItemDrop = useCallback(
    (itemId: string) => sendInteraction({ interactionType: 'drop_item', target: itemId }),
    [sendInteraction]
  );

  const handleUnequip = useCallback(
    (itemId: string) => sendInteraction({ interactionType: 'unequip_item', target: itemId }),
    [sendInteraction]
  );

  const handleQuestAccept = useCallback(
    (questId: string) => sendInteraction({ interactionType: 'accept_quest', target: questId }),
    [sendInteraction]
  );

  const handleQuestAbandon = useCallback(
    (questId: string) => sendInteraction({ interactionType: 'abandon_quest', target: questId }),
    [sendInteraction]
  );

  const handleTravel = useCallback(
    (locationId: string, locationName?: string) => {
      setTravelConfirm({ locationId, locationName: locationName ?? '' });
    },
    [],
  );

  const executeTravel = useCallback(
    (locationId: string, locationName?: string) => {
      setTravelConfirm(null);
      sendInteraction({ interactionType: 'travel', target: locationId, params: { displayName: locationName } });
    },
    [sendInteraction],
  );

  const extractDisplayName = useCallback((id: string): string => {
    const parts = id.split('_');
    if (parts.length >= 3 && (parts[0] === 'loc' || parts[0] === 'npc')) {
      return parts.slice(1, -1).join('_');
    }
    return id.replace(/[-_]/g, ' ');
  }, []);

  const handleClearLogs = useCallback(() => useGameStore.getState().clearLogs(), []);

  const handleStoryHistoryPageChange = useCallback(
    (page: number) => fetchStoryHistory({ page }),
    [fetchStoryHistory],
  );

  const mappedInventoryItems = useMemo(() => inventory.map(mapInventoryItem), [inventory]);
  const mappedQuests = useMemo(() => quests.map(mapQuest), [quests]);
  const mappedSkills = useMemo(
    () => skills.map((s) => ({
      ...s,
      type: (['attack', 'defense', 'healing', 'buff', 'debuff', 'utility', 'passive'].includes(s.type)
        ? s.type
        : 'utility') as 'attack' | 'defense' | 'healing' | 'buff' | 'debuff' | 'utility' | 'passive',
    })),
    [skills]
  );

  const developerMode = useSettingsStore((s) => s.developerMode);

  const bottomTabs = useMemo(() => {
    const tabs = [...baseBottomTabs];
    if (!uiLayout?.show_party_panel || isPartyInLeftPanel) {
      // keep base tabs
    } else {
      const npcIndex = tabs.findIndex((t) => t.type === 'npc');
      if (npcIndex >= 0) {
        tabs.splice(npcIndex + 1, 0, partyTab);
      } else {
        tabs.push(partyTab);
      }
    }
    if (developerMode) {
      tabs.push(devtoolsTab);
    }
    return tabs;
  }, [uiLayout?.show_party_panel, isPartyInLeftPanel, developerMode]);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [travelConfirm, setTravelConfirm] = useState<{ locationId: string; locationName: string } | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);

  const npcsAtCurrentLocation = useMemo(() => {
    if (!mapState.currentLocationId) return [];
    return npcInfoList.filter((n) => n.locationId === mapState.currentLocationId);
  }, [npcInfoList, mapState.currentLocationId]);

  const handleCombatAction = useCallback(
    async (action: string, targetId?: string) => {
      await combatAction(action, targetId);
    },
    [combatAction]
  );

  const handleCombatFlee = useCallback(
    async () => {
      await combatAction('flee');
    },
    [combatAction]
  );

  const handleBottomTabClick = useCallback(
    (type: PanelType) => {
      setActiveRightPanel(type);
      if (rightCollapsed) {
        // 延迟到下一帧展开面板，确保 react-resizable-panels 内部状态已更新
        requestAnimationFrame(() => {
          rightPanelRef.current?.expand();
        });
        setRightCollapsed(false);
      }
    },
    [setActiveRightPanel, rightCollapsed]
  );

  const renderMiniMapCard = useCallback(
    (mode: 'left' | 'floating') => (
      <div
        data-minimap-mode={mode}
        data-minimap-position={minimapPosition}
        data-minimap-size={minimapSize}
        className={cn(
          'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2.5',
          mode === 'floating' && 'bg-[var(--bg-card)]/95 shadow-lg backdrop-blur-sm',
        )}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MapIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="text-xs font-medium text-[var(--text-secondary)]">{t('map.currentPosition')}</span>
          </div>
          {mapState.currentLocationId && (
            <button
              onClick={() => setMapExpanded(true)}
              className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
              title={t('map.expandMap')}
            >
              <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {mapState.currentLocationId ? (
          <>
            <p className="mb-2 text-xs text-[var(--text-primary)]">
              {(() => {
                const currentLoc = mapState.locations.find((l) => l.id === mapState.currentLocationId);
                if (!currentLoc) return extractDisplayName(mapState.currentLocationId!);
                const parentLoc = currentLoc.parentLocationId
                  ? mapState.locations.find((l) => l.id === currentLoc.parentLocationId)
                  : null;
                return parentLoc ? `${parentLoc.name} - ${currentLoc.name}` : currentLoc.name;
              })()}
            </p>
            <div
              className="overflow-hidden rounded-lg border border-[var(--border-primary)]"
              style={getMinimapMetrics(mode, minimapSize)}
            >
              <ReactFlowProvider>
                <MiniMapFlow onTravel={handleTravel} />
              </ReactFlowProvider>
            </div>
            <NPCCompactList
              npcs={npcsAtCurrentLocation}
              targetNpcIds={targetNpcIds}
              onToggleTargetNpc={toggleTargetNpc}
              title={t('map.npcsHere')}
            />
          </>
        ) : (
          <>
            <div
              className="mb-2 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]/40"
              style={getMinimapMetrics(mode, minimapSize)}
            />
            <p className="text-xs text-[var(--text-muted)] italic">{t('map.noLocation')}</p>
          </>
        )}
      </div>
    ),
    [
      extractDisplayName,
      handleTravel,
      mapState.currentLocationId,
      mapState.locations,
      minimapPosition,
      minimapSize,
      npcsAtCurrentLocation,
      t,
      targetNpcIds,
      toggleTargetNpc,
    ],
  );

  const renderRightPanelContent = () => {
    switch (activeRightPanel) {
      case 'character':
        if (!player) return <EmptyPanel text="暂无角色信息" />;
        return (
          <CharacterStatusCard
            name={player.name}
            level={player.level}
            gender={player.gender}
            customGender={player.customGender}
            race={player.race}
            raceName={player.raceName}
            classType={player.class}
            classDisplayName={player.className}
            currentHP={player.currentHP}
            maxHP={player.maxHP}
            currentMP={player.currentMP}
            maxMP={player.maxMP}
            currentEXP={player.experience}
            maxEXP={player.level * 1000}
            gold={player.gold}
            attributes={player.attributes as unknown as Record<string, number>}
            attributeNames={player.attributeNames}
            derivedAttributes={player.derivedAttributes as unknown as Record<string, number> | undefined}
            numericalComplexity={numericalComplexity ?? undefined}
            statusEffects={player.statusEffects}
            defaultDerivedExpanded={true}
          />
        );

      case 'skills':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazySkillPanel
              skills={mappedSkills}
              onSkillUse={handleSkillUse}
            />
          </Suspense>
        );

      case 'equipment':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyEquipmentPanel
              equippedItems={inventory}
              onUnequip={handleUnequip}
              equipmentSlotDefs={equipmentSlotDefs ?? undefined}
            />
          </Suspense>
        );

      case 'inventory':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyInventoryPanel
              items={mappedInventoryItems}
              gold={player?.gold}
              maxSlots={30}
              onItemUse={handleItemUse}
              onItemEquip={handleItemEquip}
              onItemDrop={handleItemDrop}
            />
          </Suspense>
        );

      case 'quests':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyQuestPanel
              quests={mappedQuests}
              npcInfoList={npcInfoList}
              onQuestAccept={handleQuestAccept}
              onQuestAbandon={handleQuestAbandon}
            />
          </Suspense>
        );

      case 'npc':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyNPCPanel
              npcs={npcInfoList}
              targetNpcIds={targetNpcIds}
              onToggleTargetNpc={toggleTargetNpc}
              currentLocationId={mapState.currentLocationId ?? undefined}
            />
          </Suspense>
        );

      case 'party':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyNPCPanel
              npcs={npcInfoList}
              defaultTab="party"
              targetNpcIds={targetNpcIds}
              onToggleTargetNpc={toggleTargetNpc}
              currentLocationId={mapState.currentLocationId ?? undefined}
            />
          </Suspense>
        );

      case 'log':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyLogPanel
              logs={logs}
              storyHistory={storyHistory}
              storyHistoryPagination={storyHistoryPagination}
              isStoryHistoryLoading={isStoryHistoryLoading}
              onStoryHistoryPageChange={handleStoryHistoryPageChange}
              onClear={handleClearLogs}
            />
          </Suspense>
        );

      case 'devtools':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyDevToolsPanel />
          </Suspense>
        );

      case 'map':
        return (
          <Suspense fallback={<PanelLoader />}>
            <LazyMapPanel />
          </Suspense>
        );

      default:
        return <EmptyPanel text="选择一个面板" />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <div
            className={cn(
              'flex shrink-0 flex-col items-center gap-3 border-r border-[var(--border-primary)] bg-[var(--bg-card)] py-3 px-1.5 transition-all',
              leftCollapsed ? 'w-10' : 'hidden'
            )}
          >
            <button
              onClick={() => {
                leftPanelRef.current?.expand();
                setLeftCollapsed(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              title="展开左侧面板"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]">
              <MapIcon className="h-4 w-4" title="小地图" />
              <UsersIcon className="h-4 w-4" title="队伍" />
            </div>
          </div>

          <Panel
            id="left"
            defaultSize="18%"
            minSize="12%"
            maxSize="28%"
            collapsible
            panelRef={leftPanelRef}
            className="bg-[var(--bg-card)]"
            onResize={(size) => {
              const numSize = typeof size === 'string' ? parseFloat(size) : size;
              setLeftCollapsed(numSize === 0);
            }}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-[var(--text-muted)]">信息</span>
                  {specialRules && (
                    <div className="flex items-center gap-1">
                      {specialRules.permadeath && (
                        <span title="永久死亡模式：角色死亡不可复活" className="text-sm">💀</span>
                      )}
                      {specialRules.has_kp && (
                        <span title="KP模式：守密人主持游戏" className="text-sm">📖</span>
                      )}
                      {specialRules.save_restriction && specialRules.save_restriction !== 'free' && (
                        <span title={`存档限制：${specialRules.save_restriction === 'checkpoint_only' ? '仅检查点' : specialRules.save_restriction === 'manual_only' ? '仅手动' : specialRules.save_restriction === 'ironman' ? '铁人模式' : specialRules.save_restriction}`} className="text-sm">💾</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    leftPanelRef.current?.collapse();
                    setLeftCollapsed(true);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
                  title="折叠"
                >
                  <ChevronLeftIcon className="h-3 w-3" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
                {player && (
                  <CharacterStatusCard
                    name={player.name}
                    level={player.level}
                    gender={player.gender}
                    customGender={player.customGender}
                    race={player.race}
                    raceName={player.raceName}
                    classType={player.class}
                    classDisplayName={player.className}
                    currentHP={player.currentHP}
                    maxHP={player.maxHP}
                    currentMP={player.currentMP}
                    maxMP={player.maxMP}
                    currentEXP={player.experience}
                    maxEXP={player.level * 1000}
                    gold={player.gold}
                    attributes={player.attributes as unknown as Record<string, number>}
                    attributeNames={player.attributeNames}
                    derivedAttributes={player.derivedAttributes as unknown as Record<string, number> | undefined}
                    numericalComplexity={numericalComplexity ?? undefined}
                    statusEffects={player.statusEffects}
                  />
                )}

                {(uiLayout?.show_minimap ?? true) && isMinimapInLeftPanel && minimapPosition === 'top-left' && (
                  <div className="mt-2">
                    {renderMiniMapCard('left')}
                  </div>
                )}

                {(uiLayout?.show_party_panel ?? true) && isPartyInLeftPanel && npcInfoList.filter((n) => n.inParty).length > 0 && (
                  <div className="mt-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <UsersIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <span className="text-xs font-medium text-[var(--text-secondary)]">队伍</span>
                    </div>
                    <div className="space-y-1">
                      {npcInfoList
                        .filter((n) => n.inParty)
                        .map((n) => (
                          <div key={n.id} className="flex items-center gap-1.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] text-white">
                              {n.name[0]}
                            </div>
                            <span className="text-xs text-[var(--text-primary)]">{n.name}</span>
                            {n.role && (
                              <span className="text-[10px] text-[var(--text-muted)]">{n.role}</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {(uiLayout?.show_minimap ?? true) && isMinimapInLeftPanel && minimapPosition === 'bottom-left' && (
                  <div className="mt-2">
                    {renderMiniMapCard('left')}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Separator className="group relative flex w-px items-center justify-center bg-[var(--border-primary)] transition-colors hover:bg-[var(--accent)]">
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </Separator>

          <Panel id="center" minSize="30%" className="overflow-hidden bg-[var(--bg-primary)]">
            <section className="relative flex h-full flex-col overflow-hidden">
              {(uiLayout?.show_minimap ?? true) && isFloatingMinimap && (
                <div
                  className={cn(
                    'pointer-events-auto absolute z-10',
                    getFloatingMinimapPositionClass(minimapPosition),
                  )}
                >
                  {renderMiniMapCard('floating')}
                </div>
              )}
              {combat.active && (uiLayout?.show_combat_panel ?? true) && (
                <div className="absolute inset-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur-sm">
                  <Suspense fallback={<PanelLoader />}>
                    <LazyCombatPanel
                    enemies={combat.enemies}
                    playerHP={combat.playerHP}
                    playerMaxHP={combat.playerMaxHP}
                    playerMP={combat.playerMP}
                    playerMaxMP={combat.playerMaxMP}
                    currentTurn={combat.currentTurn}
                    isPlayerTurn={combat.isPlayerTurn}
                    combatLog={combat.log}
                    availableActions={combat.availableActions}
                    onAction={handleCombatAction}
                    onFlee={handleCombatFlee}
                    challengeMode={combat.challengeMode}
                    className="h-full"
                  />
                  </Suspense>
                </div>
              )}
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {children}
              </div>
            </section>
          </Panel>

          <Separator className="group relative flex w-px items-center justify-center bg-[var(--border-primary)] transition-colors hover:bg-[var(--accent)]">
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </Separator>

          <Panel
            id="right"
            defaultSize="22%"
            minSize="14%"
            maxSize="35%"
            collapsible
            panelRef={rightPanelRef}
            className="bg-[var(--bg-card)]"
            onResize={(size) => {
              const numSize = typeof size === 'string' ? parseFloat(size) : size;
              setRightCollapsed(numSize === 0);
            }}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <div className="flex items-center gap-1.5">
                  {activeRightPanel && getPanelIconNode(activeRightPanel)}
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {activeRightPanel ? getPanelLabel(activeRightPanel) : '面板'}
                  </span>
                </div>
                <button
                  onClick={() => {
                    rightPanelRef.current?.collapse();
                    setRightCollapsed(true);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
                  title="折叠"
                >
                  <ChevronRightIcon className="h-3 w-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
                {renderRightPanelContent()}
              </div>
            </div>
          </Panel>

          <div
            className={cn(
              'flex shrink-0 flex-col items-center gap-3 border-l border-[var(--border-primary)] bg-[var(--bg-card)] py-3 px-1.5 transition-all',
              rightCollapsed ? 'w-10' : 'hidden'
            )}
          >
            <button
              onClick={() => {
                rightPanelRef.current?.expand();
                setRightCollapsed(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              title="展开右侧面板"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]">
              {activeRightPanel && getPanelIconNode(activeRightPanel)}
            </div>
          </div>
        </Group>
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-1 border-t border-[var(--border-primary)] bg-[var(--bg-card)] px-2">
        {bottomTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeRightPanel === tab.type;
          return (
            <button
              key={tab.type}
              onClick={() => handleBottomTabClick(tab.type)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden lg:inline">{tab.label}</span>
            </button>
          );
        })}
        {combat.active && (
          <button
            onClick={() => setActiveRightPanel('combat')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ml-auto',
              activeRightPanel === 'combat'
                ? 'bg-red-500 text-white'
                : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
            )}
          >
            <FireIcon className="h-4 w-4" />
            <span>战斗</span>
          </button>
        )}
      </footer>

      {(uiLayout?.show_skill_bar ?? false) && (
        <div className="flex items-center gap-1 px-2 py-1 border-t border-[var(--border-primary)]">
          {Array.from({ length: uiLayout?.skill_bar_slots ?? 8 }, (_, i) => (
            <div key={i} className="w-10 h-10 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] flex items-center justify-center text-xs text-[var(--text-muted)]">
              {i + 1}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={travelConfirm !== null}
        onClose={() => setTravelConfirm(null)}
        title={t('map.confirmTravel')}
        description={travelConfirm ? t('map.confirmTravelTo', { name: travelConfirm.locationName || extractDisplayName(travelConfirm.locationId) }) : ''}
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setTravelConfirm(null)}>{t('map.cancel')}</Button>
            <Button variant="primary" size="sm" onClick={() => {
              if (travelConfirm) executeTravel(travelConfirm.locationId, travelConfirm.locationName);
            }}>{t('map.go')}</Button>
          </>
        }
      />

      <Modal
        open={mapExpanded}
        onClose={() => setMapExpanded(false)}
        title={mapState.currentLocationId
          ? (mapState.locations.find((l) => l.id === mapState.currentLocationId)?.name ?? extractDisplayName(mapState.currentLocationId))
          : t('map.currentPosition')}
        size="xl"
      >
        <div style={{ height: '50vh' }}>
          <ReactFlowProvider>
            <MiniMapFlow onTravel={(locationId, locationName) => {
              setMapExpanded(false);
              handleTravel(locationId, locationName);
            }} />
          </ReactFlowProvider>
        </div>
      </Modal>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-[var(--text-muted)]">{text}</p>
    </div>
  );
}

function getPanelLabel(panel: PanelType): string {
  const labels: Record<PanelType, string> = {
    character: '角色',
    skills: '技能',
    equipment: '装备',
    inventory: '背包',
    quests: '任务',
    npc: 'NPC',
    party: '队伍',
    log: '记录',
    map: '地图',
    combat: '战斗',
    devtools: 'DevTools',
  };
  return labels[panel] || panel;
}

function getPanelIconNode(panel: PanelType): React.ReactNode {
  const icons: Record<PanelType, React.ForwardRefExoticComponent<React.SVGProps<SVGSVGElement> & { title?: string; titleId?: string }>> = {
    character: UserIcon,
    skills: SparklesIcon,
    equipment: ShieldCheckIcon,
    inventory: CubeIcon,
    quests: ClipboardDocumentListIcon,
    npc: UsersIcon,
    party: UsersIcon,
    log: DocumentTextIcon,
    map: MapIcon,
    combat: FireIcon,
    devtools: CommandLineIcon,
  };
  const Icon = icons[panel];
  if (!Icon) return null;
  return <Icon className="h-4 w-4 text-[var(--accent)]" />;
}
