import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ChallengeMode, FrontendCombatEnemy, FrontendCombatLog } from '@/types';
import { getCombatPanelConfig } from './CombatPanelRegistry';

type CombatEnemy = FrontendCombatEnemy;
type CombatLog = FrontendCombatLog;

interface CombatPanelProps {
  enemies: CombatEnemy[];
  playerHP: number;
  playerMaxHP: number;
  playerMP?: number;
  playerMaxMP?: number;
  currentTurn: number;
  isPlayerTurn: boolean;
  combatLog: CombatLog[];
  availableActions?: string[];
  onAction?: (action: string, targetId?: string) => void;
  onFlee?: () => void;
  className?: string;
  /**
   * 当前挑战模式（决定 UI 布局）
   * - turn_based_combat / dynamic_combat → 4 按钮组 + 完整数值
   * - narrative_combat → 隐藏按钮组 + 叙事日志
   * - null / undefined → 兼容旧存档，使用默认配置（4 按钮组）
   *
   * UI 布局由 CombatPanelRegistry 数据驱动，禁止在本组件内写 challengeMode 条件判断
   */
  challengeMode?: ChallengeMode | null;
}

const LOG_TYPE_COLORS: Record<string, string> = {
  damage: 'var(--error)',
  heal: 'var(--success)',
  buff: 'var(--accent)',
  debuff: 'var(--warning)',
  info: 'var(--text-muted)',
};

const EnemyCard = memo(function EnemyCard({
  enemy,
  isSelected,
  onSelect,
  hideStats,
}: {
  enemy: CombatEnemy;
  isSelected: boolean;
  onSelect: () => void;
  hideStats: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all duration-200 cursor-pointer',
        'bg-[var(--bg-secondary)] min-w-[120px] flex-shrink-0',
        isSelected
          ? 'border-[var(--accent)] shadow-[var(--glow-accent)]'
          : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]',
      )}
    >
      <Avatar
        name={enemy.name}
        size="md"
        color={isSelected ? 'var(--accent)' : 'var(--bg-card)'}
        className={isSelected ? '' : 'text-[var(--text-secondary)] border border-[var(--border-primary)]'}
      />

      <span className={cn(
        'text-sm font-medium truncate max-w-full',
        isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]',
      )}>
        {enemy.name}
        {enemy.level != null && (
          <span className="text-xs text-[var(--text-muted)] ml-1">Lv.{enemy.level}</span>
        )}
      </span>

      {!hideStats && (
        <div className="w-full space-y-1.5">
          <Progress variant="health" value={enemy.hp} max={enemy.maxHP} size="sm" showLabel label="HP" />
          {enemy.maxMP != null && enemy.maxMP > 0 && (
            <Progress variant="mana" value={enemy.mp ?? 0} max={enemy.maxMP} size="sm" showLabel label="MP" />
          )}
        </div>
      )}

      {enemy.status && enemy.status.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center">
          {enemy.status.map((s) => (
            <Badge key={s} variant="warning" size="sm">{s}</Badge>
          ))}
        </div>
      )}
    </button>
  );
});

