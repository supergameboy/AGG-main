import { useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { AttributeDefinition, CharacterCreationRules } from '@/types';

function createEmptyAttribute(): AttributeDefinition {
  return {
    id: generateId('attr'),
    name: '',
    abbreviation: '',
    description: '',
    min_value: 1,
    default_value: 10,
    max_value: 20,
  };
}

export default function AttributeEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!editingTemplate) return null;

  const cc = editingTemplate.character_creation;
  const attributes = cc.attributes;

  const updateCC = (updates: Partial<CharacterCreationRules>) => {
    updateNestedField('character_creation', { ...cc, ...updates });
  };

  const updateAttribute = (id: string, updates: Partial<AttributeDefinition>) => {
    updateCC({ attributes: attributes.map((a) => (a.id === id ? { ...a, ...updates } : a)) });
  };

  const addAttribute = () => {
    const newAttr = createEmptyAttribute();
    updateCC({ attributes: [...attributes, newAttr] });
    setExpandedId(newAttr.id);
  };

  const removeAttribute = (id: string) => {
    updateCC({ attributes: attributes.filter((a) => a.id !== id) });
    if (expandedId === id) setExpandedId(null);
  };

  const numberInputClass = 'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">属性定义</h3>
        <Button variant="outline" size="sm" onClick={addAttribute}>
          + 添加属性
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex flex-col w-48">
          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">属性点数</label>
          <input
            type="number"
            value={cc.attribute_points}
            onChange={(e) => updateCC({ attribute_points: Number(e.target.value) })}
            min={0}
            className={numberInputClass}
          />
        </div>
      </div>

      {attributes.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">暂无属性，点击上方按钮添加</p>
      )}

      {attributes.map((attr) => {
        const isExpanded = expandedId === attr.id;
        return (
          <div key={attr.id} className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] transition-colors text-left"
              onClick={() => setExpandedId(isExpanded ? null : attr.id)}
            >
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {attr.name ? `${attr.name} (${attr.abbreviation})` : '未命名属性'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {isExpanded ? '收起' : '展开'}
              </span>
            </button>

            {isExpanded && (
              <div className="p-4 space-y-4 bg-[var(--bg-card)]/50">
                <div className="grid grid-cols-3 gap-4">
                  <Input label="属性ID" value={attr.id} disabled />
                  <Input
                    label="属性名称"
                    value={attr.name}
                    onChange={(e) => updateAttribute(attr.id, { name: e.target.value })}
                    placeholder="如：力量"
                  />
                  <Input
                    label="缩写"
                    value={attr.abbreviation}
                    onChange={(e) => updateAttribute(attr.id, { abbreviation: e.target.value })}
                    placeholder="如：STR"
                  />
                </div>

                <div className="flex flex-col w-full">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
                  <textarea
                    value={attr.description}
                    onChange={(e) => updateAttribute(attr.id, { description: e.target.value })}
                    placeholder="属性描述"
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col w-full">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">最小值</label>
                    <input
                      type="number"
                      value={attr.min_value}
                      onChange={(e) => updateAttribute(attr.id, { min_value: Number(e.target.value) })}
                      className={numberInputClass}
                    />
                  </div>
                  <div className="flex flex-col w-full">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">默认值</label>
                    <input
                      type="number"
                      value={attr.default_value}
                      onChange={(e) => updateAttribute(attr.id, { default_value: Number(e.target.value) })}
                      className={numberInputClass}
                    />
                  </div>
                  <div className="flex flex-col w-full">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">最大值</label>
                    <input
                      type="number"
                      value={attr.max_value}
                      onChange={(e) => updateAttribute(attr.id, { max_value: Number(e.target.value) })}
                      className={numberInputClass}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="danger" size="sm" onClick={() => removeAttribute(attr.id)}>
                    删除属性
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
