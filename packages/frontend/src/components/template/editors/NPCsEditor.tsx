import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { NPCDefinition, NPCStats } from '@/types';

const NPC_ROLE_OPTIONS = [
  { value: 'merchant', label: '商人' },
  { value: 'quest_giver', label: '任务发布者' },
  { value: 'trainer', label: '训练师' },
  { value: 'informant', label: '情报员' },
  { value: 'neutral', label: '中立' },
  { value: 'party_candidate', label: '队友候选' },
  { value: 'event_trigger', label: '事件触发者' },
];

const NPC_SERVICE_OPTIONS = ['shop', 'inn', 'blacksmith', 'healing', 'training'];

const STAT_LABELS: Record<string, string> = {
  level: '等级',
  hp: '生命值',
  mp: '法力值',
  attack: '攻击力',
  defense: '防御力',
  speed: '速度',
  magic: '魔法力',
  atk: '攻击力',
  def: '防御力',
  sanity: '理智值',
  affection: '好感度',
  critRate: '暴击率',
  critDamage: '暴击伤害',
  dodgeRate: '闪避率',
  blockRate: '格挡率',
  magicAttack: '魔攻',
  magicDefense: '魔防',
};

const selectClass =
  'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

const tagInputClass =
  'h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none';

const defaultNpcStats: NPCStats = { level: 1, hp: 10, attack: 5, defense: 5, speed: 5, magic: 5 };

function createDefaultNPC(): NPCDefinition {
  return {
    id: generateId('npc'),
    name: '',
    title: '',
    description: '',
    role: '',
    race: '',
    appearance: '',
    personality: '',
    dialogue: [],
    stats: { ...defaultNpcStats },
    services: [],
    custom_data: {},
  };
}

export function NPCsEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const npcs: NPCDefinition[] = editingTemplate?.starting_scene?.npcs ?? [];

  const updateNpcs = useCallback(
    (newNpcs: NPCDefinition[]) => {
      updateNestedField('starting_scene', {
        ...editingTemplate!.starting_scene,
        npcs: newNpcs,
      });
    },
    [editingTemplate, updateNestedField],
  );

  const handleAdd = useCallback(() => {
    const npc = createDefaultNPC();
    updateNpcs([...npcs, npc]);
    setExpandedIdx(npcs.length);
  }, [npcs, updateNpcs]);

  const updateNpc = useCallback(
    (index: number, updates: Partial<NPCDefinition>) => {
      const newNpcs = npcs.map((npc, i) => (i === index ? { ...npc, ...updates } : npc));
      updateNpcs(newNpcs);
    },
    [npcs, updateNpcs],
  );

  const updateNpcStats = useCallback(
    (index: number, field: string, value: number) => {
      const npc = npcs[index];
      if (!npc) return;
      updateNpc(index, { stats: { ...npc.stats, [field]: value } });
    },
    [npcs, updateNpc],
  );

  const addNpcStatField = useCallback(
    (index: number, field: string) => {
      const npc = npcs[index];
      if (!npc || npc.stats[field] !== undefined) return;
      updateNpc(index, { stats: { ...npc.stats, [field]: 0 } });
    },
    [npcs, updateNpc],
  );

  const removeNpcStatField = useCallback(
    (index: number, field: string) => {
      const npc = npcs[index];
      if (!npc) return;
      const newStats = { ...npc.stats };
      delete newStats[field];
      updateNpc(index, { stats: newStats });
    },
    [npcs, updateNpc],
  );

  if (!editingTemplate) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">NPC定义</h3>
        <Button size="sm" onClick={handleAdd}>
          添加NPC
        </Button>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        定义起始场景中的NPC。NPC将在游戏开始时出现在起始地点。
      </p>

      {npcs.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">暂无NPC，点击"添加NPC"开始定义</p>
        </div>
      )}

      {npcs.map((npc, index) => {
        const isExpanded = expandedIdx === index;
        return (
          <div
            key={npc.id}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden"
          >
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : index)}
              className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {npc.name || `NPC #${index + 1}`}
                </span>
                {npc.role && (
                  <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                    {NPC_ROLE_OPTIONS.find((o) => o.value === npc.role)?.label ?? npc.role}
                  </span>
                )}
                {npc.race && (
                  <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                    {npc.race}
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
                      updateNpcs(npcs.filter((_, i) => i !== index));
                      setExpandedIdx(null);
                    }}
                  >
                    删除
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="名称"
                    value={npc.name}
                    onChange={(e) => updateNpc(index, { name: e.target.value })}
                    placeholder="NPC名称"
                  />
                  <Input
                    label="头衔"
                    value={npc.title}
                    onChange={(e) => updateNpc(index, { title: e.target.value })}
                    placeholder="NPC头衔"
                  />
                </div>

                <Input
                  label="描述"
                  value={npc.description}
                  onChange={(e) => updateNpc(index, { description: e.target.value })}
                  placeholder="NPC描述"
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">角色类型</label>
                    <select
                      value={npc.role}
                      onChange={(e) => updateNpc(index, { role: e.target.value })}
                      className={selectClass}
                    >
                      <option value="">选择角色类型</option>
                      {NPC_ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="种族"
                    value={npc.race}
                    onChange={(e) => updateNpc(index, { race: e.target.value })}
                    placeholder="NPC种族"
                  />
                </div>

                <Input
                  label="等级"
                  type="number"
                  min={1}
                  value={npc.stats.level ?? 1}
                  onChange={(e) => updateNpcStats(index, 'level', Number(e.target.value) || 1)}
                />

                <div className="flex flex-col">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">属性</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(npc.stats).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-1">
                        <div className="flex flex-col flex-1">
                          <label className="mb-1 text-xs text-[var(--text-muted)]">
                            {STAT_LABELS[key] || key}
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={val}
                            onChange={(e) => updateNpcStats(index, key, Number(e.target.value) || 0)}
                            className="h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNpcStatField(index, key)}
                          className="mt-4 text-[var(--text-muted)] hover:text-[var(--error)] text-xs"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {['level', 'hp', 'mp', 'attack', 'defense', 'speed', 'magic', 'sanity', 'affection', 'critRate']
                      .filter((k) => npc.stats[k] === undefined)
                      .map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => addNpcStatField(index, k)}
                          className="rounded border border-dashed border-[var(--border-primary)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          + {STAT_LABELS[k] || k}
                        </button>
                      ))}
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">服务</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {npc.services.map((svc, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]"
                      >
                        {svc}
                        <button
                          type="button"
                          onClick={() =>
                            updateNpc(index, { services: npc.services.filter((_, j) => j !== i) })
                          }
                          className="text-[var(--text-muted)] hover:text-[var(--error)]"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {NPC_SERVICE_OPTIONS.filter((s) => !npc.services.includes(s)).map((svc) => (
                      <button
                        key={svc}
                        type="button"
                        onClick={() => updateNpc(index, { services: [...npc.services, svc] })}
                        className="rounded border border-dashed border-[var(--border-primary)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        + {svc}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">对话</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {npc.dialogue.map((line, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]"
                      >
                        {line.length > 20 ? line.slice(0, 20) + '...' : line}
                        <button
                          type="button"
                          onClick={() =>
                            updateNpc(index, { dialogue: npc.dialogue.filter((_, j) => j !== i) })
                          }
                          className="text-[var(--text-muted)] hover:text-[var(--error)]"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    className={tagInputClass}
                    placeholder="输入对话后回车"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          updateNpc(index, { dialogue: [...npc.dialogue, val] });
                          (e.target as HTMLInputElement).value = '';
                        }
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
