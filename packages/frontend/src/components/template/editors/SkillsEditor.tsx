import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId, parseScaling } from '@/types';
import type { SkillDefinition, TemplateSkillCost, TemplateSkillDamage, TemplateSkillEffect, SkillScalingEntry } from '@/types';

const SKILL_TYPE_OPTIONS = [
  { value: 'attack', label: '攻击' },
  { value: 'defense', label: '防御' },
  { value: 'healing', label: '治疗' },
  { value: 'buff', label: '增益' },
  { value: 'debuff', label: '减益' },
  { value: 'utility', label: '实用' },
  { value: 'passive', label: '被动' },
];

const SKILL_ELEMENT_OPTIONS = [
  { value: 'physical', label: '物理' },
  { value: 'fire', label: '火' },
  { value: 'water', label: '水' },
  { value: 'arcane', label: '奥术' },
  { value: 'holy', label: '神圣' },
  { value: 'shadow', label: '暗影' },
];

const TARGET_TYPE_OPTIONS = [
  { value: 'self', label: '自身' },
  { value: 'single_enemy', label: '单个敌人' },
  { value: 'all_enemies', label: '所有敌人' },
  { value: 'single_ally', label: '单个队友' },
  { value: 'all_allies', label: '所有队友' },
  { value: 'area', label: '区域' },
];

const selectClass =
  'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

const tagInputClass =
  'h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none';

function createDefaultSkill(): SkillDefinition {
  return {
    id: generateId('skill'),
    name: '',
    description: '',
    category: 'attack',
    element: 'physical',
    target_type: 'single_enemy',
    cost: { mp: 10 },
    damage: { base: 10 },
    effects: [],
    cooldown: 0,
    range: 1,
    icon: '',
    custom_data: {},
  };
}

