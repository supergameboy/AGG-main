import { useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import type { StoryTemplate } from '@/types';

type PreviewTab = 'character' | 'scene';

const RARITY_COLORS: Record<string, string> = {
  common: 'text-[var(--text-primary)]',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  epic: 'text-purple-400',
  legendary: 'text-yellow-400',
  unique: 'text-red-400',
};

export function PreviewTestEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const [activeTab, setActiveTab] = useState<PreviewTab>('character');

  if (!editingTemplate) return null;

  const template = editingTemplate as StoryTemplate;
  const cc = template.character_creation;
  const scene = template.starting_scene;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">预览测试</h3>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--border-primary)]">
        <button
          onClick={() => setActiveTab('character')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'character' ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          角色创建预览
        </button>
        <button
          onClick={() => setActiveTab('scene')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'scene' ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          初始场景预览
        </button>
      </div>

      {activeTab === 'character' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">种族 ({cc?.races?.length ?? 0})</h4>
            {cc?.races?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {cc.races.map((race) => (
                  <div key={race.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{race.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">ID: {race.id}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{race.description}</p>
                    {race.bonuses && Object.keys(race.bonuses).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(race.bonuses).map(([key, val]) => (
                          <span key={key} className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-400">
                            {key}: +{val}
                          </span>
                        ))}
                      </div>
                    )}
                    {race.penalties && Object.keys(race.penalties).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(race.penalties).map(([key, val]) => (
                          <span key={key} className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-400">
                            {key}: {val}
                          </span>
                        ))}
                      </div>
                    )}
                    {race.abilities && race.abilities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {race.abilities.map((ability, i) => (
                          <span key={`${ability}-${i}`} className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{ability}</span>
                        ))}
                      </div>
                    )}
                    {race.available_classes && race.available_classes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">可选职业:</span>
                        {(race.available_classes ?? []).map((cls, i) => (
                          <span key={`${cls}-${i}`} className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">{cls}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无种族定义</p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">职业 ({cc?.classes?.length ?? 0})</h4>
            {cc?.classes?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {cc.classes.map((cls) => (
                  <div key={cls.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{cls.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">ID: {cls.id}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{cls.description}</p>
                    {cls.hit_die && (
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">生命骰: {cls.hit_die}</span>
                    )}
                    {cls.primary_attributes && cls.primary_attributes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">主属性:</span>
                        {cls.primary_attributes.map((attr, i) => (
                          <span key={`${attr}-${i}`} className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{attr}</span>
                        ))}
                      </div>
                    )}
                    {cls.skill_proficiencies && cls.skill_proficiencies.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">技能:</span>
                        {cls.skill_proficiencies.map((skill, i) => (
                          <span key={`${skill}-${i}`} className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{skill}</span>
                        ))}
                      </div>
                    )}
                    {cls.starting_equipment && cls.starting_equipment.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">初始装备:</span>
                        {cls.starting_equipment.map((eq, i) => (
                          <span key={`${eq}-${i}`} className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">{eq}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无职业定义</p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">背景 ({cc?.backgrounds?.length ?? 0})</h4>
            {cc?.backgrounds?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {cc.backgrounds.map((bg) => (
                  <div key={bg.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{bg.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">ID: {bg.id}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{bg.description}</p>
                    {bg.feature && (
                      <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/50 p-2">
                        <p className="text-xs font-medium text-[var(--text-secondary)]">特性</p>
                        <p className="text-xs text-[var(--text-muted)]">{bg.feature}</p>
                      </div>
                    )}
                    {bg.skill_proficiencies && bg.skill_proficiencies.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">技能:</span>
                        {bg.skill_proficiencies.map((skill, i) => (
                          <span key={`${skill}-${i}`} className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{skill}</span>
                        ))}
                      </div>
                    )}
                    {bg.languages && bg.languages.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">语言:</span>
                        {bg.languages.map((lang, i) => (
                          <span key={`${lang}-${i}`} className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400">{lang}</span>
                        ))}
                      </div>
                    )}
                    {bg.equipment && bg.equipment.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-[var(--text-muted)]">装备:</span>
                        {bg.equipment.map((eq, i) => (
                          <span key={`${eq}-${i}`} className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">{eq}</span>
                        ))}
                      </div>
                    )}
                    {bg.attribute_bonuses && Object.keys(bg.attribute_bonuses).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(bg.attribute_bonuses).map(([key, val]) => (
                          <span key={key} className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-400">
                            {key}: +{val}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无背景定义</p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">属性 ({cc?.attributes?.length ?? 0}) · 可分配点数: {cc?.attribute_points ?? 0}</h4>
            {cc?.attributes?.length ? (
              <div className="grid gap-2 grid-cols-3 sm:grid-cols-6">
                {cc.attributes.map((attr) => (
                  <div key={attr.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-2 text-center">
                    <p className="text-xs text-[var(--text-muted)]">{attr.abbreviation}</p>
                    <p className="text-lg font-bold text-[var(--text-primary)]">{attr.default_value}</p>
                    <p className="text-xs text-[var(--text-muted)]">{attr.name}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无属性定义</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'scene' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">起始地点</h4>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
              <p className="text-base font-medium text-[var(--text-primary)]">{scene?.location || '未设置'}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{scene?.description || '无描述'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">NPC ({scene?.npcs?.length ?? 0})</h4>
            {scene?.npcs?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {scene.npcs.map((npc) => (
                  <div key={npc.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{npc.name}</span>
                      {npc.role && <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{npc.role}</span>}
                    </div>
                    {npc.title && <p className="text-xs text-[var(--text-muted)]">{npc.title}</p>}
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{npc.description}</p>
                    {npc.stats && (
                      <div className="flex gap-2 text-xs text-[var(--text-muted)]">
                        <span>Lv.{npc.stats.level}</span>
                        <span>HP:{npc.stats.hp}</span>
                        <span>ATK:{npc.stats.attack}</span>
                        <span>DEF:{npc.stats.defense}</span>
                      </div>
                    )}
                    {npc.services && npc.services.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {npc.services.map((svc, i) => (
                          <span key={`${svc}-${i}`} className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{svc}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无NPC定义</p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">物品 ({scene?.items?.length ?? 0})</h4>
            {scene?.items?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {scene.items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${RARITY_COLORS[item.quality] || 'text-[var(--text-primary)]'}`}>{item.name}</span>
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{item.category}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{item.description}</p>
                    {item.value && (
                      <span className="text-xs text-yellow-400">买入: {item.value.buy} · 卖出: {item.value.sell}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无物品定义</p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">任务 ({scene?.quests?.length ?? 0})</h4>
            {scene?.quests?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {scene.quests.map((quest) => (
                  <div key={quest.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{quest.name}</span>
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{quest.type}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{quest.description}</p>
                    {quest.objectives && quest.objectives.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-[var(--text-secondary)]">目标:</p>
                        {quest.objectives.map((obj, i) => (
                          <p key={i} className="text-xs text-[var(--text-muted)] pl-2">· {obj.description}</p>
                        ))}
                      </div>
                    )}
                    {quest.rewards && quest.rewards.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {quest.rewards.map((rew, i) => (
                          <span key={i} className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">{rew.type}: {rew.value}</span>
                        ))}
                      </div>
                    )}
                    {quest.giver && <p className="text-xs text-[var(--text-muted)]">发布者: {quest.giver}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无任务定义</p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-secondary)]">可探索区域 ({scene?.explorable_areas?.length ?? 0})</h4>
            {scene?.explorable_areas?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {scene.explorable_areas.map((area) => (
                  <div key={area.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{area.name}</span>
                      <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">{area.type}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{area.description}</p>
                    <span className="text-xs text-[var(--text-muted)]">危险等级: {area.danger_level}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无可探索区域</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
