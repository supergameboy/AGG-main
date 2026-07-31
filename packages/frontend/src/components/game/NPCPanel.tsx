import { useState, useMemo, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MapPinIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { ShieldCheckIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { cn } from '@/utils/cn';
import { Tabs } from '@/components/ui/Tabs';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import { Tooltip } from '@/components/ui/Tooltip';
import { Modal } from '@/components/ui/Modal';
import { resolveNPCDisplay } from '@/utils/customDataResolver';
import type { FrontendNPCInfo, NPCGoal } from '@/types';
import { DRIVE_DIMENSIONS } from '@/utils/driveDimensions';

type NPCInfo = FrontendNPCInfo;

const GOAL_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'var(--success)', label: '进行中' },
  completed: { color: 'var(--info)', label: '已完成' },
  abandoned: { color: 'var(--text-muted)', label: '已放弃' },
  blocked: { color: 'var(--warning)', label: '受阻' },
  archived: { color: 'var(--text-muted)', label: '已归档' },
};

const GOAL_TYPE_LABELS: Record<string, string> = {
  long_term: '长期',
  mid_term: '中期',
};

function isAttrVisible(npc: NPCInfo): boolean {
  return npc.attrInitialized && npc.visibility?.attributes !== 'hidden';
}

function isAttrDetailed(npc: NPCInfo): boolean {
  return npc.attrInitialized && npc.visibility?.attributes === 'visible';
}

function isAttrVague(npc: NPCInfo): boolean {
  return npc.attrInitialized && npc.visibility?.attributes === 'vague';
}

function isHpMpVisible(npc: NPCInfo): boolean {
  return npc.attrInitialized && npc.visibility?.hpMp !== 'hidden';
}

function isHpMpDetailed(npc: NPCInfo): boolean {
  return npc.attrInitialized && npc.visibility?.hpMp === 'visible';
}

function isInvVisible(npc: NPCInfo): boolean {
  return npc.invInitialized && npc.visibility?.inventory !== 'hidden' && npc.visibility?.equipment !== 'hidden';
}

function isInvDetailed(npc: NPCInfo): boolean {
  return npc.invInitialized && (npc.visibility?.inventory === 'visible' || npc.visibility?.equipment === 'visible');
}

function isEquipOutline(npc: NPCInfo): boolean {
  return npc.invInitialized && npc.visibility?.equipment === 'outline';
}

function isSkillVisible(npc: NPCInfo): boolean {
  return npc.skillInitialized && npc.visibility?.skills !== 'hidden';
}

function isSkillDetailed(npc: NPCInfo): boolean {
  return npc.skillInitialized && npc.visibility?.skills === 'visible';
}

const ATTRIBUTE_RANGES: { max: number; label: string }[] = [
  { max: 5, label: '极弱' },
  { max: 8, label: '弱' },
  { max: 12, label: '中' },
  { max: 16, label: '强' },
  { max: Infinity, label: '极强' },
];

function getAttributeRange(value: number): string {
  for (const range of ATTRIBUTE_RANGES) {
    if (value <= range.max) return range.label;
  }
  return '极强';
}

interface NPCPanelProps {
  npcs: NPCInfo[];
  partyMembers?: NPCInfo[];
  defaultTab?: TabKey;
  onNPCDetail?: (npc: NPCInfo) => void;
  targetNpcIds?: string[];
  onToggleTargetNpc?: (npcId: string) => void;
  currentLocationId?: string;
  className?: string;
}

type TabKey = 'nearby' | 'party';

const MOOD_KEYS: { min: number; key: string }[] = [
  { min: 80, key: 'npc.mood.joyful' },
  { min: 60, key: 'npc.mood.friendly' },
  { min: 40, key: 'npc.mood.calm' },
  { min: 20, key: 'npc.mood.unhappy' },
  { min: 0, key: 'npc.mood.angry' },
];

