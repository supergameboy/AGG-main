import { TrashIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import type { TemplateSkillPoolEntry, TemplateItemPoolEntry } from '@/types';

export type PoolEntry = TemplateSkillPoolEntry | TemplateItemPoolEntry;

interface PoolEntryCardProps {
  entry: PoolEntry;
  type: 'skill' | 'item';
  categoryOptions: { value: string; label: string }[];
  onEdit: () => void;
  onDelete: () => void;
}

const QUALITY_COLORS: Record<string, string> = {
  common: 'text-[var(--text-muted)]',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  epic: 'text-purple-400',
  legendary: 'text-orange-400',
};

function isSkillEntry(entry: PoolEntry): entry is TemplateSkillPoolEntry {
  return 'element' in entry;
}

function isItemEntry(entry: PoolEntry): entry is TemplateItemPoolEntry {
  return 'quality' in entry;
}

export function PoolEntryCard({ entry, type, categoryOptions, onEdit, onDelete }: PoolEntryCardProps) {
  const categoryLabel = entry.category
    ? categoryOptions.find((o) => o.value === entry.category)?.label ?? entry.category
    : undefined;

  const quality = isItemEntry(entry) ? entry.quality : undefined;
  const element = isSkillEntry(entry) ? entry.element : undefined;
  const equippedSlot = isItemEntry(entry) ? entry.equippedSlot : undefined;
  const cost = isSkillEntry(entry) ? entry.cost : undefined;

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {entry.icon && (
              <span className="text-base leading-none">{entry.icon}</span>
            )}
            <span
              className={`text-sm font-medium ${
                quality ? (QUALITY_COLORS[quality] ?? 'text-[var(--text-primary)]') : 'text-[var(--text-primary)]'
              }`}
            >
              {entry.name}
            </span>
            {entry.category && (
              <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                {categoryLabel}
              </span>
            )}
            {type === 'skill' && element && (
              <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                {element}
              </span>
            )}
            {type === 'item' && quality && (
              <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                {quality}
              </span>
            )}
            {type === 'item' && equippedSlot && (
              <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                {equippedSlot}
              </span>
            )}
          </div>
          {entry.description && (
            <p className="text-xs text-[var(--text-muted)] mb-1 line-clamp-2">{entry.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            {type === 'skill' && cost && cost.length > 0 && (
              <span>消耗: {cost.map((c) => `${c.type}:${c.amount}`).join(', ')}</span>
            )}
            {entry.recommendedClasses && entry.recommendedClasses.length > 0 && (
              <span>推荐: {entry.recommendedClasses.join(', ')}</span>
            )}
            {entry.source && <span>来源: {entry.source}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
          >
            <PencilSquareIcon className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--error)]"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
