import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { CustomOption } from '@/types';

const TYPE_OPTIONS: { value: CustomOption['type']; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'select', label: '选择' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
];

export function CustomOptionEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const customOptions: CustomOption[] = editingTemplate?.character_creation?.custom_options ?? [];

  const updateOptions = useCallback(
    (options: CustomOption[]) => {
      updateNestedField('character_creation', {
        ...editingTemplate!.character_creation,
        custom_options: options,
      });
    },
    [editingTemplate, updateNestedField],
  );

  const handleAdd = useCallback(() => {
    const newOpt: CustomOption = {
      id: generateId('opt'),
      name: '',
      description: '',
      type: 'text',
      options: [],
      default_value: '',
    };
    updateOptions([...customOptions, newOpt]);
    setExpandedId(newOpt.id);
  }, [customOptions, updateOptions]);

  const updateOption = useCallback(
    (id: string, updates: Partial<CustomOption>) => {
      updateOptions(customOptions.map((opt) => (opt.id === id ? { ...opt, ...updates } : opt)));
    },
    [customOptions, updateOptions],
  );

  const removeOption = useCallback(
    (id: string) => {
      updateOptions(customOptions.filter((opt) => opt.id !== id));
      if (expandedId === id) setExpandedId(null);
    },
    [customOptions, expandedId, updateOptions],
  );

  if (!editingTemplate) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">自定义选项</h3>
        <Button size="sm" onClick={handleAdd}>+ 添加选项</Button>
      </div>

      {customOptions.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">暂无自定义选项，点击"添加选项"创建</p>
        </div>
      )}

      {customOptions.map((opt) => {
        const isExpanded = expandedId === opt.id;
        return (
          <div key={opt.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
            <button
              onClick={() => setExpandedId(isExpanded ? null : opt.id)}
              className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">{opt.name || `自定义选项 #${opt.id.slice(-4)}`}</span>
                <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{opt.type}</span>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{isExpanded ? '收起' : '展开'}</span>
            </button>
            {isExpanded && (
              <div className="border-t border-[var(--border-primary)] p-4 space-y-3">
                <div className="flex justify-end">
                  <Button variant="danger" size="sm" onClick={() => removeOption(opt.id)}>删除</Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="选项名称" value={opt.name} onChange={(e) => updateOption(opt.id, { name: e.target.value })} placeholder="如：出身地" />
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
                    <select
                      value={opt.type}
                      onChange={(e) => updateOption(opt.id, { type: e.target.value as CustomOption['type'] })}
                      className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                    >
                      {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <Input label="描述" value={opt.description} onChange={(e) => updateOption(opt.id, { description: e.target.value })} placeholder="选项的说明文字" />
                {opt.type === 'select' && (
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">可选值</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {opt.options.map((option, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                          {option}
                          <button type="button" onClick={() => updateOption(opt.id, { options: opt.options.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)]">x</button>
                        </span>
                      ))}
                    </div>
                    <input
                      className="h-8 w-40 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                      placeholder="输入选项后回车"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) { updateOption(opt.id, { options: [...opt.options, val] }); (e.target as HTMLInputElement).value = ''; }
                        }
                      }}
                    />
                  </div>
                )}
                <div className="flex flex-col">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">默认值</label>
                  {opt.type === 'boolean' ? (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={opt.default_value === true}
                        onChange={(e) => updateOption(opt.id, { default_value: e.target.checked })}
                        className="h-4 w-4 rounded border-[var(--border-primary)]"
                      />
                      <span className="text-sm text-[var(--text-primary)]">{opt.default_value ? '是' : '否'}</span>
                    </label>
                  ) : opt.type === 'number' ? (
                    <input
                      type="number"
                      value={typeof opt.default_value === 'number' ? opt.default_value : 0}
                      onChange={(e) => updateOption(opt.id, { default_value: Number(e.target.value) || 0 })}
                      className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                    />
                  ) : (
                    <input
                      type="text"
                      value={typeof opt.default_value === 'string' ? opt.default_value : ''}
                      onChange={(e) => updateOption(opt.id, { default_value: e.target.value })}
                      className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                      placeholder="默认值"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
