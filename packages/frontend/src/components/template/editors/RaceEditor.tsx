import { useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { RaceDefinition, CharacterCreationRules } from '@/types';

function createEmptyRace(): RaceDefinition {
  return {
    id: generateId('race'),
    name: '',
    description: '',
    bonuses: {},
    penalties: {},
    abilities: [],
    available_classes: [],
  };
}

export default function RaceEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bonusKey, setBonusKey] = useState('');
  const [penaltyKey, setPenaltyKey] = useState('');
  const [abilityInput, setAbilityInput] = useState('');
  const [classInput, setClassInput] = useState('');

  if (!editingTemplate) return null;

  const cc = editingTemplate.character_creation;
  const races = cc.races;

  const updateCC = (updates: Partial<CharacterCreationRules>) => {
    updateNestedField('character_creation', { ...cc, ...updates });
  };

  const updateRaces = (newRaces: RaceDefinition[]) => {
    updateCC({ races: newRaces });
  };

  const updateRace = (id: string, updates: Partial<RaceDefinition>) => {
    updateRaces(races.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const addRace = () => {
    const newRace = createEmptyRace();
    updateRaces([...races, newRace]);
    setExpandedId(newRace.id);
  };

  const removeRace = (id: string) => {
    updateRaces(races.filter((r) => r.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const addBonus = (raceId: string) => {
    const key = bonusKey.trim();
    if (!key) return;
    const race = races.find((r) => r.id === raceId);
    if (!race || key in race.bonuses) return;
    updateRace(raceId, { bonuses: { ...race.bonuses, [key]: 0 } });
    setBonusKey('');
  };

  const removeBonus = (raceId: string, key: string) => {
    const race = races.find((r) => r.id === raceId);
    if (!race) return;
    const { [key]: _, ...rest } = race.bonuses;
    updateRace(raceId, { bonuses: rest });
  };

  const updateBonusValue = (raceId: string, key: string, value: number) => {
    const race = races.find((r) => r.id === raceId);
    if (!race) return;
    updateRace(raceId, { bonuses: { ...race.bonuses, [key]: value } });
  };

  const addPenalty = (raceId: string) => {
    const key = penaltyKey.trim();
    if (!key) return;
    const race = races.find((r) => r.id === raceId);
    if (!race || key in race.penalties) return;
    updateRace(raceId, { penalties: { ...race.penalties, [key]: 0 } });
    setPenaltyKey('');
  };

  const removePenalty = (raceId: string, key: string) => {
    const race = races.find((r) => r.id === raceId);
    if (!race) return;
    const { [key]: _, ...rest } = race.penalties;
    updateRace(raceId, { penalties: rest });
  };

  const updatePenaltyValue = (raceId: string, key: string, value: number) => {
    const race = races.find((r) => r.id === raceId);
    if (!race) return;
    updateRace(raceId, { penalties: { ...race.penalties, [key]: value } });
  };

  const addAbility = (raceId: string) => {
    const ability = abilityInput.trim();
    if (!ability) return;
    const race = races.find((r) => r.id === raceId);
    if (!race || race.abilities.includes(ability)) return;
    updateRace(raceId, { abilities: [...race.abilities, ability] });
    setAbilityInput('');
  };

  const removeAbility = (raceId: string, ability: string) => {
    const race = races.find((r) => r.id === raceId);
    if (!race) return;
    updateRace(raceId, { abilities: race.abilities.filter((a) => a !== ability) });
  };

  const addAvailableClass = (raceId: string) => {
    const cls = classInput.trim();
    if (!cls) return;
    const race = races.find((r) => r.id === raceId);
    if (!race || (race.available_classes ?? []).includes(cls)) return;
    updateRace(raceId, { available_classes: [...(race.available_classes ?? []), cls] });
    setClassInput('');
  };

  const removeAvailableClass = (raceId: string, cls: string) => {
    const race = races.find((r) => r.id === raceId);
    if (!race) return;
    updateRace(raceId, { available_classes: (race.available_classes ?? []).filter((c) => c !== cls) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">种族列表</h3>
        <Button variant="outline" size="sm" onClick={addRace}>
          + 添加种族
        </Button>
      </div>

      {races.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">暂无种族，点击上方按钮添加</p>
      )}

      {races.map((race) => {
        const isExpanded = expandedId === race.id;
        return (
          <div key={race.id} className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] transition-colors text-left"
              onClick={() => setExpandedId(isExpanded ? null : race.id)}
            >
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {race.name || '未命名种族'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {isExpanded ? '收起' : '展开'}
              </span>
            </button>

            {isExpanded && (
              <div className="p-4 space-y-4 bg-[var(--bg-card)]/50">
                <div className="grid grid-cols-2 gap-4">
                  <Input label="种族ID" value={race.id} disabled />
                  <Input
                    label="种族名称"
                    value={race.name}
                    onChange={(e) => updateRace(race.id, { name: e.target.value })}
                    placeholder="如：精灵、矮人"
                  />
                </div>

                <div className="flex flex-col w-full">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">描述</label>
                  <textarea
                    value={race.description}
                    onChange={(e) => updateRace(race.id, { description: e.target.value })}
                    placeholder="种族描述"
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">属性加成</label>
                  {Object.entries(race.bonuses).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="min-w-[100px] text-sm text-[var(--text-muted)] font-mono">{key}</span>
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => updateBonusValue(race.id, key, Number(e.target.value))}
                        className="h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                      />
                      <Button variant="danger" size="sm" onClick={() => removeBonus(race.id, key)}>
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
                    <Button variant="outline" size="sm" onClick={() => addBonus(race.id)} disabled={!bonusKey.trim()}>
                      添加加成
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">属性惩罚</label>
                  {Object.entries(race.penalties).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="min-w-[100px] text-sm text-[var(--text-muted)] font-mono">{key}</span>
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => updatePenaltyValue(race.id, key, Number(e.target.value))}
                        className="h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                      />
                      <Button variant="danger" size="sm" onClick={() => removePenalty(race.id, key)}>
                        删除
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input
                      value={penaltyKey}
                      onChange={(e) => setPenaltyKey(e.target.value)}
                      placeholder="属性名"
                    />
                    <Button variant="outline" size="sm" onClick={() => addPenalty(race.id)} disabled={!penaltyKey.trim()}>
                      添加惩罚
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">种族能力</label>
                  <div className="flex flex-wrap gap-2">
                    {race.abilities.map((ability) => (
                      <span
                        key={ability}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent)]/15 text-[var(--text-primary)] text-xs font-medium"
                      >
                        {ability}
                        <button
                          type="button"
                          className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                          onClick={() => removeAbility(race.id, ability)}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={abilityInput}
                      onChange={(e) => setAbilityInput(e.target.value)}
                      placeholder="能力名称"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addAbility(race.id);
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => addAbility(race.id)} disabled={!abilityInput.trim()}>
                      添加
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">可选职业</label>
                  <div className="flex flex-wrap gap-2">
                    {(race.available_classes ?? []).map((cls) => (
                      <span
                        key={cls}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-yellow-500/15 text-yellow-400 text-xs font-medium"
                      >
                        {cls}
                        <button
                          type="button"
                          className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                          onClick={() => removeAvailableClass(race.id, cls)}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={classInput}
                      onChange={(e) => setClassInput(e.target.value)}
                      placeholder="职业名称"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addAvailableClass(race.id);
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => addAvailableClass(race.id)} disabled={!classInput.trim()}>
                      添加
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="danger" size="sm" onClick={() => removeRace(race.id)}>
                    删除种族
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
