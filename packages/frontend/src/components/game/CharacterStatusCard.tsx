import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartIcon, BoltIcon, StarIcon } from '@heroicons/react/24/outline';
import { Avatar, Badge, Progress, StatBlock, Divider, Card, CollapsibleSection } from '@/components/ui';
import { getAttributeColor, ATTRIBUTE_FULL_NAMES, DERIVED_ATTRIBUTE_NAMES } from '@/utils/entityMapper';
import type { Gender } from '@/types';
import { GENDER_LABELS } from '@/types';

interface CharacterStatusCardProps {
  name: string;
  level: number;
  gender?: Gender;
  customGender?: string;
  race?: string;
  raceName?: string;
  classType?: string;
  classDisplayName?: string;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  currentEXP: number;
  maxEXP: number;
  gold?: number;
  currency?: Record<string, number>;
  currencyName?: string;
  currencyIcon?: string;
  attributes?: Record<string, number>;
  attributeNames?: Record<string, string>;
  derivedAttributes?: Record<string, number>;
  numericalComplexity?: string;
  statusEffects?: string[];
  className?: string;
  defaultDerivedExpanded?: boolean;
}

const COMPLEXITY_KEY_MAP: Record<string, string> = {
  simple: 'character.complexitySimple',
  medium: 'character.complexityMedium',
  complex: 'character.complexityComplex',
};

const COMPLEXITY_VARIANT_MAP: Record<string, 'success' | 'warning' | 'error'> = {
  simple: 'success',
  medium: 'warning',
  complex: 'error',
};

export const CharacterStatusCard = memo(function CharacterStatusCard({
  name,
  level,
  gender,
  customGender,
  race,
  raceName,
  classType,
  classDisplayName,
  currentHP,
  maxHP,
  currentMP,
  maxMP,
  currentEXP,
  maxEXP,
  gold,
  currency,
  currencyName,
  currencyIcon,
  attributes,
  attributeNames,
  derivedAttributes,
  numericalComplexity,
  statusEffects,
  className,
  defaultDerivedExpanded = false,
}: CharacterStatusCardProps) {
  const { t } = useTranslation('game');
  const [derivedExpanded, setDerivedExpanded] = useState(defaultDerivedExpanded);
  const raceDisplay = raceName || race;
  const classDisplay = classDisplayName || classType;
  const genderDisplay = gender ? (gender === 'custom' ? (customGender || t('character.customGender')) : GENDER_LABELS[gender]) : '';
  const subtitle = [genderDisplay, raceDisplay, classDisplay].filter(Boolean).join(' · ');

  return (
    <Card variant="default" padding="md" className={className}>
      <div className="flex items-center gap-3">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="line-clamp-2 text-base font-semibold text-[var(--text-primary)]">
              {name}
            </h3>
            <Badge variant="primary" size="sm">Lv.{level}</Badge>
            {numericalComplexity && (
              <Badge
                variant={COMPLEXITY_VARIANT_MAP[numericalComplexity] ?? 'warning'}
                size="sm"
              >
                {t(COMPLEXITY_KEY_MAP[numericalComplexity] ?? 'character.complexityMedium')}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Progress
          value={currentHP}
          max={maxHP}
          variant="health"
          icon={<HeartIcon className="h-3.5 w-3.5" />}
          label="HP"
          labelRender={(v, m) => (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {v}<span className="text-[var(--text-muted)]/60">/</span>{m}
            </span>
          )}
        />
        <Progress
          value={currentMP}
          max={maxMP}
          variant="mana"
          icon={<BoltIcon className="h-3.5 w-3.5" />}
          label="MP"
          labelRender={(v, m) => (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {v}<span className="text-[var(--text-muted)]/60">/</span>{m}
            </span>
          )}
        />
        <Progress
          value={currentEXP}
          max={maxEXP}
          variant="experience"
          icon={<StarIcon className="h-3.5 w-3.5" />}
          label="EXP"
          labelRender={(v, m) => (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {v}<span className="text-[var(--text-muted)]/60">/</span>{m}
            </span>
          )}
        />
      </div>

      {(gold !== undefined || currency) && (
        <div className="mt-3">
          <StatBlock
            label={currencyName || t('character.gold')}
            value={(currency ? Object.values(currency).reduce((a, b) => a + b, 0) : gold ?? 0).toLocaleString()}
            icon={<span className="text-sm">{currencyIcon || '🪙'}</span>}
            color="var(--gold, #f59e0b)"
          />
        </div>
      )}

      {attributes && Object.keys(attributes).length > 0 && (
        <div className="mt-3">
          <Divider />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {Object.entries(attributes)
              .filter(([key]) => attributeNames ? key in attributeNames : true)
              .map(([key, value]) => {
              const displayName = attributeNames?.[key] || ATTRIBUTE_FULL_NAMES[key] || key;
              const color = getAttributeColor(key);
              return (
                <StatBlock key={key} label={displayName} value={value} color={color} />
              );
            })}
          </div>
        </div>
      )}

      {derivedAttributes && Object.keys(derivedAttributes).length > 0 && (
        <div className="mt-2">
          <Divider />
          <CollapsibleSection
            title={t('character.derivedAttributes')}
            count={Object.keys(derivedAttributes).length}
            expanded={derivedExpanded}
            onToggle={() => setDerivedExpanded(!derivedExpanded)}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {Object.entries(derivedAttributes).map(([key, value]) => {
                const displayName = DERIVED_ATTRIBUTE_NAMES[key] || key;
                return (
                  <StatBlock key={`derived-${key}`} label={displayName} value={Math.floor(value)} color="var(--accent)" />
                );
              })}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {statusEffects && statusEffects.length > 0 && (
        <div className="mt-2">
          <Divider />
          <div className="flex flex-wrap gap-1.5">
            {statusEffects.map((effect) => (
              <Badge key={effect} variant="warning" size="sm">{effect}</Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
});
