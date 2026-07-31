import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { GameRules, SpecialRules, CustomRule, NumericalComplexity, EquipmentSlotDefinition, SaveRestrictionType } from '@/types';
import { DEFAULT_EQUIPMENT_SLOTS } from '@/types';
import { resolveI18nKey } from '@/utils/i18nResolver';

export function RulesEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [newFailCondition, setNewFailCondition] = useState('');
  const [newSpecialRule, setNewSpecialRule] = useState('');
  const [newStackSizeKey, setNewStackSizeKey] = useState('');
  const [newStackSizeValue, setNewStackSizeValue] = useState('');
  const [equipmentSlotsJson, setEquipmentSlotsJson] = useState('');

  const gameRules: GameRules = editingTemplate?.game_rules ?? {
    combat_system: {
      type: 'narrative', initiative_type: 'dexterity', custom_initiative: '', action_points: 1,
      critical_hit: { threshold: 20, multiplier: 2 },
      flee: { base_chance: 0.3, per_dead_enemy_bonus: 0.1 },
      defend: { damage_reduction: 0.5 },
      damage_formula: { attack_contribution: 0.5, defense_reduction: 0.5, level_bonus_factor: 2, variance_min: 0.9, variance_range: 0.2 },
      enemy_ai: { skill_use_chance: 0.3 },
      defaults: { potion_heal: 30, mana_potion_restore: 20, skill_cost_default: 10, skill_damage_multiplier: 1.5, skill_base_damage_factor: 2, attribute_fallback: 10, enemy_speed_factor: 2 },
    },
    skill_system: { max_level: 10, cooldown_system: 'turn', upgrade_cost: { base: 100, multiplier: 1.5 } },
    inventory_system: { max_slots: 20, weight_system: false, stack_sizes: {}, equipment_slots: [...DEFAULT_EQUIPMENT_SLOTS] },
    quest_system: { max_active: 10, time_system: false, fail_conditions: [] },
    currency_system: { id: 'gold', name: '金币', icon: '🪙' },
    custom_rules: [],
  };

  const specialRules: SpecialRules = editingTemplate?.special_rules ?? {
    has_kp: false,
    permadeath: false,
    save_restriction: 'free',
    custom_rules: [],
  };

  const updateGameRules = useCallback(
    (rules: GameRules) => {
      updateNestedField('game_rules', rules);
    },
    [updateNestedField]
  );

  const updateSpecialRules = useCallback(
    (rules: SpecialRules) => {
      updateNestedField('special_rules', rules);
    },
    [updateNestedField]
  );

  const updateCombatSystem = useCallback(
    (updates: Partial<GameRules['combat_system']>) => {
      updateGameRules({
        ...gameRules,
        combat_system: { ...gameRules.combat_system, ...updates },
      });
    },
    [gameRules, updateGameRules]
  );

  const updateCriticalHit = useCallback(
    (updates: Partial<GameRules['combat_system']['critical_hit']>) => {
      updateGameRules({
        ...gameRules,
        combat_system: {
          ...gameRules.combat_system,
          critical_hit: { ...gameRules.combat_system.critical_hit, ...updates },
        },
      });
    },
    [gameRules, updateGameRules]
  );

  const updateSkillSystem = useCallback(
    (updates: Partial<GameRules['skill_system']>) => {
      updateGameRules({
        ...gameRules,
        skill_system: { ...gameRules.skill_system, ...updates },
      });
    },
    [gameRules, updateGameRules]
  );

  const updateUpgradeCost = useCallback(
    (updates: Partial<GameRules['skill_system']['upgrade_cost']>) => {
      updateGameRules({
        ...gameRules,
        skill_system: {
          ...gameRules.skill_system,
          upgrade_cost: { ...gameRules.skill_system.upgrade_cost, ...updates },
        },
      });
    },
    [gameRules, updateGameRules]
  );

  const updateInventorySystem = useCallback(
    (updates: Partial<GameRules['inventory_system']>) => {
      updateGameRules({
        ...gameRules,
        inventory_system: { ...gameRules.inventory_system, ...updates },
      });
    },
    [gameRules, updateGameRules]
  );

  const updateQuestSystem = useCallback(
    (updates: Partial<GameRules['quest_system']>) => {
      updateGameRules({
        ...gameRules,
        quest_system: { ...gameRules.quest_system, ...updates },
      });
    },
    [gameRules, updateGameRules]
  );

  const handleAddCustomRule = useCallback(() => {
    updateGameRules({
      ...gameRules,
      custom_rules: [...gameRules.custom_rules, { name: '', description: '' }],
    });
  }, [gameRules, updateGameRules]);

  const handleRemoveCustomRule = useCallback(
    (index: number) => {
      updateGameRules({
        ...gameRules,
        custom_rules: gameRules.custom_rules.filter((_, i) => i !== index),
      });
    },
    [gameRules, updateGameRules]
  );

  const handleCustomRuleChange = useCallback(
    (index: number, field: keyof CustomRule, value: string) => {
      updateGameRules({
        ...gameRules,
        custom_rules: gameRules.custom_rules.map((rule, i) =>
          i === index ? { ...rule, [field]: value } : rule
        ),
      });
    },
    [gameRules, updateGameRules]
  );

  const handleAddFailCondition = useCallback(() => {
    const cond = newFailCondition.trim();
    if (!cond) return;
    updateQuestSystem({
      ...gameRules.quest_system,
      fail_conditions: [...gameRules.quest_system.fail_conditions, cond],
    });
    setNewFailCondition('');
  }, [gameRules.quest_system, newFailCondition, updateQuestSystem]);

  const handleRemoveFailCondition = useCallback(
    (index: number) => {
      updateQuestSystem({
        ...gameRules.quest_system,
        fail_conditions: gameRules.quest_system.fail_conditions.filter((_, i) => i !== index),
      });
    },
    [gameRules.quest_system, updateQuestSystem]
  );

  const handleAddStackSize = useCallback(() => {
    const key = newStackSizeKey.trim();
    if (!key) return;
    updateInventorySystem({
      ...gameRules.inventory_system,
      stack_sizes: { ...gameRules.inventory_system.stack_sizes, [key]: Number(newStackSizeValue) || 1 },
    });
    setNewStackSizeKey('');
    setNewStackSizeValue('');
  }, [gameRules.inventory_system, newStackSizeKey, newStackSizeValue, updateInventorySystem]);

  const handleRemoveStackSize = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = gameRules.inventory_system.stack_sizes;
      updateInventorySystem({
        ...gameRules.inventory_system,
        stack_sizes: rest as Record<string, number>,
      });
    },
    [gameRules.inventory_system, updateInventorySystem]
  );

  const handleAddSpecialCustomRule = useCallback(() => {
    const rule = newSpecialRule.trim();
    if (!rule) return;
    updateSpecialRules({
      ...specialRules,
      custom_rules: [...specialRules.custom_rules, rule],
    });
    setNewSpecialRule('');
  }, [specialRules, newSpecialRule, updateSpecialRules]);

  const handleRemoveSpecialCustomRule = useCallback(
    (index: number) => {
      updateSpecialRules({
        ...specialRules,
        custom_rules: specialRules.custom_rules.filter((_, i) => i !== index),
      });
    },
    [specialRules, updateSpecialRules]
  );

  if (!editingTemplate) return null;

  const selectClass =
    'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">战斗系统</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
            <select
              value={gameRules.combat_system.type}
              onChange={(e) => updateCombatSystem({ type: e.target.value })}
              className={selectClass}
            >
              <option value="narrative">叙事</option>
              <option value="turn_based">回合制</option>
              <option value="real_time">即时</option>
              <option value="hybrid">混合</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">先攻类型</label>
            <select
              value={gameRules.combat_system.initiative_type}
              onChange={(e) => updateCombatSystem({ initiative_type: e.target.value })}
              className={selectClass}
            >
              <option value="dexterity">敏捷</option>
              <option value="random">随机</option>
              <option value="custom">自定义</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="自定义先攻"
            value={gameRules.combat_system.custom_initiative}
            onChange={(e) => updateCombatSystem({ custom_initiative: e.target.value })}
          />
          <Input
            label="行动点数"
            type="number"
            value={gameRules.combat_system.action_points}
            onChange={(e) => updateCombatSystem({ action_points: Number(e.target.value) || 1 })}
          />
          <div />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="暴击阈值"
            type="number"
            value={gameRules.combat_system.critical_hit.threshold}
            onChange={(e) => updateCriticalHit({ threshold: Number(e.target.value) || 20 })}
          />
          <Input
            label="暴击倍率"
            type="number"
            step="0.1"
            value={gameRules.combat_system.critical_hit.multiplier}
            onChange={(e) => updateCriticalHit({ multiplier: Number(e.target.value) || 2 })}
          />
        </div>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] pt-2">逃跑与防御</h4>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="逃跑基础概率"
            type="number"
            step="0.05"
            value={gameRules.combat_system.flee?.base_chance ?? 0.3}
            onChange={(e) => updateCombatSystem({ flee: { ...gameRules.combat_system.flee, base_chance: Number(e.target.value) || 0.3 } })}
          />
          <Input
            label="逃跑击杀加成"
            type="number"
            step="0.05"
            value={gameRules.combat_system.flee?.per_dead_enemy_bonus ?? 0.1}
            onChange={(e) => updateCombatSystem({ flee: { ...gameRules.combat_system.flee, per_dead_enemy_bonus: Number(e.target.value) || 0.1 } })}
          />
          <Input
            label="防御减伤比例"
            type="number"
            step="0.05"
            value={gameRules.combat_system.defend?.damage_reduction ?? 0.5}
            onChange={(e) => updateCombatSystem({ defend: { damage_reduction: Number(e.target.value) || 0.5 } })}
          />
        </div>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] pt-2">伤害公式</h4>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="攻击贡献系数"
            type="number"
            step="0.05"
            value={gameRules.combat_system.damage_formula?.attack_contribution ?? 0.5}
            onChange={(e) => updateCombatSystem({ damage_formula: { ...gameRules.combat_system.damage_formula, attack_contribution: Number(e.target.value) || 0.5 } })}
          />
          <Input
            label="防御减伤系数"
            type="number"
            step="0.05"
            value={gameRules.combat_system.damage_formula?.defense_reduction ?? 0.5}
            onChange={(e) => updateCombatSystem({ damage_formula: { ...gameRules.combat_system.damage_formula, defense_reduction: Number(e.target.value) || 0.5 } })}
          />
          <Input
            label="等级差加成因子"
            type="number"
            step="0.5"
            value={gameRules.combat_system.damage_formula?.level_bonus_factor ?? 2}
            onChange={(e) => updateCombatSystem({ damage_formula: { ...gameRules.combat_system.damage_formula, level_bonus_factor: Number(e.target.value) || 2 } })}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="伤害浮动下限"
            type="number"
            step="0.05"
            value={gameRules.combat_system.damage_formula?.variance_min ?? 0.9}
            onChange={(e) => updateCombatSystem({ damage_formula: { ...gameRules.combat_system.damage_formula, variance_min: Number(e.target.value) || 0.9 } })}
          />
          <Input
            label="伤害浮动范围"
            type="number"
            step="0.05"
            value={gameRules.combat_system.damage_formula?.variance_range ?? 0.2}
            onChange={(e) => updateCombatSystem({ damage_formula: { ...gameRules.combat_system.damage_formula, variance_range: Number(e.target.value) || 0.2 } })}
          />
          <Input
            label="敌人技能使用概率"
            type="number"
            step="0.05"
            value={gameRules.combat_system.enemy_ai?.skill_use_chance ?? 0.3}
            onChange={(e) => updateCombatSystem({ enemy_ai: { skill_use_chance: Number(e.target.value) || 0.3 } })}
          />
        </div>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] pt-2">默认值</h4>
        <div className="grid grid-cols-4 gap-3">
          <Input
            label="药水回复量"
            type="number"
            value={gameRules.combat_system.defaults?.potion_heal ?? 30}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, potion_heal: Number(e.target.value) || 30 } })}
          />
          <Input
            label="法力药水回复"
            type="number"
            value={gameRules.combat_system.defaults?.mana_potion_restore ?? 20}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, mana_potion_restore: Number(e.target.value) || 20 } })}
          />
          <Input
            label="技能默认消耗"
            type="number"
            value={gameRules.combat_system.defaults?.skill_cost_default ?? 10}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, skill_cost_default: Number(e.target.value) || 10 } })}
          />
          <Input
            label="技能伤害倍率"
            type="number"
            step="0.1"
            value={gameRules.combat_system.defaults?.skill_damage_multiplier ?? 1.5}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, skill_damage_multiplier: Number(e.target.value) || 1.5 } })}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="技能基础伤害因子"
            type="number"
            step="0.5"
            value={gameRules.combat_system.defaults?.skill_base_damage_factor ?? 2}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, skill_base_damage_factor: Number(e.target.value) || 2 } })}
          />
          <Input
            label="属性默认值"
            type="number"
            value={gameRules.combat_system.defaults?.attribute_fallback ?? 10}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, attribute_fallback: Number(e.target.value) || 10 } })}
          />
          <Input
            label="敌人速度因子"
            type="number"
            step="0.5"
            value={gameRules.combat_system.defaults?.enemy_speed_factor ?? 2}
            onChange={(e) => updateCombatSystem({ defaults: { ...gameRules.combat_system.defaults, enemy_speed_factor: Number(e.target.value) || 2 } })}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">技能系统</h3>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="最大等级"
            type="number"
            value={gameRules.skill_system.max_level}
            onChange={(e) => updateSkillSystem({ max_level: Number(e.target.value) || 10 })}
          />
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">冷却系统</label>
            <select
              value={gameRules.skill_system.cooldown_system}
              onChange={(e) => updateSkillSystem({ cooldown_system: e.target.value })}
              className={selectClass}
            >
              <option value="turn">回合制</option>
              <option value="time">时间制</option>
              <option value="none">无冷却</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="升级基础消耗"
            type="number"
            value={gameRules.skill_system.upgrade_cost.base}
            onChange={(e) => updateUpgradeCost({ base: Number(e.target.value) || 100 })}
          />
          <Input
            label="升级消耗倍率"
            type="number"
            step="0.1"
            value={gameRules.skill_system.upgrade_cost.multiplier}
            onChange={(e) => updateUpgradeCost({ multiplier: Number(e.target.value) || 1.5 })}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">背包系统</h3>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="最大槽位"
            type="number"
            value={gameRules.inventory_system.max_slots}
            onChange={(e) => updateInventorySystem({ max_slots: Number(e.target.value) || 20 })}
          />
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">重量系统</label>
            <label className="flex h-10 items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={gameRules.inventory_system.weight_system}
                onChange={(e) => updateInventorySystem({ weight_system: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              启用
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">堆叠数量</label>
          {Object.entries(gameRules.inventory_system.stack_sizes).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-secondary)]">{key}:</span>
              <span className="text-sm text-[var(--text-muted)]">{value}</span>
              <button
                type="button"
                onClick={() => handleRemoveStackSize(key)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--error)]"
              >
                删除
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              placeholder="物品类型"
              value={newStackSizeKey}
              onChange={(e) => setNewStackSizeKey(e.target.value)}
            />
            <Input
              placeholder="数量"
              type="number"
              value={newStackSizeValue}
              onChange={(e) => setNewStackSizeValue(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={handleAddStackSize}>
              添加
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">装备槽位</label>
          <p className="text-xs text-[var(--text-muted)]">
            定义装备槽位的ID、名称、图标和可接受的物品类型。JSON格式。
          </p>
          {(gameRules.inventory_system.equipment_slots ?? []).map((slot, index) => (
            <div key={slot.id} className="flex items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <span className="text-base">{slot.icon}</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">{resolveI18nKey(slot.name)}</span>
              <span className="text-xs text-[var(--text-muted)]">({slot.id})</span>
              <span className="text-xs text-[var(--text-muted)]">接受: {slot.accepted_item_types.join(', ')}</span>
              <button
                type="button"
                onClick={() => {
                  const newSlots = [...(gameRules.inventory_system.equipment_slots ?? [])];
                  newSlots.splice(index, 1);
                  updateInventorySystem({ equipment_slots: newSlots });
                }}
                className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--error)]"
              >
                删除
              </button>
            </div>
          ))}
          <div className="space-y-2">
            <textarea
              value={equipmentSlotsJson}
              onChange={(e) => setEquipmentSlotsJson(e.target.value)}
              rows={3}
              placeholder='[{"id":"slot_id","name":"槽位名","icon":"⚔","accepted_item_types":["weapon"]}]'
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  const parsed = JSON.parse(equipmentSlotsJson) as EquipmentSlotDefinition[];
                  if (Array.isArray(parsed)) {
                    updateInventorySystem({ equipment_slots: parsed });
                    setEquipmentSlotsJson('');
                  }
                } catch {
                  // JSON解析失败，忽略
                }
              }}
            >
              应用JSON
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">任务系统</h3>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="最大活跃任务"
            type="number"
            value={gameRules.quest_system.max_active}
            onChange={(e) => updateQuestSystem({ max_active: Number(e.target.value) || 10 })}
          />
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">时间系统</label>
            <label className="flex h-10 items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={gameRules.quest_system.time_system}
                onChange={(e) => updateQuestSystem({ time_system: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              启用
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">失败条件</label>
          <div className="flex flex-wrap gap-2">
            {gameRules.quest_system.fail_conditions.map((cond, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-primary)]"
              >
                {cond}
                <button
                  type="button"
                  onClick={() => handleRemoveFailCondition(i)}
                  className="ml-1 text-[var(--text-muted)] hover:text-[var(--error)]"
                >
                  x
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="输入失败条件"
              value={newFailCondition}
              onChange={(e) => setNewFailCondition(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddFailCondition();
                }
              }}
            />
            <Button size="sm" variant="outline" onClick={handleAddFailCondition}>
              添加
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">货币系统</h3>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="货币ID"
            value={gameRules.currency_system?.id ?? 'gold'}
            onChange={(e) => updateGameRules({
              ...gameRules,
              currency_system: { ...gameRules.currency_system, id: e.target.value || 'gold', name: gameRules.currency_system?.name ?? '金币', icon: gameRules.currency_system?.icon ?? '🪙' },
            })}
          />
          <Input
            label="货币名称"
            value={gameRules.currency_system?.name ?? '金币'}
            onChange={(e) => updateGameRules({
              ...gameRules,
              currency_system: { ...gameRules.currency_system, name: e.target.value || '金币' },
            })}
          />
          <Input
            label="货币图标"
            value={gameRules.currency_system?.icon ?? '🪙'}
            onChange={(e) => updateGameRules({
              ...gameRules,
              currency_system: { ...gameRules.currency_system, icon: e.target.value || '🪙' },
            })}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">自定义规则</h3>
          <Button size="sm" onClick={handleAddCustomRule}>
            添加规则
          </Button>
        </div>
        {gameRules.custom_rules.map((rule, index) => (
          <div
            key={index}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2"
          >
            <div className="flex items-start justify-between">
              <span className="text-sm text-[var(--text-muted)]">#{index + 1}</span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleRemoveCustomRule(index)}
              >
                删除
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="名称"
                value={rule.name}
                onChange={(e) => handleCustomRuleChange(index, 'name', e.target.value)}
              />
              <Input
                label="描述"
                value={rule.description}
                onChange={(e) => handleCustomRuleChange(index, 'description', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">数值复杂度</h3>
        <div className="flex flex-col">
          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">复杂度级别</label>
          <select
            value={editingTemplate.numerical_complexity}
            onChange={(e) => updateNestedField('numerical_complexity', e.target.value as NumericalComplexity)}
            className={selectClass}
          >
            <option value="simple">简单 - 简化的数值系统，适合新手玩家</option>
            <option value="medium">中等 - 平衡的数值复杂度，兼顾深度和易用性</option>
            <option value="complex">复杂 - 详细的数值系统，适合硬核玩家</option>
          </select>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)]/50 p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">特殊规则</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">KP系统</label>
            <label className="flex h-10 items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={specialRules.has_kp}
                onChange={(e) => updateSpecialRules({ ...specialRules, has_kp: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              启用
            </label>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">永久死亡</label>
            <label className="flex h-10 items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={specialRules.permadeath}
                onChange={(e) => updateSpecialRules({ ...specialRules, permadeath: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              启用
            </label>
          </div>
        </div>
        <div className="flex flex-col">
          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">存档限制</label>
          <select
            value={specialRules.save_restriction}
            onChange={(e) => updateSpecialRules({ ...specialRules, save_restriction: e.target.value as SaveRestrictionType })}
            className={selectClass}
          >
            <option value="free">无限制</option>
            <option value="checkpoint_only">仅检查点</option>
            <option value="manual_only">仅手动</option>
            <option value="ironman">铁人模式</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">自定义特殊规则</label>
          <div className="flex flex-wrap gap-2">
            {specialRules.custom_rules.map((rule, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-primary)]"
              >
                {rule}
                <button
                  type="button"
                  onClick={() => handleRemoveSpecialCustomRule(i)}
                  className="ml-1 text-[var(--text-muted)] hover:text-[var(--error)]"
                >
                  x
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="输入特殊规则"
              value={newSpecialRule}
              onChange={(e) => setNewSpecialRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddSpecialCustomRule();
                }
              }}
            />
            <Button size="sm" variant="outline" onClick={handleAddSpecialCustomRule}>
              添加
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
