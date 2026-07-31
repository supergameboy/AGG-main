import { useState } from 'react';
import type { ApiKeyEntry } from '@ai-rpg/shared';

interface ApiKeyPoolEditorProps {
  keys: ApiKeyEntry[];
  onChange: (keys: ApiKeyEntry[]) => void;
}

export function ApiKeyPoolEditor({ keys, onChange }: ApiKeyPoolEditorProps) {
  const [visibleKeys, setVisibleKeys] = useState<Set<number>>(new Set());

  const toggleVisibility = (index: number) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const updateKey = (index: number, field: keyof ApiKeyEntry, value: string | number) => {
    const updated = [...keys];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const addKey = () => {
    onChange([
      ...keys,
      { key: '', label: `Key ${keys.length + 1}`, priority: keys.length + 1 },
    ]);
  };

  const removeKey = (index: number) => {
    const updated = keys.filter((_, i) => i !== index);
    updated.forEach((k, i) => {
      k.priority = i + 1;
    });
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-[var(--text-secondary)]">API Key 池</label>

      {keys.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">暂无 API Key，请添加</p>
      )}

      <div className="space-y-2">
        {keys.map((entry, index) => (
          <div
            key={index}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-xs font-bold text-[var(--accent)]">
              {index + 1}
            </span>

            <input
              type="text"
              value={entry.label}
              onChange={(e) => updateKey(index, 'label', e.target.value)}
              placeholder="标签"
              className="h-8 w-20 shrink-0 rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />

            <div className="relative min-w-0 flex-1">
              <input
                type={visibleKeys.has(index) ? 'text' : 'password'}
                value={entry.key}
                onChange={(e) => updateKey(index, 'key', e.target.value)}
                placeholder="sk-..."
                className="h-8 w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 pr-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => toggleVisibility(index)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                {visibleKeys.has(index) ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                    <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => removeKey(index)}
              className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--error)]/10 hover:text-[var(--error)]"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addKey}
        className="mt-1 flex items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-primary)] py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        添加 API Key
      </button>
    </div>
  );
}
