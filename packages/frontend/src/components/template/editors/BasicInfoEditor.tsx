import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTemplateStore } from '@/stores/templateStore';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { ChallengeMode, GameMode } from '@/types';
import { CHALLENGE_MODE_LABELS, RECOMMENDED_CHALLENGE_MODE } from '@/utils/entityMapper';

const GAME_MODE_OPTIONS: { value: GameMode; label: string }[] = [
  { value: 'text_adventure', label: '文字冒险' },
  { value: 'text_rpg', label: '文字RPG' },
  { value: 'visual_novel', label: '视觉小说' },
  { value: 'rpg_2d', label: '2DRPG' },
  { value: 'sandbox', label: '沙盒模式' },
  { value: 'story', label: '故事模式' },
];

const CHALLENGE_MODE_OPTIONS: { value: ChallengeMode; label: string }[] = [
  { value: 'narrative_combat', label: CHALLENGE_MODE_LABELS.narrative_combat },
  { value: 'turn_based_combat', label: CHALLENGE_MODE_LABELS.turn_based_combat },
  { value: 'dynamic_combat', label: CHALLENGE_MODE_LABELS.dynamic_combat },
  { value: 'puzzle', label: CHALLENGE_MODE_LABELS.puzzle },
  { value: 'mini_game', label: CHALLENGE_MODE_LABELS.mini_game },
  { value: 'stealth', label: CHALLENGE_MODE_LABELS.stealth },
];

export default function BasicInfoEditor() {
  const { t } = useTranslation('template');
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const profiles = useAgentProfileStore((s) => s.profiles);
  const fetchProfiles = useAgentProfileStore((s) => s.fetchProfiles);
  const [tagInput, setTagInput] = useState('');
  // 跟踪用户是否手动修改过 default_challenge_mode（用于 game_mode 切换时自动推荐）
  const userTouchedChallengeMode = useRef(false);

  useEffect(() => {
    if (profiles.length === 0) {
      fetchProfiles();
    }
  }, [profiles.length, fetchProfiles]);

  // 初始化时若 default_challenge_mode 已有值，视为用户已选定
  useEffect(() => {
    if (editingTemplate?.default_challenge_mode) {
      userTouchedChallengeMode.current = true;
    }
  }, [editingTemplate?.default_challenge_mode]);

  if (!editingTemplate) return null;

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || editingTemplate.tags.includes(tag)) return;
    updateNestedField('tags', [...editingTemplate.tags, tag]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    updateNestedField('tags', editingTemplate.tags.filter((t2) => t2 !== tag));
  };

  const handleGameModeChange = (value: GameMode) => {
    updateNestedField('game_mode', value);
    // 用户未手动修改 default_challenge_mode 时，按 game_mode 推荐默认值
    if (!userTouchedChallengeMode.current) {
      updateNestedField('default_challenge_mode', RECOMMENDED_CHALLENGE_MODE[value]);
    }
  };

  const handleChallengeModeChange = (value: ChallengeMode | undefined) => {
    userTouchedChallengeMode.current = true;
    updateNestedField('default_challenge_mode', value);
  };

  const selectClass = 'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

  return (
    <div className="space-y-5">
      <Input
        label="模板名称"
        value={editingTemplate.name}
        onChange={(e) => updateNestedField('name', e.target.value)}
        placeholder="输入模板名称"
      />

      <div className="flex flex-col w-full">
        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">模板描述</label>
        <textarea
          value={editingTemplate.description}
          onChange={(e) => updateNestedField('description', e.target.value)}
          placeholder="输入模板描述"
          rows={3}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="版本号"
          value={editingTemplate.version}
          onChange={(e) => updateNestedField('version', e.target.value)}
          placeholder="1.0.0"
        />
        <Input
          label="作者"
          value={editingTemplate.author}
          onChange={(e) => updateNestedField('author', e.target.value)}
          placeholder="输入作者名称"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">标签</label>
        <div className="flex flex-wrap gap-2">
          {editingTemplate.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent)]/15 text-[var(--text-primary)] text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                onClick={() => removeTag(tag)}
              >
                x
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="输入标签后按回车添加"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={addTag} disabled={!tagInput.trim()}>
            添加
          </Button>
        </div>
      </div>

      <div className="flex flex-col w-full">
        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">游戏模式</label>
        <select
          value={editingTemplate.game_mode}
          onChange={(e) => handleGameModeChange(e.target.value as GameMode)}
          className={selectClass}
        >
          {GAME_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col w-full">
        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">
          {t('challengeMode.defaultLabel', '默认挑战模式')}
        </label>
        <select
          value={editingTemplate.default_challenge_mode ?? ''}
          onChange={(e) => handleChallengeModeChange((e.target.value || undefined) as ChallengeMode | undefined)}
          className={selectClass}
        >
          <option value="">{t('challengeMode.auto', '自动推断')}</option>
          {CHALLENGE_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t('challengeMode.hint', '留空则由系统按游戏模式自动推断')}
        </p>
      </div>

      <div className="flex flex-col w-full">
        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">Agent Profile</label>
        <select
          value={editingTemplate.agent_profile ?? ''}
          onChange={(e) => updateNestedField('agent_profile', e.target.value)}
          className={selectClass}
        >
          <option value="">默认</option>
          {profiles.map((profile) => (
            <option key={profile.name} value={profile.name}>
              {profile.name} {profile.is_builtin ? '(内置)' : ''} - {profile.description?.slice(0, 30) || '无描述'}
            </option>
          ))}
        </select>
        {editingTemplate.agent_profile && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            当前关联: {editingTemplate.agent_profile} ·{' '}
            {(() => {
              const p = profiles.find((pr) => pr.name === editingTemplate.agent_profile);
              return p ? `${Object.keys(p.agents || {}).length} 个Agent` : '未找到';
            })()}
          </p>
        )}
      </div>
    </div>
  );
}
