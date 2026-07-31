import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type {
  StartingScene,
  NPCDefinition,
  NPCStats,
  ItemDefinition,
  ItemEffect,
  QuestDefinition,
  TemplateQuestObjective,
  TemplateQuestReward,
  ExplorableArea,
} from '@/types';

type SceneTab = 'npcs' | 'items' | 'quests' | 'areas';

const NPC_ROLE_OPTIONS = [
  { value: 'merchant', label: '商人' },
  { value: 'quest_giver', label: '任务发布者' },
  { value: 'enemy', label: '敌人' },
  { value: 'ally', label: '盟友' },
  { value: 'neutral', label: '中立' },
  { value: 'trainer', label: '训练师' },
  { value: 'informant', label: '情报员' },
  { value: 'party_candidate', label: '队友候选' },
  { value: 'event_trigger', label: '事件触发者' },
  { value: 'custom', label: '自定义' },
];

const NPC_SERVICE_OPTIONS = ['shop', 'inn', 'blacksmith', 'healing', 'training'];

const ITEM_TYPE_OPTIONS = [
  { value: 'weapon', label: '武器' },
  { value: 'armor', label: '护甲' },
  { value: 'accessory', label: '饰品' },
  { value: 'consumable', label: '消耗品' },
  { value: 'material', label: '材料' },
  { value: 'quest', label: '任务物品' },
  { value: 'misc', label: '杂项' },
];

const ITEM_RARITY_OPTIONS = [
  { value: 'common', label: '普通' },
  { value: 'uncommon', label: '优秀' },
  { value: 'rare', label: '稀有' },
  { value: 'epic', label: '史诗' },
  { value: 'legendary', label: '传说' },
  { value: 'unique', label: '独特' },
];

const QUEST_TYPE_OPTIONS = [
  { value: 'main', label: '主线' },
  { value: 'side', label: '支线' },
  { value: 'daily', label: '日常' },
  { value: 'hidden', label: '隐藏' },
];

const AREA_TYPE_OPTIONS = [
  { value: 'forest', label: '森林' },
  { value: 'dungeon', label: '地下城' },
  { value: 'city', label: '城市' },
  { value: 'wilderness', label: '荒野' },
  { value: 'building', label: '建筑' },
  { value: 'underground', label: '地下' },
  { value: 'water', label: '水域' },
  { value: 'social', label: '社交场所' },
  { value: 'combat', label: '战斗区域' },
  { value: 'town', label: '城镇' },
  { value: 'cave', label: '洞穴' },
];

const selectClass =
  'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

const tagInputClass =
  'h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none';

const defaultNpcStats: NPCStats = { level: 1, hp: 10, attack: 5, defense: 5, speed: 5, magic: 5 };

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

