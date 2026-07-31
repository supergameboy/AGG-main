import { useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { BackgroundDefinition, CharacterCreationRules } from '@/types';

function createEmptyBackground(): BackgroundDefinition {
  return {
    id: generateId('bg'),
    name: '',
    description: '',
    skill_proficiencies: [],
    languages: [],
    equipment: [],
    feature: '',
    attribute_bonuses: {},
  };
}

export default function BackgroundEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const [bonusKey, setBonusKey] = useState('');

  if (!editingTemplate) return null;

  const cc = editingTemplate.character_creation;
  const backgrounds = cc.backgrounds;

  const updateCC = (updates: Partial<CharacterCreationRules>) => {
    updateNestedField('character_creation', { ...cc, ...updates });
  };

  const updateBackgrounds = (newBackgrounds: BackgroundDefinition[]) => {
    updateCC({ backgrounds: newBackgrounds });
  };

  const updateBackground = (id: string, updates: Partial<BackgroundDefinition>) => {
    updateBackgrounds(backgrounds.map((b) => (b.id === id ? { ...b, ...updates } : b)));
  };

  const addBackground = () => {
    const newBg = createEmptyBackground();
    updateBackgrounds([...backgrounds, newBg]);
    setExpandedId(newBg.id);
  };

  const removeBackground = (id: string) => {
    updateBackgrounds(backgrounds.filter((b) => b.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const getTagInput = (bgId: string, field: string) =>
    tagInputs[`${bgId}_${field}`] ?? '';

  const setTagInput = (bgId: string, field: string, value: string) =>
    setTagInputs((prev) => ({ ...prev, [`${bgId}_${field}`]: value }));

  const addTag = (bgId: string, field: 'skill_proficiencies' | 'languages' | 'equipment') => {
    const inputKey = `${bgId}_${field}`;
    const value = (tagInputs[inputKey] ?? '').trim();
    if (!value) return;
    const bg = backgrounds.find((b) => b.id === bgId);
    if (!bg || bg[field].includes(value)) return;
    updateBackground(bgId, { [field]: [...bg[field], value] });
    setTagInputs((prev) => ({ ...prev, [inputKey]: '' }));
  };

  const removeTag = (bgId: string, field: 'skill_proficiencies' | 'languages' | 'equipment', tag: string) => {
    const bg = backgrounds.find((b) => b.id === bgId);
    if (!bg) return;
    updateBackground(bgId, { [field]: bg[field].filter((t) => t !== tag) });
  };

  const addBonus = (bgId: string) => {
    const key = bonusKey.trim();
    if (!key) return;
    const bg = backgrounds.find((b) => b.id === bgId);
    if (!bg || key in bg.attribute_bonuses) return;
    updateBackground(bgId, { attribute_bonuses: { ...bg.attribute_bonuses, [key]: 0 } });
    setBonusKey('');
  };

  const removeBonus = (bgId: string, key: string) => {
    const bg = backgrounds.find((b) => b.id === bgId);
    if (!bg) return;
    const { [key]: _, ...rest } = bg.attribute_bonuses;
    updateBackground(bgId, { attribute_bonuses: rest });
  };

  const updateBonusValue = (bgId: string, key: string, value: number) => {
    const bg = backgrounds.find((b) => b.id === bgId);
    if (!bg) return;
    updateBackground(bgId, { attribute_bonuses: { ...bg.attribute_bonuses, [key]: value } });
  };

  const TAG_FIELDS: { key: 'skill_proficiencies' | 'languages' | 'equipment'; label: string; placeholder: string }[] = [
    { key: 'skill_proficiencies', label: '技能熟练', placeholder: '如：隐匿、洞察' },
    { key: 'languages', label: '语言', placeholder: '如：通用语、精灵语' },
    { key: 'equipment', label: '装备', placeholder: '如：匕首、绳索' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">背景列表</h3>
        <Button variant="outline" size="sm" onClick={addBackground}>
          + 添加背景
        </Button>
      </div>

      {backgrounds.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">暂无背景，点击上方按钮添加</p>
      )}

      {backgrounds.map((bg) => {
        const isExpanded = expandedId === bg.id;
        return (
          <div key={bg.id} className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] transition-colors text-left"
              onClick={() => setExpandedId(isExpanded ? null : bg.id)}
            >
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {bg.name || '未命名背景'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {isExpanded ? '收起' : '展开'}
              </span>
            </button>

            {isExpanded && (
              <div className="p-4 space-y-4 bg-[var(--bg-card)]/50">
                <div className="grid grid-cols-2 gap-4">
                  <Input label="背景ID" value={bg.id} disabled />
                  <Input
                    label="背景名称"
                    value={bg.name}
                    onChange={(e) => updateBackground(bg.id, { name: e.target.value })}
                    placeholder="如：贵族、士兵"
                  />
                </div>

                <div className="flex flex-col w-full">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
                  <textarea
                    value={bg.description}
                    onChange={(e) => updateBackground(bg.id, { description: e.target.value })}
                    placeholder="背景描述"
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
                  />
                </div>

                <Input
                  label="特性"
                  value={bg.feature}
                  onChange={(e) => updateBackground(bg.id, { feature: e.target.value })}
                  placeholder="背景特性描述"
                />

                {TAG_FIELDS.map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">{label}</label>
                    <div className="flex flex-wrap gap-2">
                      {bg[key].map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent)]/15 text-[var(--text-primary)] text-xs font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                            onClick={() => removeTag(bg.id, key, tag)}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={getTagInput(bg.id, key)}
                        onChange={(e) => setTagInput(bg.id, key, e.target.value)}
                        placeholder={placeholder}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(bg.id, key);
                          }
                        }}
                      />
                      <Button variant="outline" size="sm" onClick={() => addTag(bg.id, key)} disabled={!getTagInput(bg.id, key).trim()}>
                        添加
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">属性加成</label>
                  {Object.entries(bg.attribute_bonuses).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="min-w-[100px] text-sm text-[var(--text-muted)] font-mono">{key}</span>
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => updateBonusValue(bg.id, key, Number(e.target.value))}
                        className="h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                      />
                      <Button variant="danger" size="sm" onClick={() => removeBonus(bg.id, key)}>
                        删除
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input
                      value={bonusKey}
                      onChange={(e) => setBonusKey(e.target.value)}
                      placeholder="属性名"
                    />
                    <Button variant="outline" size="sm" onClick={() => addBonus(bg.id)} disabled={!bonusKey.trim()}>
                      添加加成
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="danger" size="sm" onClick={() => removeBackground(bg.id)}>
                    删除背景
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