export function SkillsEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const skills: SkillDefinition[] = editingTemplate?.skills ?? [];

  const updateSkills = useCallback(
    (newSkills: SkillDefinition[]) => {
      updateNestedField('skills', newSkills);
    },
    [updateNestedField],
  );

  const handleAdd = useCallback(() => {
    const skill = createDefaultSkill();
    updateSkills([...skills, skill]);
    setExpandedIdx(skills.length);
  }, [skills, updateSkills]);

  const updateSkill = useCallback(
    (index: number, updates: Partial<SkillDefinition>) => {
      const newSkills = skills.map((s, i) => (i === index ? { ...s, ...updates } : s));
      updateSkills(newSkills);
    },
    [skills, updateSkills],
  );

  const updateSkillCost = useCallback(
    (index: number, updates: Partial<TemplateSkillCost>) => {
      const skill = skills[index];
      if (!skill) return;
      updateSkill(index, { cost: { ...skill.cost, ...updates } });
    },
    [skills, updateSkill],
  );

  const updateSkillDamage = useCallback(
    (index: number, updates: Partial<TemplateSkillDamage>) => {
      const skill = skills[index];
      if (!skill) return;
      updateSkill(index, { damage: { ...skill.damage, ...updates } });
    },
    [skills, updateSkill],
  );

  const handleAddEffect = useCallback(
    (index: number) => {
      const skill = skills[index];
      if (!skill) return;
      const newEffect: TemplateSkillEffect = { type: '', value: 0 };
      updateSkill(index, { effects: [...skill.effects, newEffect] });
    },
    [skills, updateSkill],
  );

  const updateEffect = useCallback(
    (skillIndex: number, effectIndex: number, updates: Partial<TemplateSkillEffect>) => {
      const skill = skills[skillIndex];
      if (!skill) return;
      const effects = skill.effects.map((e, i) => (i === effectIndex ? { ...e, ...updates } : e));
      updateSkill(skillIndex, { effects });
    },
    [skills, updateSkill],
  );

  const removeEffect = useCallback(
    (skillIndex: number, effectIndex: number) => {
      const skill = skills[skillIndex];
      if (!skill) return;
      updateSkill(skillIndex, { effects: skill.effects.filter((_, i) => i !== effectIndex) });
    },
    [skills, updateSkill],
  );

  if (!editingTemplate) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">技能定义</h3>
        <Button size="sm" onClick={handleAdd}>
          添加技能
        </Button>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        定义模板中可用的技能。技能将在游戏中供角色和NPC使用。
      </p>

      {skills.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">暂无技能，点击"添加技能"开始定义</p>
        </div>
      )}

      {skills.map((skill, index) => {
        const isExpanded = expandedIdx === index;
        return (
          <div
            key={skill.id}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden"
          >
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : index)}
              className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {skill.name || `技能 #${index + 1}`}
                </span>
                {skill.category && (
                  <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                    {SKILL_TYPE_OPTIONS.find((o) => o.value === skill.category)?.label ?? skill.category}
                  </span>
                )}
                {skill.element && (
                  <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                    {SKILL_ELEMENT_OPTIONS.find((o) => o.value === skill.element)?.label ?? skill.element}
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--text-muted)]">{isExpanded ? '收起' : '展开'}</span>
            </button>

            {isExpanded && (
              <div className="border-t border-[var(--border-primary)] p-4 space-y-3">
                <div className="flex justify-end">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      updateSkills(skills.filter((_, i) => i !== index));
                      setExpandedIdx(null);
                    }}
                  >
                    删除
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="名称"
                    value={skill.name}
                    onChange={(e) => updateSkill(index, { name: e.target.value })}
                    placeholder="技能名称"
                  />
                  <Input
                    label="图标"
                    value={skill.icon}
                    onChange={(e) => updateSkill(index, { icon: e.target.value })}
                    placeholder="图标标识"
                  />
                </div>

                <Input
                  label="描述"
                  value={skill.description}
                  onChange={(e) => updateSkill(index, { description: e.target.value })}
                  placeholder="技能描述"
                />

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
                    <select
                      value={skill.category}
                      onChange={(e) => updateSkill(index, { category: e.target.value })}
                      className={selectClass}
                    >
                      {SKILL_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">元素</label>
                    <select
                      value={skill.element}
                      onChange={(e) => updateSkill(index, { element: e.target.value })}
                      className={selectClass}
                    >
                      {SKILL_ELEMENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">目标类型</label>
                    <select
                      value={skill.target_type}
                      onChange={(e) => updateSkill(index, { target_type: e.target.value })}
                      className={selectClass}
                    >
                      {TARGET_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <h4 className="text-sm font-medium text-[var(--text-secondary)] pt-2">消耗</h4>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label="法力消耗"
                    type="number"
                    min={0}
                    value={skill.cost.mp ?? 0}
                    onChange={(e) => updateSkillCost(index, { mp: Number(e.target.value) || 0 })}
                  />
                  <Input
                    label="生命消耗"
                    type="number"
                    min={0}
                    value={skill.cost.hp ?? 0}
                    onChange={(e) => updateSkillCost(index, { hp: Number(e.target.value) || 0 })}
                  />
                  <Input
                    label="体力消耗"
                    type="number"
                    min={0}
                    value={skill.cost.stamina ?? 0}
                    onChange={(e) => updateSkillCost(index, { stamina: Number(e.target.value) || 0 })}
                  />
                </div>

                <h4 className="text-sm font-medium text-[var(--text-secondary)] pt-2">伤害</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="基础伤害"
                    type="number"
                    min={0}
                    value={skill.damage.base ?? 0}
                    onChange={(e) => updateSkillDamage(index, { base: Number(e.target.value) || 0 })}
                  />
                  <Input
                    label="最小伤害(旧)"
                    type="number"
                    min={0}
                    value={skill.damage.min ?? 0}
                    onChange={(e) => updateSkillDamage(index, { min: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">属性加成</label>
                    <Button size="sm" variant="outline" onClick={() => {
                      const currentScaling = parseScaling(skill.damage.scaling);
                      const newEntry: SkillScalingEntry = { attribute: 'str', multiplier: 1.0 };
                      const newScaling: SkillScalingEntry[] = [...currentScaling, newEntry];
                      updateSkillDamage(index, { scaling: newScaling.length === 1 ? newScaling[0] : newScaling });
                    }}>
                      添加加成
                    </Button>
                  </div>
                  {(() => {
                    const scalingEntries = parseScaling(skill.damage.scaling);
                    if (scalingEntries.length === 0) {
                      return <p className="text-xs text-[var(--text-muted)]">无属性加成</p>;
                    }
                    return (
                      <div className="space-y-1.5">
                        {scalingEntries.map((entry, sIdx) => (
                          <div key={sIdx} className="flex items-center gap-2 rounded bg-[var(--bg-secondary)] px-2 py-1.5">
                            <input
                              className={tagInputClass}
                              placeholder="属性"
                              value={entry.attribute}
                              onChange={(e) => {
                                const updated = scalingEntries.map((s, i) => i === sIdx ? { ...s, attribute: e.target.value } : s);
                                updateSkillDamage(index, { scaling: updated.length === 1 ? updated[0] : updated });
                              }}
                            />
                            <input
                              className={tagInputClass}
                              placeholder="系数"
                              type="number"
                              step="0.1"
                              min={0}
                              value={entry.multiplier}
                              onChange={(e) => {
                                const updated = scalingEntries.map((s, i) => i === sIdx ? { ...s, multiplier: Number(e.target.value) || 0 } : s);
                                updateSkillDamage(index, { scaling: updated.length === 1 ? updated[0] : updated });
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const updated = scalingEntries.filter((_, i) => i !== sIdx);
                                if (updated.length === 0) {
                                  const newDamage = { ...skill.damage };
                                  delete newDamage.scaling;
                                  updateSkill(index, { damage: newDamage });
                                } else {
                                  updateSkillDamage(index, { scaling: updated.length === 1 ? updated[0] : updated });
                                }
                              }}
                              className="text-xs text-[var(--text-muted)] hover:text-[var(--error)]"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="冷却(回合)"
                    type="number"
                    min={0}
                    value={skill.cooldown}
                    onChange={(e) => updateSkill(index, { cooldown: Number(e.target.value) || 0 })}
                  />
                  <Input
                    label="范围"
                    type="number"
                    min={0}
                    value={skill.range}
                    onChange={(e) => updateSkill(index, { range: Number(e.target.value) || 0 })}
                  />
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">效果</label>
                    <Button size="sm" variant="outline" onClick={() => handleAddEffect(index)}>
                      添加效果
                    </Button>
                  </div>
                  {skill.effects.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)]">暂无效果</p>
                  )}
                  {skill.effects.map((eff, effIdx) => (
                    <div
                      key={effIdx}
                      className="flex items-center gap-2 rounded bg-[var(--bg-secondary)] px-2 py-1.5 mb-1.5"
                    >
                      <input
                        className={tagInputClass}
                        placeholder="效果类型"
                        value={eff.type}
                        onChange={(e) => updateEffect(index, effIdx, { type: e.target.value })}
                      />
                      <input
                        className={tagInputClass}
                        placeholder="数值"
                        type="number"
                        value={eff.value}
                        onChange={(e) => updateEffect(index, effIdx, { value: Number(e.target.value) || 0 })}
                      />
                      <input
                        className={tagInputClass}
                        placeholder="持续回合"
                        type="number"
                        min={0}
                        value={eff.duration ?? 0}
                        onChange={(e) => updateEffect(index, effIdx, { duration: Number(e.target.value) || 0 })}
                      />
                      <button
                        type="button"
                        onClick={() => removeEffect(index, effIdx)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--error)]"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
