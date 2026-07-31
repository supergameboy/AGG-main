import { useState, useMemo, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LockClosedIcon, BoltIcon, ClockIcon, HeartIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Tabs } from '@/components/ui/Tabs';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';
import { resolveSkillDisplay } from '@/utils/customDataResolver';
import type { FrontendCharacterSkill, FrontendSkillType } from '@/types';

type SkillType = FrontendSkillType;
type CharacterSkill = FrontendCharacterSkill;

interface SkillPanelProps {
  skills: CharacterSkill[];
  onSkillUse?: (skillId: string) => void;
  onSkillDetail?: (skill: CharacterSkill) => void;
  className?: string;
}

type FilterKey = 'all' | SkillType;

const FILTER_KEYS: FilterKey[] = ['all', 'attack', 'defense', 'healing', 'buff', 'debuff', 'utility', 'passive'];

const TYPE_COLORS: Record<SkillType, string> = {
  attack: '#ef4444',
  defense: '#f59e0b',
  healing: '#22c55e',
  buff: '#3b82f6',
  debuff: '#a855f7',
  utility: '#06b6d4',
  passive: '#9ca3af',
};

export const SkillPanel = memo(function SkillPanel({
  skills,
  onSkillUse,
  onSkillDetail,
  className,
}: SkillPanelProps) {
  const { t } = useTranslation('game');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredSkills = useMemo(() => {
    if (activeFilter === 'all') return skills;
    return skills.filter((s) => s.type === activeFilter);
  }, [skills, activeFilter]);

  const virtualizer = useVirtualizer({
    count: filteredSkills.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 80,
  });

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Tabs
        tabs={FILTER_KEYS.map((key) => ({ id: key, label: t(`skills.filter.${key}`) }))}
        activeTab={activeFilter}
        onTabChange={(id) => setActiveFilter(id as FilterKey)}
        variant="pill"
        size="sm"
      />

      {filteredSkills.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
          {t('skills.noMatch')}
        </div>
      ) : (
        <div ref={parentRef} className="overflow-y-auto" style={{ height: '100%' }}>
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const skill = filteredSkills[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <SkillCard
                    skill={skill}
                    onUse={onSkillUse ? () => onSkillUse(skill.id) : undefined}
                    onDetail={onSkillDetail ? () => onSkillDetail(skill) : undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

const SkillCard = memo(function SkillCard({
  skill,
  onUse,
  onDetail,
}: {
  skill: CharacterSkill;
  onUse?: () => void;
  onDetail?: () => void;
}) {
  const { t } = useTranslation('game');
  const display = useMemo(() => resolveSkillDisplay(skill), [skill]);
  const typeColor = TYPE_COLORS[skill.type as SkillType] ?? TYPE_COLORS.attack;
  const levelText = skill.maxLevel ? `Lv.${skill.level}/${skill.maxLevel}` : `Lv.${skill.level}`;

  const badgeLabel = display.displayType !== skill.type
    ? display.displayType
    : t(`skills.type.${skill.type}`);

  const descriptionText = display.displayEffects ?? skill.description;

  return (
    <Card
      variant="default"
      padding="sm"
      className={cn(
        'flex flex-col gap-2',
        !skill.unlocked && 'opacity-40',
        skill.unlocked && 'hover:border-[var(--border-secondary)]'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar
            name={skill.unlocked ? skill.name : ' '}
            shape="square"
            color={typeColor}
          />
          {!skill.unlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <LockClosedIcon className="h-4 w-4 text-white" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Tooltip content={skill.name}>
              <span
                className={cn(
                  'text-sm font-semibold truncate',
                  skill.unlocked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                )}
              >
                {skill.name}
              </span>
            </Tooltip>
            <Badge customColor={typeColor} size="sm">
              {badgeLabel}
            </Badge>
            {display.displayElement && display.displayElement !== skill.element && (
              <Badge variant="default" size="sm">{display.displayElement}</Badge>
            )}
          </div>

          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono text-xs font-medium text-[var(--text-secondary)]">
              {levelText}
            </span>
            {Array.isArray(skill.cost) && skill.cost.length > 0 && skill.cost.some(c => c.amount > 0) && (
              <div className="flex items-center gap-1.5">
                {skill.cost.filter(c => c.amount > 0).map((c, i) => (
                  <div key={i} className="flex items-center gap-0.5">
                    {c.type === 'mp' && <BoltIcon className="h-3 w-3" style={{ color: 'var(--mana)' }} />}
                    {c.type === 'hp' && <HeartIcon className="h-3 w-3 text-red-400" />}
                    {c.type === 'stamina' && <span className="text-xs text-green-400">⚡</span>}
                    {c.type === 'currency' && <span className="text-xs text-yellow-400">💰</span>}
                    <span className={`font-mono text-xs ${c.type === 'mp' ? 'text-[var(--mana)]' : c.type === 'hp' ? 'text-red-400' : c.type === 'stamina' ? 'text-green-400' : 'text-yellow-400'}`}>{c.amount}{c.type === 'mp' ? '' : c.type === 'hp' ? 'HP' : c.type === 'stamina' ? '体力' : '金币'}</span>
                  </div>
                ))}
              </div>
            )}
            {skill.cooldown !== undefined && skill.cooldown > 0 && (
              <div className="flex items-center gap-1">
                <ClockIcon className="h-3 w-3 text-[var(--text-muted)]" />
                <span className="font-mono text-xs text-[var(--text-muted)]">{skill.cooldown}{t('skills.turns')}</span>
              </div>
            )}
            {display.classRequirement && display.classRequirement.length > 0 && (
              <span className="text-xs text-[var(--text-muted)]">
                {display.classRequirement.join('/')}
              </span>
            )}
            {display.levelRequirement !== undefined && (
              <span className="text-xs text-[var(--text-muted)]">
                {t('skills.requireLevel')}{display.levelRequirement}
              </span>
            )}
          </div>

          {descriptionText && (
            <Tooltip content={descriptionText} multiline>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2">
                {descriptionText}
              </p>
            </Tooltip>
          )}

          {display.tags && display.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {display.tags.map((tag) => (
                <Badge key={tag} variant="default" size="sm">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {skill.unlocked && (onUse || onDetail) && (
        <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[var(--border-primary)]">
          {onUse && (
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onUse();
              }}
            >
              {t('skills.use')}
            </Button>
          )}
          {onDetail && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDetail();
              }}
            >
              {t('skills.detail')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
});