export const CombatPanel = memo(function CombatPanel({
  enemies,
  playerHP,
  playerMaxHP,
  playerMP,
  playerMaxMP,
  currentTurn,
  isPlayerTurn,
  combatLog,
  availableActions,
  onAction,
  onFlee,
  className,
  challengeMode,
}: CombatPanelProps) {
  const { t } = useTranslation('game');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // 从注册表派生 UI 配置（D5 方案 B 数据驱动，禁止在本组件内写 challengeMode 条件判断）
  const config = getCombatPanelConfig(challengeMode);
  const {
    actions,
    showPlayerStats,
    showEnemyStats,
    showTurnIndicator,
    showSimultaneousBadge,
    showNarrativeBadge,
    showNarrativeHint,
    combatLogMaxHeight,
    simultaneousAction,
  } = config;

  // 动态战斗双方同时行动，始终视为玩家回合可操作
  const effectiveIsPlayerTurn = simultaneousAction ? true : isPlayerTurn;

  // 按钮组是否显示：actions 为空数组时隐藏
  const showActionButtons = actions.length > 0;

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [combatLog]);

  useEffect(() => {
    const aliveEnemy = enemies.find((e) => e.hp > 0);
    if (aliveEnemy && (!selectedTargetId || !enemies.find((e) => e.id === selectedTargetId && e.hp > 0))) {
      setSelectedTargetId(aliveEnemy.id);
    }
  }, [enemies, selectedTargetId]);

  const handleTargetSelect = useCallback((enemyId: string) => {
    setSelectedTargetId(enemyId);
  }, []);

  const handleAction = useCallback((actionKey: string) => {
    if (!effectiveIsPlayerTurn) return;

    if (actionKey === 'flee') {
      onFlee?.();
      return;
    }

    onAction?.(actionKey, selectedTargetId ?? undefined);
  }, [effectiveIsPlayerTurn, onAction, onFlee, selectedTargetId]);

  const isActionEnabled = (key: string): boolean => {
    if (!effectiveIsPlayerTurn) return false;
    if (availableActions && availableActions.length > 0 && !availableActions.includes(key)) return false;
    if (key !== 'flee' && !selectedTargetId) return false;
    return true;
  };

  return (
    <Card variant="default" padding="md" className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('combat.turn')} {currentTurn}
          </span>
          {showTurnIndicator && (
            <Badge customColor={effectiveIsPlayerTurn ? 'var(--accent)' : 'var(--error)'}>
              {effectiveIsPlayerTurn ? t('combat.yourTurn') : t('combat.enemyTurn')}
            </Badge>
          )}
          {showNarrativeBadge && (
            <Badge customColor="var(--accent)">
              <BookOpenIcon className="mr-1 h-3 w-3" />
              {t('combat.mode.narrative', '叙事战斗')}
            </Badge>
          )}
          {showSimultaneousBadge && (
            <Badge customColor="var(--warning)">
              {t('combat.mode.simultaneousAttack', '同时攻击')}
            </Badge>
          )}
        </div>
      </div>

      {showNarrativeHint && (
        <div className="rounded-md bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--text-secondary)]">
          {t('combat.mode.narrativeHint', '叙事战斗模式 - 通过对话框描述你的动作')}
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
        {enemies.map((enemy) => (
          <EnemyCard
            key={enemy.id}
            enemy={enemy}
            isSelected={selectedTargetId === enemy.id}
            onSelect={() => handleTargetSelect(enemy.id)}
            hideStats={!showEnemyStats}
          />
        ))}
        {enemies.length === 0 && (
          <div className="flex items-center justify-center w-full py-6 text-sm text-[var(--text-muted)]">
            {t('combat.noEnemies')}
          </div>
        )}
      </div>

      <div
        ref={logContainerRef}
        className={cn(
          'overflow-y-auto rounded-lg bg-[var(--bg-secondary)] p-2.5 scrollbar-thin',
          combatLogMaxHeight,
        )}
      >
        {combatLog.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)] text-center py-2">
            {t('combat.battleStart')}
          </div>
        ) : (
          <div className="space-y-1">
            {combatLog.map((log, index) => (
              <div
                key={`${log.turn}-${index}`}
                className="flex gap-2 text-xs leading-relaxed"
              >
                <span className="shrink-0 font-mono text-[var(--text-muted)] opacity-60">
                  [{log.turn}]
                </span>
                <span style={{ color: log.type ? LOG_TYPE_COLORS[log.type] : 'var(--text-secondary)' }}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPlayerStats && (
        <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
          <div className="space-y-2">
            <Progress variant="health" value={playerHP} max={playerMaxHP} size="sm" showLabel label="HP" />
            {playerMaxMP != null && playerMaxMP > 0 && (
              <Progress variant="mana" value={playerMP ?? 0} max={playerMaxMP} size="sm" showLabel label="MP" />
            )}
          </div>
        </div>
      )}

      {showActionButtons && (
        <div className="grid grid-cols-2 gap-2">
          {actions.map(({ key, labelKey, icon: Icon }) => {
            const enabled = isActionEnabled(key);

            return (
              <Button
                key={key}
                variant="secondary"
                size="md"
                disabled={!enabled}
                icon={<Icon className="h-4 w-4" />}
                onClick={() => handleAction(key)}
              >
                {t(labelKey)}
              </Button>
            );
          })}
        </div>
      )}
    </Card>
  );
});