export function StartingSceneEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [activeTab, setActiveTab] = useState<SceneTab>('npcs');
  const [expandedNpcIdx, setExpandedNpcIdx] = useState<number | null>(null);
  const [expandedItemIdx, setExpandedItemIdx] = useState<number | null>(null);
  const [expandedQuestIdx, setExpandedQuestIdx] = useState<number | null>(null);

  const scene: StartingScene = editingTemplate?.starting_scene ?? {
    location: '',
    description: '',
    npcs: [],
    items: [],
    quests: [],
    explorable_areas: [],
  };

  const updateScene = useCallback(
    (updates: Partial<StartingScene>) => {
      updateNestedField('starting_scene', { ...scene, ...updates });
    },
    [scene, updateNestedField],
  );

  const handleAddNpc = useCallback(() => {
    const npc: NPCDefinition = {
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
    updateScene({ npcs: [...scene.npcs, npc] });
    setExpandedNpcIdx(scene.npcs.length);
  }, [scene, updateScene]);

  const updateNpc = useCallback(
    (index: number, updates: Partial<NPCDefinition>) => {
      const npcs = scene.npcs.map((npc, i) => (i === index ? { ...npc, ...updates } : npc));
      updateScene({ npcs });
    },
    [scene, updateScene],
  );

  const updateNpcStats = useCallback(
    (index: number, field: string, value: number) => {
      const npc = scene.npcs[index];
      if (!npc) return;
      updateNpc(index, { stats: { ...npc.stats, [field]: value } });
    },
    [scene.npcs, updateNpc],
  );

  const addNpcStatField = useCallback(
    (index: number, field: string) => {
      const npc = scene.npcs[index];
      if (!npc || npc.stats[field] !== undefined) return;
      updateNpc(index, { stats: { ...npc.stats, [field]: 0 } });
    },
    [scene.npcs, updateNpc],
  );

  const removeNpcStatField = useCallback(
    (index: number, field: string) => {
      const npc = scene.npcs[index];
      if (!npc) return;
      const newStats = { ...npc.stats };
      delete newStats[field];
      updateNpc(index, { stats: newStats });
    },
    [scene.npcs, updateNpc],
  );

  const handleAddItem = useCallback(() => {
    const item: ItemDefinition = {
      id: generateId('item'),
      name: '',
      description: '',
      category: 'misc',
      quality: 'common',
      stats: {},
      effects: [],
      value: { buy: 0, sell: 0, currency: 'gold' },
      quantity: 1,
      custom_data: {},
    };
    updateScene({ items: [...scene.items, item] });
    setExpandedItemIdx(scene.items.length);
  }, [scene, updateScene]);

  const updateItem = useCallback(
    (index: number, updates: Partial<ItemDefinition>) => {
      const items = scene.items.map((item, i) => (i === index ? { ...item, ...updates } : item));
      updateScene({ items });
    },
    [scene, updateScene],
  );

  const handleAddQuest = useCallback(() => {
    const quest: QuestDefinition = {
      id: generateId('quest'),
      name: '',
      description: '',
      type: 'main',
      objectives: [],
      rewards: [],
      giver: '',
      time_limit: 0,
      custom_data: {},
    };
    updateScene({ quests: [...scene.quests, quest] });
    setExpandedQuestIdx(scene.quests.length);
  }, [scene, updateScene]);

  const updateQuest = useCallback(
    (index: number, updates: Partial<QuestDefinition>) => {
      const quests = scene.quests.map((quest, i) => (i === index ? { ...quest, ...updates } : quest));
      updateScene({ quests });
    },
    [scene, updateScene],
  );

  const handleAddArea = useCallback(() => {
    const area: ExplorableArea = {
      id: generateId('area'),
      name: '',
      description: '',
      type: 'town',
      danger_level: 1,
      connections: [],
    };
    updateScene({ explorable_areas: [...scene.explorable_areas, area] });
  }, [scene, updateScene]);

  const updateArea = useCallback(
    (index: number, updates: Partial<ExplorableArea>) => {
      const areas = scene.explorable_areas.map((area, i) => (i === index ? { ...area, ...updates } : area));
      updateScene({ explorable_areas: areas });
    },
    [scene, updateScene],
  );

  if (!editingTemplate) return null;

  const tabs: { key: SceneTab; label: string; count: number }[] = [
    { key: 'npcs', label: 'NPC', count: scene.npcs.length },
    { key: 'items', label: '物品', count: scene.items.length },
    { key: 'quests', label: '任务', count: scene.quests.length },
    { key: 'areas', label: '可探索区域', count: scene.explorable_areas.length },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">地点信息</h3>
        <Input label="地点名称" value={scene.location} onChange={(e) => updateScene({ location: e.target.value })} placeholder="起始地点名称" />
        <div className="flex flex-col">
          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">场景描述</label>
          <textarea
            value={scene.description}
            onChange={(e) => updateScene({ description: e.target.value })}
            rows={4}
            placeholder="玩家开始时的场景描述..."
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-1 border-b border-[var(--border-primary)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {activeTab === 'npcs' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddNpc}>添加NPC</Button>
            </div>
            {scene.npcs.map((npc, index) => {
              const isExpanded = expandedNpcIdx === index;
              return (
                <div key={npc.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
                  <button
                    onClick={() => setExpandedNpcIdx(isExpanded ? null : index)}
                    className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{npc.name || `NPC #${index + 1}`}</span>
                      {npc.role && <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{npc.role}</span>}
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{isExpanded ? '收起' : '展开'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--border-primary)] p-4 space-y-3">
                      <div className="flex justify-end">
                        <Button variant="danger" size="sm" onClick={() => { updateScene({ npcs: scene.npcs.filter((_, i) => i !== index) }); setExpandedNpcIdx(null); }}>删除</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Input label="名称" value={npc.name} onChange={(e) => updateNpc(index, { name: e.target.value })} />
                        <Input label="头衔" value={npc.title} onChange={(e) => updateNpc(index, { title: e.target.value })} />
                      </div>
                      <Input label="描述" value={npc.description} onChange={(e) => updateNpc(index, { description: e.target.value })} />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">角色类型</label>
                          <select value={npc.role} onChange={(e) => updateNpc(index, { role: e.target.value })} className={selectClass}>
                            <option value="">选择角色类型</option>
                            {NPC_ROLE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                        <Input label="种族" value={npc.race} onChange={(e) => updateNpc(index, { race: e.target.value })} />
                      </div>
                      <Input label="外观" value={npc.appearance} onChange={(e) => updateNpc(index, { appearance: e.target.value })} placeholder="NPC的外貌描述" />
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">性格</label>
                        <textarea
                          value={npc.personality}
                          onChange={(e) => updateNpc(index, { personality: e.target.value })}
                          rows={2}
                          placeholder="NPC的性格特点..."
                          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">对话</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {npc.dialogue.map((line, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                              {line.length > 20 ? line.slice(0, 20) + '...' : line}
                              <button type="button" onClick={() => updateNpc(index, { dialogue: npc.dialogue.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)]">x</button>
                            </span>
                          ))}
                        </div>
                        <input
                          className={tagInputClass}
                          placeholder="输入对话后回车"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = (e.target as HTMLInputElement).value.trim();
                              if (val) { updateNpc(index, { dialogue: [...npc.dialogue, val] }); (e.target as HTMLInputElement).value = ''; }
                            }
                          }}
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">属性</label>
                        <div className="grid grid-cols-3 gap-2">
                          {Object.entries(npc.stats).map(([key, val]) => (
                            <div key={key} className="flex items-center gap-1">
                              <div className="flex flex-col flex-1">
                                <label className="mb-1 text-xs text-[var(--text-muted)]">{STAT_LABELS[key] || key}</label>
                                <input type="number" min={0} value={val} onChange={(e) => updateNpcStats(index, key, Number(e.target.value) || 0)} className="h-8 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]" />
                              </div>
                              <button type="button" onClick={() => removeNpcStatField(index, key)} className="mt-4 text-[var(--text-muted)] hover:text-[var(--error)] text-xs">x</button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-1.5 flex-wrap">
                          {['level', 'hp', 'mp', 'attack', 'defense', 'speed', 'magic', 'sanity', 'affection', 'critRate'].filter((k) => npc.stats[k] === undefined).map((k) => (
                            <button key={k} type="button" onClick={() => addNpcStatField(index, k)} className="rounded border border-dashed border-[var(--border-primary)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]">+ {STAT_LABELS[k] || k}</button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">服务</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {npc.services.map((svc, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                              {svc}
                              <button type="button" onClick={() => updateNpc(index, { services: npc.services.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)]">x</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {NPC_SERVICE_OPTIONS.filter((s) => !npc.services.includes(s)).map((svc) => (
                            <button key={svc} type="button" onClick={() => updateNpc(index, { services: [...npc.services, svc] })} className="rounded border border-dashed border-[var(--border-primary)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]">+ {svc}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'items' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddItem}>添加物品</Button>
            </div>
            {scene.items.map((item, index) => {
              const isExpanded = expandedItemIdx === index;
              return (
                <div key={item.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
                  <button
                    onClick={() => setExpandedItemIdx(isExpanded ? null : index)}
                    className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{item.name || `物品 #${index + 1}`}</span>
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{item.category}</span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{isExpanded ? '收起' : '展开'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--border-primary)] p-4 space-y-3">
                      <div className="flex justify-end">
                        <Button variant="danger" size="sm" onClick={() => { updateScene({ items: scene.items.filter((_, i) => i !== index) }); setExpandedItemIdx(null); }}>删除</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Input label="名称" value={item.name} onChange={(e) => updateItem(index, { name: e.target.value })} />
                        <div className="flex flex-col">
                          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
                          <select value={item.category} onChange={(e) => updateItem(index, { category: e.target.value })} className={selectClass}>
                            {ITEM_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <Input label="描述" value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">稀有度</label>
                          <select value={item.quality} onChange={(e) => updateItem(index, { quality: e.target.value })} className={selectClass}>
                            {ITEM_RARITY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                        <Input label="数量" type="number" min={1} value={item.quantity} onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 1 })} />
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">属性加成</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {Object.entries(item.stats).map(([key, val]) => (
                            <span key={key} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                              {key}: {val}
                              <button type="button" onClick={() => { const newStats = { ...item.stats }; delete newStats[key]; updateItem(index, { stats: newStats }); }} className="text-[var(--text-muted)] hover:text-[var(--error)]">x</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <input className={tagInputClass} placeholder="属性名" id={`stat-key-${index}`} />
                          <input className={tagInputClass} placeholder="数值" type="number" id={`stat-val-${index}`} />
                          <button type="button" onClick={() => {
                            const keyEl = document.getElementById(`stat-key-${index}`) as HTMLInputElement;
                            const valEl = document.getElementById(`stat-val-${index}`) as HTMLInputElement;
                            if (keyEl?.value.trim()) { updateItem(index, { stats: { ...item.stats, [keyEl.value.trim()]: Number(valEl?.value) || 0 } }); keyEl.value = ''; valEl.value = ''; }
                          }} className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)]">添加</button>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">效果</label>
                        <div className="space-y-1.5 mb-2">
                          {item.effects.map((eff, i) => (
                            <div key={i} className="flex items-center gap-2 rounded bg-[var(--bg-secondary)] px-2 py-1">
                              <span className="text-xs text-[var(--text-primary)]">{eff.type}: {eff.value}{eff.duration ? ` (${eff.duration}回合)` : ''}</span>
                              <button type="button" onClick={() => updateItem(index, { effects: item.effects.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs">x</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <input className={tagInputClass} placeholder="效果类型" id={`eff-type-${index}`} />
                          <input className={tagInputClass} placeholder="数值" type="number" id={`eff-val-${index}`} />
                          <button type="button" onClick={() => {
                            const typeEl = document.getElementById(`eff-type-${index}`) as HTMLInputElement;
                            const valEl = document.getElementById(`eff-val-${index}`) as HTMLInputElement;
                            if (typeEl?.value.trim()) { const newEff: ItemEffect = { type: typeEl.value.trim(), value: Number(valEl?.value) || 0 }; updateItem(index, { effects: [...item.effects, newEff] }); typeEl.value = ''; valEl.value = ''; }
                          }} className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)]">添加</button>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">价值</label>
                        <div className="grid grid-cols-3 gap-2">
                          <Input label="买入价" type="number" min={0} value={item.value.buy} onChange={(e) => updateItem(index, { value: { ...item.value, buy: Number(e.target.value) || 0 } })} />
                          <Input label="卖出价" type="number" min={0} value={item.value.sell} onChange={(e) => updateItem(index, { value: { ...item.value, sell: Number(e.target.value) || 0 } })} />
                          <Input label="货币" value={item.value.currency} onChange={(e) => updateItem(index, { value: { ...item.value, currency: e.target.value } })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'quests' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddQuest}>添加任务</Button>
            </div>
            {scene.quests.map((quest, index) => {
              const isExpanded = expandedQuestIdx === index;
              return (
                <div key={quest.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
                  <button
                    onClick={() => setExpandedQuestIdx(isExpanded ? null : index)}
                    className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{quest.name || `任务 #${index + 1}`}</span>
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{quest.type}</span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{isExpanded ? '收起' : '展开'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--border-primary)] p-4 space-y-3">
                      <div className="flex justify-end">
                        <Button variant="danger" size="sm" onClick={() => { updateScene({ quests: scene.quests.filter((_, i) => i !== index) }); setExpandedQuestIdx(null); }}>删除</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Input label="名称" value={quest.name} onChange={(e) => updateQuest(index, { name: e.target.value })} />
                        <div className="flex flex-col">
                          <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
                          <select value={quest.type} onChange={(e) => updateQuest(index, { type: e.target.value })} className={selectClass}>
                            {QUEST_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <Input label="描述" value={quest.description} onChange={(e) => updateQuest(index, { description: e.target.value })} />
                      <Input label="发布者" value={quest.giver} onChange={(e) => updateQuest(index, { giver: e.target.value })} placeholder="发布任务的NPC名称" />
                      <Input label="时间限制(回合, 0=无限制)" type="number" min={0} value={quest.time_limit} onChange={(e) => updateQuest(index, { time_limit: Number(e.target.value) || 0 })} />
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">目标</label>
                        <div className="space-y-1.5 mb-2">
                          {quest.objectives.map((obj, i) => (
                            <div key={i} className="flex items-center gap-2 rounded bg-[var(--bg-secondary)] px-2 py-1">
                              <span className="text-xs text-[var(--text-primary)]">{obj.description} ({obj.type}: {obj.target} x{obj.required})</span>
                              <button type="button" onClick={() => updateQuest(index, { objectives: quest.objectives.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs">x</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <input className={tagInputClass} placeholder="描述" id={`obj-desc-${index}`} />
                          <input className={tagInputClass} placeholder="类型" id={`obj-type-${index}`} />
                          <input className={tagInputClass} placeholder="目标" id={`obj-target-${index}`} />
                          <input className="h-8 w-16 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]" placeholder="数量" type="number" min={1} id={`obj-req-${index}`} />
                          <button type="button" onClick={() => {
                            const desc = (document.getElementById(`obj-desc-${index}`) as HTMLInputElement)?.value.trim();
                            const type = (document.getElementById(`obj-type-${index}`) as HTMLInputElement)?.value.trim();
                            const target = (document.getElementById(`obj-target-${index}`) as HTMLInputElement)?.value.trim();
                            const req = Number((document.getElementById(`obj-req-${index}`) as HTMLInputElement)?.value) || 1;
                            if (desc) { const newObj: TemplateQuestObjective = { id: generateId('obj'), description: desc, type: type || 'kill', target: target || '', required: req }; updateQuest(index, { objectives: [...quest.objectives, newObj] }); }
                          }} className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)]">添加</button>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">奖励</label>
                        <div className="space-y-1.5 mb-2">
                          {quest.rewards.map((rew, i) => (
                            <div key={i} className="flex items-center gap-2 rounded bg-[var(--bg-secondary)] px-2 py-1">
                              <span className="text-xs text-[var(--text-primary)]">{rew.type}: {rew.value}{rew.quantity ? ` x${rew.quantity}` : ''}</span>
                              <button type="button" onClick={() => updateQuest(index, { rewards: quest.rewards.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs">x</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <input className={tagInputClass} placeholder="类型" id={`rew-type-${index}`} />
                          <input className={tagInputClass} placeholder="值" id={`rew-val-${index}`} />
                          <button type="button" onClick={() => {
                            const type = (document.getElementById(`rew-type-${index}`) as HTMLInputElement)?.value.trim();
                            const val = (document.getElementById(`rew-val-${index}`) as HTMLInputElement)?.value.trim();
                            if (type) { const newRew: TemplateQuestReward = { type, value: val || 0 }; updateQuest(index, { rewards: [...quest.rewards, newRew] }); }
                          }} className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)]">添加</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'areas' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddArea}>添加区域</Button>
            </div>
            {scene.explorable_areas.map((area, index) => (
              <div key={area.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <span className="text-sm text-[var(--text-muted)]">#{index + 1}</span>
                  <Button variant="danger" size="sm" onClick={() => updateScene({ explorable_areas: scene.explorable_areas.filter((_, i) => i !== index) })}>删除</Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="名称" value={area.name} onChange={(e) => updateArea(index, { name: e.target.value })} />
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
                    <select value={area.type} onChange={(e) => updateArea(index, { type: e.target.value })} className={selectClass}>
                      {AREA_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>
                <Input label="描述" value={area.description} onChange={(e) => updateArea(index, { description: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="危险等级" type="number" min={1} max={10} value={area.danger_level} onChange={(e) => updateArea(index, { danger_level: Number(e.target.value) || 1 })} />
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">连接区域</label>
                    <div className="flex flex-wrap gap-1.5">
                      {area.connections.map((conn, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                          {conn}
                          <button type="button" onClick={() => updateArea(index, { connections: area.connections.filter((_, j) => j !== i) })} className="text-[var(--text-muted)] hover:text-[var(--error)]">x</button>
                        </span>
                      ))}
                      <input
                        className={tagInputClass}
                        placeholder="区域ID后回车"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val) { updateArea(index, { connections: [...area.connections, val] }); (e.target as HTMLInputElement).value = ''; }
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