function getMoodEmoji(mood: number | undefined): string {
  if (mood === undefined) return '';
  if (mood >= 80) return '😄';
  if (mood >= 60) return '🙂';
  if (mood >= 40) return '😐';
  if (mood >= 20) return '😟';
  return '😠';
}

function getMoodKey(mood: number | undefined): string {
  if (mood === undefined) return 'npc.mood.unknown';
  for (const { min, key } of MOOD_KEYS) {
    if (mood >= min) return key;
  }
  return 'npc.mood.angry';
}

const DISPOSITION_KEYS: Record<string, string> = {
  friendly: 'npc.disposition.friendly',
  neutral: 'npc.disposition.neutral',
  hostile: 'npc.disposition.hostile',
  cautious: 'npc.disposition.cautious',
  helpful: 'npc.disposition.helpful',
};

const DISPOSITION_COLORS: Record<string, string> = {
  friendly: 'var(--success)',
  neutral: 'var(--text-muted)',
  hostile: 'var(--error)',
  cautious: 'var(--warning)',
  helpful: 'var(--success)',
};

const NPCCard = memo(function NPCCard({
  npc,
  onDetail,
  isTargetNpc,
  onToggleTarget,
  isAtCurrentLocation,
}: {
  npc: NPCInfo;
  onDetail?: () => void;
  isTargetNpc?: boolean;
  onToggleTarget?: () => void;
  isAtCurrentLocation?: boolean;
}) {
  const { t } = useTranslation('game');
  const display = useMemo(() => resolveNPCDisplay(npc), [npc]);

  const attitudeColor =
    npc.affinity === undefined
      ? 'var(--text-muted)'
      : npc.affinity < 0
        ? 'var(--error)'
        : npc.affinity === 0
          ? 'var(--text-muted)'
          : 'var(--success)';

  const attributeEntries = isAttrDetailed(npc) && npc.attributes
    ? Object.entries(npc.attributes)
    : [];
  const visibleAttributes = attributeEntries.slice(0, 4);
  const hiddenAttributes = attributeEntries.slice(4);

  return (
    <Card variant="default" padding="sm" className="flex flex-col gap-2 transition-colors hover:border-[var(--border-secondary)]">
      <div className="flex items-start gap-3">
        <Avatar name={npc.name} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Tooltip content={npc.name}>
              <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {npc.name}
              </span>
            </Tooltip>
            {npc.title && (
              <span className="text-xs text-[var(--text-muted)] truncate">{npc.title}</span>
            )}
            {npc.role && typeof npc.role === 'string' && (
              <Badge variant="default" size="sm">{t(`npc.role.${npc.role}`) ?? npc.role}</Badge>
            )}
            {npc.inParty && (
              <Badge variant="primary" size="sm">{t('npc.inParty')}</Badge>
            )}
            {display.disposition && (
              <Badge
                customColor={DISPOSITION_COLORS[display.disposition] ?? 'var(--text-muted)'}
                size="sm"
              >
                {t(DISPOSITION_KEYS[display.disposition] ?? `npc.disposition.${display.disposition}`) ?? display.disposition}
              </Badge>
            )}
            {display.isStartingSceneNpc && (
              <Badge variant="info" size="sm">{t('npc.starting')}</Badge>
            )}
            {npc.mood !== undefined && (
              <Tooltip content={`${t('npc.mood.label')}: ${t(getMoodKey(npc.mood))} (${npc.mood})`}>
                <span className="text-xs">{getMoodEmoji(npc.mood)}</span>
              </Tooltip>
            )}
          </div>

          {npc.race && (
            <div className="text-xs text-[var(--text-muted)] mb-0.5">
              {t(`npc.race.${npc.race}`) ?? npc.race}
              {npc.level !== undefined && ` · Lv.${npc.level}`}
            </div>
          )}

          {npc.location && (
            <Tooltip content={npc.location}>
              <div className="flex items-center gap-1 mb-1">
                <MapPinIcon className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                <span className="text-xs text-[var(--text-muted)] truncate">{npc.location}</span>
              </div>
            </Tooltip>
          )}

          {npc.description && (
            <Tooltip content={npc.description} multiline>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2 italic mb-1.5">
                {npc.description}
              </p>
            </Tooltip>
          )}

          {npc.affinity !== undefined && (
            <div className="mb-1.5">
              <Progress
                value={Math.abs(npc.affinity)}
                max={100}
                variant={npc.affinity < 0 ? 'health' : 'default'}
                size="sm"
                showLabel
                label={t('npc.affinity')}
                labelRender={() => {
                  const att = npc.affinity!;
                  return (
                    <span
                      className="font-mono text-xs font-medium"
                      style={{ color: attitudeColor }}
                    >
                      {att > 0 ? '+' : ''}{att}
                    </span>
                  );
                }}
              />
            </div>
          )}

          {npc.services && npc.services.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {npc.services.map((service, i) => {
                const label = typeof service === 'string' ? service : service.name;
                const key = typeof service === 'string' ? `${service}-${i}` : `${service.type}-${service.name}`;
                return <Badge key={key} customColor="var(--accent)" size="sm">{label}</Badge>;
              })}
            </div>
          )}

          {!isAttrVisible(npc) && (
            <div className="flex flex-wrap gap-1.5 mb-1.5 text-xs text-[var(--text-muted)]">
              <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5">???</span>
            </div>
          )}
          {isAttrVisible(npc) && !isAttrDetailed(npc) && (
            <div className="flex flex-wrap gap-1.5 mb-1.5 text-xs text-[var(--text-muted)]">
              {isAttrVague(npc) && npc.attributes
                ? Object.entries(npc.attributes).map(([key, val]) => (
                  <span key={key} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 italic">
                    {t(`npc.attributes.${key}`) || key}: {getAttributeRange(Number(val))}
                  </span>
                ))
                : <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 italic">
                    {t('npc.attributesVague') ?? '属性模糊'}
                  </span>
              }
            </div>
          )}
          {visibleAttributes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5 text-xs text-[var(--text-muted)]">
              {visibleAttributes.map(([key, val]) => (
                <span key={key} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5">
                  {t(`npc.attributes.${key}`) || key}: {String(val)}
                </span>
              ))}
              {hiddenAttributes.length > 0 && (
                <Tooltip
                  multiline
                  content={
                    <div className="flex flex-col gap-0.5">
                      {hiddenAttributes.map(([key, val]) => (
                        <span key={key}>{t(`npc.attributes.${key}`) || key}: {String(val)}</span>
                      ))}
                    </div>
                  }
                >
                  <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 cursor-help">
                    +{hiddenAttributes.length}
                  </span>
                </Tooltip>
              )}
            </div>
          )}

          {isHpMpVisible(npc) && (npc.maxHp != null && npc.maxHp > 0) && (
            <div className="mb-1">
              <Progress
                value={npc.currentHp ?? 0}
                max={npc.maxHp}
                variant="health"
                size="sm"
                showLabel
                label="HP"
                labelRender={() => (
                  <span className="font-mono text-xs font-medium text-[var(--error)]">
                    {isHpMpDetailed(npc) ? `${npc.currentHp ?? 0}/${npc.maxHp}` : '???'}
                  </span>
                )}
              />
            </div>
          )}
          {isHpMpVisible(npc) && (npc.maxMp != null && npc.maxMp > 0) && (
            <div className="mb-1">
              <Progress
                value={npc.currentMp ?? 0}
                max={npc.maxMp}
                variant="default"
                size="sm"
                showLabel
                label="MP"
                labelRender={() => (
                  <span className="font-mono text-xs font-medium text-[var(--info)]">
                    {isHpMpDetailed(npc) ? `${npc.currentMp ?? 0}/${npc.maxMp}` : '???'}
                  </span>
                )}
              />
            </div>
          )}
          {!isHpMpVisible(npc) && (npc.maxHp != null || npc.maxMp != null) && (
            <div className="flex flex-wrap gap-1.5 mb-1.5 text-xs text-[var(--text-muted)]">
              <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5">HP/MP ???</span>
            </div>
          )}

          {npc.dialogue && (
            <Tooltip content={npc.dialogue} multiline>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2 italic">
                "{npc.dialogue}"
              </p>
            </Tooltip>
          )}
        </div>
      </div>

      {((!isAtCurrentLocation && onToggleTarget) || onDetail) && (
        <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[var(--border-primary)]">
          {!isAtCurrentLocation && onToggleTarget && (
            <Button
              variant={isTargetNpc ? 'primary' : 'outline'}
              size="sm"
              onClick={onToggleTarget}
            >
              {isTargetNpc ? t('npc.dialogTarget') : t('npc.setDialogTarget')}
            </Button>
          )}
          {onDetail && (
            <Button
              variant="outline"
              size="sm"
              hoverColor="var(--accent)"
              onClick={onDetail}
            >
              {t('npc.detail')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
});

function NPCDetailModal({ npc, open, onClose }: { npc: NPCInfo | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('game');
  const [goalsExpanded, setGoalsExpanded] = useState(true);
  const [driveExpanded, setDriveExpanded] = useState(true);
  const [vitalsExpanded, setVitalsExpanded] = useState(true);
  const [possessionsExpanded, setPossessionsExpanded] = useState(false);
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  if (!npc) return null;

  const display = resolveNPCDisplay(npc);
  const attributeEntries = isAttrDetailed(npc) && npc.attributes
    ? Object.entries(npc.attributes)
    : [];
  const activeGoals = npc.goals?.filter((g) => g.status === 'active') ?? [];
  const otherGoals = npc.goals?.filter((g) => g.status !== 'active') ?? [];
  const currencyEntries = npc.currency ? Object.entries(npc.currency).filter(([, v]) => v > 0) : [];
  const derivedEntries = isAttrDetailed(npc) && npc.derivedAttributes
    ? Object.entries(npc.derivedAttributes)
    : [];

  return (
    <Modal open={open} onClose={onClose} title={npc.name} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <Avatar name={npc.name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {npc.title && <span className="text-sm text-[var(--text-muted)]">{npc.title}</span>}
              {npc.role && <Badge variant="default" size="sm">{npc.role}</Badge>}
              {npc.inParty && <Badge variant="primary" size="sm">{t('npc.inParty')}</Badge>}
              {display.disposition && (
                <Badge
                  customColor={DISPOSITION_COLORS[display.disposition] ?? 'var(--text-muted)'}
                  size="sm"
                >
                  {t(DISPOSITION_KEYS[display.disposition] ?? `npc.disposition.${display.disposition}`) ?? display.disposition}
                </Badge>
              )}
              {display.isStartingSceneNpc && (
                <Badge variant="info" size="sm">{t('npc.starting')}</Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {npc.race && <span>{npc.race}</span>}
              {npc.level !== undefined && <span> · Lv.{npc.level}</span>}
              {npc.mood !== undefined && (
                <span> · {t('npc.mood.label')}: {getMoodEmoji(npc.mood)} {t(getMoodKey(npc.mood))} ({npc.mood})</span>
              )}
            </div>
            {npc.location && (
              <div className="flex items-center gap-1 mt-1">
                <MapPinIcon className="h-3 w-3 text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-muted)]">{npc.location}</span>
              </div>
            )}
          </div>
        </div>

        {npc.description && (
          <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
            <p className="text-sm text-[var(--text-primary)] leading-relaxed">{npc.description}</p>
          </div>
        )}

        {npc.affinity !== undefined && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-muted)]">{t('npc.affinity')}</span>
              <span className="text-xs font-medium" style={{ color: npc.affinity < 0 ? 'var(--error)' : 'var(--success)' }}>
                {npc.affinity > 0 ? '+' : ''}{npc.affinity}
              </span>
            </div>
            <Progress
              value={Math.abs(npc.affinity)}
              max={100}
              variant={npc.affinity < 0 ? 'health' : 'default'}
              size="sm"
            />
          </div>
        )}

        {(npc.maxHp != null || npc.maxMp != null) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setVitalsExpanded((v) => !v)}
            >
              {vitalsExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="text-xs font-medium text-[var(--text-primary)]">生命与法力</span>
            </div>
            {vitalsExpanded && (
              <div className="mt-2 space-y-2">
                {!isHpMpVisible(npc) && (
                  <span className="text-xs text-[var(--text-muted)]">???</span>
                )}
                {isHpMpVisible(npc) && (npc.maxHp != null && npc.maxHp > 0) && (
                  <Progress
                    value={npc.currentHp ?? 0}
                    max={npc.maxHp}
                    variant="health"
                    size="sm"
                    showLabel
                    label="HP"
                    labelRender={() => (
                      <span className="font-mono text-xs font-medium text-[var(--error)]">
                        {isHpMpDetailed(npc) ? `${npc.currentHp ?? 0}/${npc.maxHp}` : '???'}
                      </span>
                    )}
                  />
                )}
                {isHpMpVisible(npc) && (npc.maxMp != null && npc.maxMp > 0) && (
                  <Progress
                    value={npc.currentMp ?? 0}
                    max={npc.maxMp}
                    variant="default"
                    size="sm"
                    showLabel
                    label="MP"
                    labelRender={() => (
                      <span className="font-mono text-xs font-medium text-[var(--info)]">
                        {isHpMpDetailed(npc) ? `${npc.currentMp ?? 0}/${npc.maxMp}` : '???'}
                      </span>
                    )}
                  />
                )}
              </div>
            )}
          </Card>
        )}

        {!isAttrVisible(npc) && (
          <div>
            <span className="text-xs text-[var(--text-muted)] block mb-1.5">{t('npc.attributes')}</span>
            <span className="text-xs text-[var(--text-muted)]">???</span>
          </div>
        )}
        {isAttrVisible(npc) && !isAttrDetailed(npc) && (
          <div>
            <span className="text-xs text-[var(--text-muted)] block mb-1.5">{t('npc.attributes')}</span>
            {isAttrVague(npc) && npc.attributes ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(npc.attributes).map(([key, val]) => (
                  <span key={key} className="rounded bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)] italic">
                    {t(`npc.attributes.${key}`) || key}: {getAttributeRange(Number(val))}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[var(--text-muted)] italic">
                {t('npc.attributesVague') ?? '属性模糊'}
              </span>
            )}
          </div>
        )}
        {attributeEntries.length > 0 && (
          <div>
            <span className="text-xs text-[var(--text-muted)] block mb-1.5">{t('npc.attributes')}</span>
            <div className="flex flex-wrap gap-2">
              {attributeEntries.map(([key, val]) => (
                <span key={key} className="rounded bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                  {t(`npc.attributes.${key}`) || key}: {String(val)}
                </span>
              ))}
            </div>
          </div>
        )}

        {derivedEntries.length > 0 && (
          <div>
            <span className="text-xs text-[var(--text-muted)] block mb-1.5">派生属性</span>
            <div className="flex flex-wrap gap-2">
              {derivedEntries.map(([key, val]) => (
                <span key={key} className="rounded bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                  {t(`npc.attributes.${key}`) || key}: {typeof val === 'number' ? val : String(val)}
                </span>
              ))}
            </div>
          </div>
        )}

        {npc.driveProfile && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setDriveExpanded((v) => !v)}
            >
              {driveExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="text-xs font-medium text-[var(--text-primary)]">驱动力画像</span>
            </div>
            {driveExpanded && (
              <div className="mt-2 space-y-1.5">
                {DRIVE_DIMENSIONS.map(({ key, label, color }) => {
                  const value = npc.driveProfile![key];
                  if (value === undefined) return null;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)] w-10 shrink-0">{label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
                        />
                      </div>
                      <span className="text-xs font-mono text-[var(--text-secondary)] w-6 text-right">{value}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {npc.goals && npc.goals.length > 0 && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setGoalsExpanded((v) => !v)}
            >
              {goalsExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="text-xs font-medium text-[var(--text-primary)]">目标</span>
              <Badge size="sm" variant="info">{npc.goals.length}</Badge>
            </div>
            {goalsExpanded && (
              <div className="mt-2 space-y-2">
                {activeGoals.length > 0 && (
                  <div className="space-y-1.5">
                    {activeGoals.map((goal) => (
                      <GoalItem key={goal.id} goal={goal} />
                    ))}
                  </div>
                )}
                {otherGoals.length > 0 && (
                  <details className="group">
                    <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]">
                      非活跃目标 ({otherGoals.length})
                    </summary>
                    <div className="mt-1 space-y-1.5">
                      {otherGoals.map((goal) => (
                        <GoalItem key={goal.id} goal={goal} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </Card>
        )}

        {(currencyEntries.length > 0 || npc.services) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setPossessionsExpanded((v) => !v)}
            >
              {possessionsExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="text-xs font-medium text-[var(--text-primary)]">资产与服务</span>
            </div>
            {possessionsExpanded && (
              <div className="mt-2 space-y-2">
                {currencyEntries.length > 0 && (
                  <div>
                    <span className="text-xs text-[var(--text-muted)] block mb-1">货币</span>
                    <div className="flex flex-wrap gap-1.5">
                      {currencyEntries.map(([type, amount]) => (
                        <Badge key={type} customColor="var(--warning)" size="sm">
                          {type}: {amount}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {npc.services && npc.services.length > 0 && (
                  <div>
                    <span className="text-xs text-[var(--text-muted)] block mb-1">{t('npc.services')}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {npc.services.map((service, i) => {
                        const label = typeof service === 'string' ? service : service.name;
                        const key = typeof service === 'string' ? `${service}-${i}` : `${service.type}-${service.name}`;
                        return <Badge key={key} customColor="var(--accent)" size="sm">{label}</Badge>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {npc.inventory != null && !isInvVisible(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setInventoryExpanded((v) => !v)}
            >
              {inventoryExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <ShieldCheckIcon className="h-3 w-3 text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">物品与装备</span>
            </div>
            {inventoryExpanded && (
              <div className="mt-2">
                <span className="text-xs text-[var(--text-muted)]">???</span>
              </div>
            )}
          </Card>
        )}
        {npc.inventory != null && isInvVisible(npc) && !isInvDetailed(npc) && !isEquipOutline(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setInventoryExpanded((v) => !v)}
            >
              {inventoryExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <ShieldCheckIcon className="h-3 w-3 text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">物品与装备</span>
              {npc.visibility?.inventory === 'count_only' && npc.inventory.length > 0 && (
                <Badge size="sm" variant="info">{npc.inventory.length}</Badge>
              )}
            </div>
            {inventoryExpanded && (
              <div className="mt-2">
                <span className="text-xs text-[var(--text-muted)] italic">
                  {npc.visibility?.inventory === 'count_only'
                    ? `${npc.inventory.length} 件物品`
                    : '物品信息模糊'}
                </span>
              </div>
            )}
          </Card>
        )}
        {npc.inventory != null && isEquipOutline(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setInventoryExpanded((v) => !v)}
            >
              {inventoryExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <ShieldCheckIcon className="h-3 w-3 text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">物品与装备</span>
              {npc.inventory.length > 0 && (
                <Badge size="sm" variant="info">{npc.inventory.length}</Badge>
              )}
            </div>
            {inventoryExpanded && (
              <div className="mt-2 space-y-1">
                {npc.inventory.filter((i) => i.equipped).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {npc.inventory.filter((i) => i.equipped).map((item) => (
                      <Badge key={item.id} size="sm" variant="default">
                        {item.category || item.equippedSlot || '装备'}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-muted)] italic">装备轮廓不可见</span>
                )}
                {npc.visibility?.inventory === 'count_only' && npc.inventory.length > 0 && (
                  <span className="text-xs text-[var(--text-muted)]">背包: {npc.inventory.length} 件物品</span>
                )}
              </div>
            )}
          </Card>
        )}
        {npc.inventory != null && isInvDetailed(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setInventoryExpanded((v) => !v)}
            >
              {inventoryExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <ShieldCheckIcon className="h-3 w-3 text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">物品与装备</span>
              {npc.inventory.length > 0 && (
                <Badge size="sm" variant="info">{npc.inventory.length}</Badge>
              )}
            </div>
            {inventoryExpanded && (
              <div className="mt-2 space-y-1.5">
                {npc.inventory.length === 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">暂无物品</span>
                ) : (() => {
                  const equipped = npc.inventory!.filter((i) => i.equipped);
                  const unequipped = npc.inventory!.filter((i) => !i.equipped);
                  return (
                    <>
                      {equipped.length > 0 && (
                        <div>
                          <span className="text-xs text-[var(--text-muted)] block mb-1">已装备</span>
                          <div className="space-y-1">
                            {equipped.map((item) => (
                              <div key={item.id} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-secondary)] px-2 py-1.5">
                                <Badge size="sm" customColor="var(--accent)">{item.equippedSlot ?? item.category}</Badge>
                                <span className="text-xs text-[var(--text-primary)]">{item.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {unequipped.length > 0 && (
                        <div>
                          <span className="text-xs text-[var(--text-muted)] block mb-1">背包</span>
                          <div className="flex flex-wrap gap-1.5">
                            {unequipped.map((item) => (
                              <Badge key={item.id} size="sm" variant="default">
                                {item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </Card>
        )}

        {npc.skills != null && !isSkillVisible(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setSkillsExpanded((v) => !v)}
            >
              {skillsExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <SparklesIcon className="h-3 w-3 text-[var(--warning)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">技能</span>
            </div>
            {skillsExpanded && (
              <div className="mt-2">
                <span className="text-xs text-[var(--text-muted)]">???</span>
              </div>
            )}
          </Card>
        )}
        {npc.skills != null && isSkillVisible(npc) && !isSkillDetailed(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setSkillsExpanded((v) => !v)}
            >
              {skillsExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <SparklesIcon className="h-3 w-3 text-[var(--warning)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">技能</span>
              {npc.visibility?.skills === 'category' && npc.skills.length > 0 && (
                <Badge size="sm" variant="info">{npc.skills.length}</Badge>
              )}
            </div>
            {skillsExpanded && (
              <div className="mt-2">
                {npc.visibility?.skills === 'category' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set(npc.skills.map((s) => s.category))].map((cat) => (
                      <Badge key={cat} size="sm" variant="default">{cat}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-muted)] italic">技能信息模糊</span>
                )}
              </div>
            )}
          </Card>
        )}
        {npc.skills != null && isSkillDetailed(npc) && (
          <Card variant="default" padding="sm">
            <div
              className="flex cursor-pointer items-center gap-1"
              onClick={() => setSkillsExpanded((v) => !v)}
            >
              {skillsExpanded ? (
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              )}
              <SparklesIcon className="h-3 w-3 text-[var(--warning)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">技能</span>
              {npc.skills.length > 0 && (
                <Badge size="sm" variant="info">{npc.skills.length}</Badge>
              )}
            </div>
            {skillsExpanded && (
              <div className="mt-2 space-y-1.5">
                {npc.skills.length === 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">暂无技能</span>
                ) : (
                  npc.skills.map((skill) => (
                    <div key={skill.id} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-secondary)] px-2 py-1.5">
                      <Badge size="sm" variant="default">{skill.category}</Badge>
                      <span className="text-xs text-[var(--text-primary)]">{skill.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">Lv.{skill.level}</span>
                      {skill.element && (
                        <span className="text-[10px] text-[var(--info)]">{skill.element}</span>
                      )}
                      {Array.isArray(skill.cost) && skill.cost.some(c => c.amount > 0) && (
                        <div className="flex items-center gap-1">
                          {skill.cost.filter(c => c.amount > 0).map((c, i) => (
                            <span key={i} className={`text-[10px] ${c.type === 'mp' ? 'text-[var(--info)]' : c.type === 'hp' ? 'text-red-400' : c.type === 'stamina' ? 'text-green-400' : 'text-yellow-400'}`}>
                              {c.amount}{c.type === 'mp' ? 'MP' : c.type === 'hp' ? 'HP' : c.type === 'stamina' ? '体力' : '金币'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </Modal>
  );
}

function GoalItem({ goal }: { goal: NPCGoal }) {
  const statusConfig = GOAL_STATUS_CONFIG[goal.status] ?? GOAL_STATUS_CONFIG.active;
  return (
    <div className="rounded-md bg-[var(--bg-secondary)] p-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Badge size="sm" customColor={statusConfig.color}>
          {GOAL_TYPE_LABELS[goal.type] ?? goal.type}
        </Badge>
        <Badge size="sm" variant="default">
          {statusConfig.label}
        </Badge>
        <span className="text-[10px] text-[var(--text-muted)]">P{goal.priority}</span>
      </div>
      <p className="text-xs text-[var(--text-primary)] leading-relaxed">{goal.description}</p>
      {goal.progress && (
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{goal.progress}</p>
      )}
    </div>
  );
}

export const NPCPanel = memo(function NPCPanel({
  npcs,
  partyMembers,
  defaultTab,
  targetNpcIds,
  onToggleTargetNpc,
  currentLocationId,
  className,
}: Omit<NPCPanelProps, 'onNPCDetail'>) {
  const { t } = useTranslation('game');
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab ?? 'nearby');
  const [detailNpc, setDetailNpc] = useState<NPCInfo | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const displayList = useMemo(() => {
    if (activeTab === 'party') {
      return partyMembers ?? npcs.filter((n) => n.inParty);
    }
    return npcs;
  }, [activeTab, npcs, partyMembers]);

  const virtualizer = useVirtualizer({
    count: displayList.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 100,
  });

  const partyCount = partyMembers?.length ?? npcs.filter((n) => n.inParty).length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Tabs
        tabs={[
          { id: 'nearby', label: t('npc.nearby') },
          { id: 'party', label: t('npc.partyMembers'), count: partyCount },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabKey)}
        variant="default"
        size="md"
      />

      <div ref={parentRef} className="flex flex-col gap-2 overflow-y-auto" style={{ height: '100%' }}>
        {displayList.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
            {activeTab === 'party' ? t('npc.noPartyMembers') : t('npc.noNearbyNPC')}
          </div>
        )}

        {displayList.length > 0 && (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const npc = displayList[virtualItem.index];
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
                  <NPCCard
                    npc={npc}
                    onDetail={() => setDetailNpc(npc)}
                    isTargetNpc={targetNpcIds?.includes(npc.id)}
                    onToggleTarget={onToggleTargetNpc ? () => onToggleTargetNpc(npc.id) : undefined}
                    isAtCurrentLocation={!currentLocationId || npc.locationId === currentLocationId}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NPCDetailModal
        npc={detailNpc}
        open={!!detailNpc}
        onClose={() => setDetailNpc(null)}
      />
    </div>
  );
});
