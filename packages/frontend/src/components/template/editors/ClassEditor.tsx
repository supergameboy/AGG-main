import { useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { ClassDefinition, CharacterCreationRules } from '@/types';

function createEmptyClass(): ClassDefinition {
  return {
    id: generateId('class'),
    name: '',
    description: '',
    primary_attributes: [],
    hit_die: 'd8',
    skill_proficiencies: [],
    starting_equipment: [],
  };
}

export default function ClassEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});

  if (!editingTemplate) return null;

  const cc = editingTemplate.character_creation;
  const classes = cc.classes;

  const updateCC = (updates: Partial<CharacterCreationRules>) => {
    updateNestedField('character_creation', { ...cc, ...updates });
  };

  const updateClasses = (newClasses: ClassDefinition[]) => {
    updateCC({ classes: newClasses });
  };

  const updateClass = (id: string, updates: Partial<ClassDefinition>) => {
    updateClasses(classes.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const addClass = () => {
    const newClass = createEmptyClass();
    updateClasses([...classes, newClass]);
    setExpandedId(newClass.id);
  };

  const removeClass = (id: string) => {
    updateClasses(classes.filter((c) => c.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const getTagInput = (classId: string, field: string) =>
    tagInputs[`${classId}_${field}`] ?? '';

  const setTagInput = (classId: string, field: string, value: string) =>
    setTagInputs((prev) => ({ ...prev, [`${classId}_${field}`]: value }));

  const addTag = (classId: string, field: 'primary_attributes' | 'skill_proficiencies' | 'starting_equipment') => {
    const inputKey = `${classId}_${field}`;
    const value = (tagInputs[inputKey] ?? '').trim();
    if (!value) return;
    const cls = classes.find((c) => c.id === classId);
    if (!cls || cls[field].includes(value)) return;
    updateClass(classId, { [field]: [...cls[field], value] });
    setTagInputs((prev) => ({ ...prev, [inputKey]: '' }));
  };

  const removeTag = (classId: string, field: 'primary_attributes' | 'skill_proficiencies' | 'starting_equipment', tag: string) => {
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return;
    updateClass(classId, { [field]: cls[field].filter((t) => t !== tag) });
  };

  const TAG_FIELDS: { key: 'primary_attributes' | 'skill_proficiencies' | 'starting_equipment'; label: string; placeholder: string }[] = [
    { key: 'primary_attributes', label: '主要属性', placeholder: '如：力量、敏捷' },
    { key: 'skill_proficiencies', label: '技能熟练', placeholder: '如：剑术、格挡' },
    { key: 'starting_equipment', label: '初始装备', placeholder: '如：长剑、盾牌' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">职业列表</h3>
        <Button variant="outline" size="sm" onClick={addClass}>
          + 添加职业
        </Button>
      </div>

      {classes.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">暂无职业，点击上方按钮添加</p>
      )}

      {classes.map((cls) => {
        const isExpanded = expandedId === cls.id;
        return (
          <div key={cls.id} className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] transition-colors text-left"
              onClick={() => setExpandedId(isExpanded ? null : cls.id)}
            >
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {cls.name || '未命名职业'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {isExpanded ? '收起' : '展开'}
              </span>
            </button>

            {isExpanded && (
              <div className="p-4 space-y-4 bg-[var(--bg-card)]/50">
                <div className="grid grid-cols-2 gap-4">
                  <Input label="职业ID" value={cls.id} disabled />
                  <Input
                    label="职业名称"
                    value={cls.name}
                    onChange={(e) => updateClass(cls.id, { name: e.target.value })}
                    placeholder="如：战士、法师"
                  />
                </div>

                <div className="flex flex-col w-full">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
                  <textarea
                    value={cls.description}
                    onChange={(e) => updateClass(cls.id, { description: e.target.value })}
                    placeholder="职业描述"
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
                  />
                </div>

                <div className="flex flex-col w-full">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">生命骰</label>
                  <select
                    value={cls.hit_die}
                    onChange={(e) => updateClass(cls.id, { hit_die: e.target.value })}
                    className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="d4">d4 - 脆弱型（如法师）</option>
                    <option value="d6">d6 - 轻型（如盗贼）</option>
                    <option value="d8">d8 - 中型（如游侠）</option>
                    <option value="d10">d10 - 重型（如战士）</option>
                    <option value="d12">d12 - 坦克型（如野蛮人）</option>
                  </select>
                </div>

                {TAG_FIELDS.map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">{label}</label>
                    <div className="flex flex-wrap gap-2">
                      {cls[key].map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent)]/15 text-[var(--text-primary)] text-xs font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                            onClick={() => removeTag(cls.id, key, tag)}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={getTagInput(cls.id, key)}
                        onChange={(e) => setTagInput(cls.id, key, e.target.value)}
                        placeholder={placeholder}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(cls.id, key);
                          }
                        }}
                      />
                      <Button variant="outline" size="sm" onClick={() => addTag(cls.id, key)} disabled={!getTagInput(cls.id, key).trim()}>
                        添加
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-2">
                  <Button variant="danger" size="sm" onClick={() => removeClass(cls.id)}>
                    删除职业
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
