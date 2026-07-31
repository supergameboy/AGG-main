import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { AIConstraints, AIBehavior } from '@/types';

export function AIConstraintsEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [newProhibitedTopic, setNewProhibitedTopic] = useState('');
  const [newRequiredElement, setNewRequiredElement] = useState('');

  const aiConstraints: AIConstraints = editingTemplate?.ai_constraints ?? {
    tone: 'serious',
    custom_tone: '',
    content_rating: 'everyone',
    prohibited_topics: [],
    required_elements: [],
    ai_behavior: {
      response_style: 'narrative',
      detail_level: 'normal',
      player_agency: 'balanced',
    },
  };

  const updateConstraints = useCallback(
    (constraints: AIConstraints) => {
      updateNestedField('ai_constraints', constraints);
    },
    [updateNestedField]
  );

  const updateAIBehavior = useCallback(
    (updates: Partial<AIBehavior>) => {
      updateConstraints({
        ...aiConstraints,
        ai_behavior: { ...aiConstraints.ai_behavior, ...updates },
      });
    },
    [aiConstraints, updateConstraints]
  );

  const handleAddProhibitedTopic = useCallback(() => {
    const topic = newProhibitedTopic.trim();
    if (!topic) return;
    updateConstraints({
      ...aiConstraints,
      prohibited_topics: [...aiConstraints.prohibited_topics, topic],
    });
    setNewProhibitedTopic('');
  }, [aiConstraints, newProhibitedTopic, updateConstraints]);

  const handleRemoveProhibitedTopic = useCallback(
    (index: number) => {
      updateConstraints({
        ...aiConstraints,
        prohibited_topics: aiConstraints.prohibited_topics.filter((_, i) => i !== index),
      });
    },
    [aiConstraints, updateConstraints]
  );

  const handleAddRequiredElement = useCallback(() => {
    const element = newRequiredElement.trim();
    if (!element) return;
    updateConstraints({
      ...aiConstraints,
      required_elements: [...aiConstraints.required_elements, element],
    });
    setNewRequiredElement('');
  }, [aiConstraints, newRequiredElement, updateConstraints]);

  const handleRemoveRequiredElement = useCallback(
    (index: number) => {
      updateConstraints({
        ...aiConstraints,
        required_elements: aiConstraints.required_elements.filter((_, i) => i !== index),
      });
    },
    [aiConstraints, updateConstraints]
  );

  if (!editingTemplate) return null;

  const selectClass =
    'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">基调与风格</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">基调</label>
            <select
              value={aiConstraints.tone}
              onChange={(e) => updateConstraints({ ...aiConstraints, tone: e.target.value })}
              className={selectClass}
            >
              <option value="serious">严肃</option>
              <option value="humorous">幽默</option>
              <option value="dark">黑暗</option>
              <option value="romantic">浪漫</option>
              <option value="heroic">英雄</option>
              <option value="neutral">中性</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">内容分级</label>
            <select
              value={aiConstraints.content_rating}
              onChange={(e) => updateConstraints({ ...aiConstraints, content_rating: e.target.value })}
              className={selectClass}
            >
              <option value="everyone">全年龄</option>
              <option value="teen">青少年</option>
              <option value="mature">成人</option>
            </select>
          </div>
        </div>
        {aiConstraints.tone === 'custom' && (
          <Input
            label="自定义基调"
            value={aiConstraints.custom_tone}
            onChange={(e) => updateConstraints({ ...aiConstraints, custom_tone: e.target.value })}
          />
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">禁止主题</h3>
        <div className="flex flex-wrap gap-2">
          {aiConstraints.prohibited_topics.map((topic, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--error)]/15 px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
            >
              {topic}
              <button
                type="button"
                onClick={() => handleRemoveProhibitedTopic(i)}
                className="ml-1 text-[var(--text-muted)] hover:text-[var(--error)]"
              >
                x
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="输入禁止主题"
            value={newProhibitedTopic}
            onChange={(e) => setNewProhibitedTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddProhibitedTopic();
              }
            }}
          />
          <Button size="sm" variant="outline" onClick={handleAddProhibitedTopic}>
            添加
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">必要元素</h3>
        <div className="flex flex-wrap gap-2">
          {aiConstraints.required_elements.map((element, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
            >
              {element}
              <button
                type="button"
                onClick={() => handleRemoveRequiredElement(i)}
                className="ml-1 text-[var(--text-muted)] hover:text-[var(--accent)]"
              >
                x
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="输入必要元素"
            value={newRequiredElement}
            onChange={(e) => setNewRequiredElement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddRequiredElement();
              }
            }}
          />
          <Button size="sm" variant="outline" onClick={handleAddRequiredElement}>
            添加
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI行为</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">回复风格</label>
            <select
              value={aiConstraints.ai_behavior.response_style}
              onChange={(e) => updateAIBehavior({ response_style: e.target.value })}
              className={selectClass}
            >
              <option value="narrative">叙事</option>
              <option value="mechanical">机械</option>
              <option value="adaptive">自适应</option>
              <option value="noir">黑色电影</option>
              <option value="wuxia">武侠</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">细节等级</label>
            <select
              value={aiConstraints.ai_behavior.detail_level}
              onChange={(e) => updateAIBehavior({ detail_level: e.target.value })}
              className={selectClass}
            >
              <option value="low">简略</option>
              <option value="normal">正常</option>
              <option value="high">详细</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">玩家自由度</label>
            <select
              value={aiConstraints.ai_behavior.player_agency}
              onChange={(e) => updateAIBehavior({ player_agency: e.target.value })}
              className={selectClass}
            >
              <option value="guided">引导</option>
              <option value="balanced">平衡</option>
              <option value="freeform">自由</option>
              <option value="high">极高</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
