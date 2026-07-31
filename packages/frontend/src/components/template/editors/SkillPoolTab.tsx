import { useState, useEffect, useCallback, useMemo } from 'react';
import { SparklesIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTemplateStore } from '@/stores/templateStore';
import { Button } from '@/components/ui/Button';
import { PoolEntryCard } from './PoolEntryCard';
import { PoolEntryForm, createEmptySkillForm } from './PoolEntryForm';
import type { SkillFormData } from './PoolEntryForm';
import type { TemplateSkillPoolEntry } from '@/types';

// Default skill categories used for generation when template has no specific categories
const DEFAULT_SKILL_CATEGORIES = [
  { value: 'attack', label: '攻击' },
  { value: 'defense', label: '防御' },
  { value: 'healing', label: '治疗' },
  { value: 'buff', label: '增益' },
  { value: 'debuff', label: '减益' },
  { value: 'utility', label: '辅助' },
  { value: 'passive', label: '被动' },
];

const selectClass =
  'h-9 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

function entryToForm(entry: TemplateSkillPoolEntry): SkillFormData {
  return {
    name: entry.name ?? '',
    category: entry.category ?? 'attack',
    element: entry.element ?? 'physical',
    icon: entry.icon ?? '',
    description: entry.description ?? '',
    recommendedClasses: (entry.recommendedClasses ?? []).join(', '),
    source: entry.source ?? '',
  };
}

export function SkillPoolTab() {
  const currentTemplateId = useTemplateStore((s) => s.currentTemplateId);
  const templates = useTemplateStore((s) => s.templates);
  const skillPool = useTemplateStore((s) => s.skillPool);
  const poolLoading = useTemplateStore((s) => s.poolLoading);
  const poolGenerating = useTemplateStore((s) => s.poolGenerating);
  const pendingGeneratedSkills = useTemplateStore((s) => s.pendingGeneratedSkills);
  const isReviewingGeneration = useTemplateStore((s) => s.isReviewingGeneration);
  const fetchSkillPool = useTemplateStore((s) => s.fetchSkillPool);
  const addSkillToPool = useTemplateStore((s) => s.addSkillToPool);
  const updateSkillInPool = useTemplateStore((s) => s.updateSkillInPool);
  const removeSkillFromPool = useTemplateStore((s) => s.removeSkillFromPool);
  const generateSkillPool = useTemplateStore((s) => s.generateSkillPool);
  const commitAndContinueSkillPool = useTemplateStore((s) => s.commitAndContinueSkillPool);
  const endSkillPoolGeneration = useTemplateStore((s) => s.endSkillPoolGeneration);
  const removePendingSkill = useTemplateStore((s) => s.removePendingSkill);

  // Dynamic class options from template's character_creation.classes
  const classOptions = useMemo(() => {
    const currentTemplate = templates.find(t => t.id === currentTemplateId);
    const classes = currentTemplate?.character_creation?.classes ?? [];
    const options = classes.map((cls: { id: string; name: string }) => ({ value: cls.id, label: cls.name }));
    return [{ value: '', label: '全部' }, ...options];
  }, [templates, currentTemplateId]);

  // Dynamic category options from existing pool data + template skill definitions
  const categoryOptions = useMemo(() => {
    const currentTemplate = templates.find(t => t.id === currentTemplateId);
    // Collect categories from template skill definitions
    const templateCategories = (currentTemplate?.skills ?? []).map(s => s.category).filter(Boolean);
    // Collect categories from existing pool entries
    const poolCategories = skillPool.map(e => e.category).filter(Boolean);
    // Merge and deduplicate
    const allCategories = [...new Set([...templateCategories, ...poolCategories])];
    // If no categories found, use defaults
    const finalCategories = allCategories.length > 0 ? allCategories : DEFAULT_SKILL_CATEGORIES.map(c => c.value);
    const options = finalCategories.map(cat => {
      const defaultLabel = DEFAULT_SKILL_CATEGORIES.find(c => c.value === cat)?.label ?? cat;
      return { value: cat, label: defaultLabel };
    });
    return [{ value: '', label: '全部' }, ...options];
  }, [templates, currentTemplateId, skillPool]);

  // Category options for generation config (no "全部" option)
  const generateCategoryOptions = useMemo(() => {
    return categoryOptions.filter(o => o.value);
  }, [categoryOptions]);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SkillFormData>(createEmptySkillForm());
  const [isAdding, setIsAdding] = useState(false);

  // Config modal state
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    generateCategoryOptions.map(o => o.value)
  );
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<number>(10);
  const [seed, setSeed] = useState<string>(Math.random().toString(36).substring(2, 10));

  const isReviewing = isReviewingGeneration && pendingGeneratedSkills && pendingGeneratedSkills.length > 0;

  const loadPool = useCallback(() => {
    if (!currentTemplateId) return;
    const params: { category?: string; recommendedClass?: string } = {};
    if (categoryFilter) params.category = categoryFilter;
    if (classFilter) params.recommendedClass = classFilter;
    fetchSkillPool(currentTemplateId, params);
  }, [currentTemplateId, categoryFilter, classFilter, fetchSkillPool]);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  const handleAdd = useCallback(() => {
    if (!currentTemplateId) return;
    setIsAdding(true);
    setEditForm(createEmptySkillForm());
    setEditingId(null);
  }, [currentTemplateId]);

  const handleEdit = useCallback((entry: TemplateSkillPoolEntry) => {
    setEditingId(entry.id);
    setEditForm(entryToForm(entry));
    setIsAdding(false);
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setIsAdding(false);
    setEditForm(createEmptySkillForm());
  }, []);

  const handleSaveAdd = useCallback(async () => {
    if (!currentTemplateId || !editForm.name.trim()) return;
    await addSkillToPool(currentTemplateId, {
      name: editForm.name,
      category: editForm.category,
      element: editForm.element,
      icon: editForm.icon,
      description: editForm.description,
      recommendedClasses: editForm.recommendedClasses.split(',').map((s) => s.trim()).filter(Boolean),
      source: (editForm.source || 'manual') as TemplateSkillPoolEntry['source'],
    });
    setIsAdding(false);
    setEditForm(createEmptySkillForm());
  }, [currentTemplateId, editForm, addSkillToPool]);

  const handleSaveEdit = useCallback(async () => {
    if (!currentTemplateId || !editingId) return;
    await updateSkillInPool(currentTemplateId, editingId, {
      name: editForm.name,
      category: editForm.category,
      element: editForm.element,
      icon: editForm.icon,
      description: editForm.description,
      recommendedClasses: editForm.recommendedClasses.split(',').map((s) => s.trim()).filter(Boolean),
      source: (editForm.source || 'manual') as TemplateSkillPoolEntry['source'],
    });
    setEditingId(null);
    setEditForm(createEmptySkillForm());
  }, [currentTemplateId, editingId, editForm, updateSkillInPool]);

  const handleDelete = useCallback(async (skillId: string) => {
    if (!currentTemplateId) return;
    await removeSkillFromPool(currentTemplateId, skillId);
  }, [currentTemplateId, removeSkillFromPool]);

  const handleStartGeneration = useCallback(async () => {
    if (!currentTemplateId) return;
    setShowConfigModal(false);
    await generateSkillPool(currentTemplateId, {
      categories: selectedCategories,
      recommendedClasses: selectedClasses,
      batchSize,
      seed,
    });
  }, [currentTemplateId, selectedCategories, selectedClasses, batchSize, seed, generateSkillPool]);

  const handleCommitAndContinue = useCallback(async () => {
    if (!currentTemplateId || !pendingGeneratedSkills) return;
    await commitAndContinueSkillPool(currentTemplateId, pendingGeneratedSkills);
  }, [currentTemplateId, pendingGeneratedSkills, commitAndContinueSkillPool]);

  const handleEndGeneration = useCallback(async () => {
    if (!currentTemplateId) return;
    await endSkillPoolGeneration(currentTemplateId);
  }, [currentTemplateId, endSkillPoolGeneration]);

  const entries = (skillPool ?? []) as TemplateSkillPoolEntry[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">技能池</h3>
        <div className="flex items-center gap-2">
          {isReviewing ? (
            <>
              <Button size="sm" variant="outline" onClick={handleCommitAndContinue} disabled={poolGenerating}>
                <SparklesIcon className="mr-1 h-3.5 w-3.5" />
                确认并继续
              </Button>
              <Button size="sm" variant="danger" onClick={handleEndGeneration}>
                结束生成
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowConfigModal(true)} disabled={poolGenerating}>
                <SparklesIcon className="mr-1 h-3.5 w-3.5" />
                {poolGenerating ? '生成中...' : 'LLM生成'}
              </Button>
              <Button size="sm" onClick={handleAdd}>
                <PlusIcon className="mr-1 h-3.5 w-3.5" />
                添加技能
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        管理模板的技能池。技能池中的技能可在游戏中被抽取和分配。
      </p>

      {/* Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfigModal(false)}>
          <div className="w-full max-w-md rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">LLM 生成配置</h4>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">生成分类</label>
                <div className="flex flex-wrap gap-2">
                  {generateCategoryOptions.map(cat => (
                    <label key={cat.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(cat.value)}
                        onChange={(e) => e.target.checked
                          ? setSelectedCategories([...selectedCategories, cat.value])
                          : setSelectedCategories(selectedCategories.filter(c => c !== cat.value))}
                        className="rounded border-[var(--border-primary)]"
                      />
                      <span className="text-sm text-[var(--text-primary)]">{cat.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">推荐职业</label>
                <div className="flex flex-wrap gap-2">
                  {classOptions.filter(o => o.value).map(cls => (
                    <label key={cls.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedClasses.includes(cls.value)}
                        onChange={(e) => e.target.checked
                          ? setSelectedClasses([...selectedClasses, cls.value])
                          : setSelectedClasses(selectedClasses.filter(c => c !== cls.value))}
                        className="rounded border-[var(--border-primary)]"
                      />
                      <span className="text-sm text-[var(--text-primary)]">{cls.label}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">不选则生成全职业通用技能</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">每批数量</label>
                <div className="flex gap-2">
                  {[5, 10, 15].map(n => (
                    <Button key={n} size="sm" variant={batchSize === n ? 'primary' : 'outline'}
                      onClick={() => setBatchSize(n)}>{n}</Button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">随机种子</label>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]">{seed}</code>
                  <Button size="sm" variant="ghost" onClick={() => setSeed(Math.random().toString(36).substring(2, 10))}>
                    刷新
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">影响生成创意方向</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowConfigModal(false)}>取消</Button>
              <Button onClick={handleStartGeneration} disabled={selectedCategories.length === 0}>开始生成</Button>
            </div>
          </div>
        </div>
      )}

      {/* Generating indicator */}
      {poolGenerating && !isReviewing && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600 dark:border-blue-700 dark:border-t-blue-400" />
          <span className="text-sm text-blue-700 dark:text-blue-300">正在生成技能，请稍候...</span>
        </div>
      )}

      {/* Pending review list */}
      {isReviewing && pendingGeneratedSkills && (
        <div className="rounded-md border border-dashed border-blue-400 p-3">
          <div className="mb-2 text-sm font-medium text-blue-600">待审核（LLM 生成）</div>
          {pendingGeneratedSkills.map((skill, index) => (
            <div key={skill.name ?? index} className="flex items-center justify-between py-1">
              <span className="text-sm text-[var(--text-primary)]">{skill.name} - {skill.category}</span>
              <Button size="sm" variant="ghost" onClick={() => removePendingSkill(index)}>
                <XMarkIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-[var(--text-secondary)]">分类筛选</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={selectClass}
          >
            {categoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-[var(--text-secondary)]">推荐职业</label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className={selectClass}
          >
            {classOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {poolLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
        </div>
      )}

      {!poolLoading && entries.length === 0 && !isReviewing && (
        <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">暂无技能池数据，点击"添加技能"或"LLM生成"开始</p>
        </div>
      )}

      {!poolLoading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry) =>
            editingId === entry.id ? (
              <div key={entry.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
                <PoolEntryForm
                  type="skill"
                  title="编辑技能"
                  form={editForm}
                  onFormChange={(updater) => setEditForm((f) => updater(f) as SkillFormData)}
                  onSubmit={handleSaveEdit}
                  onCancel={handleCancel}
                />
              </div>
            ) : (
              <PoolEntryCard
                key={entry.id}
                entry={entry}
                type="skill"
                categoryOptions={categoryOptions.filter(o => o.value)}
                onEdit={() => handleEdit(entry)}
                onDelete={() => handleDelete(entry.id)}
              />
            )
          )}
        </div>
      )}

      {isAdding && (
        <PoolEntryForm
          type="skill"
          title="添加新技能"
          form={editForm}
          onFormChange={(updater) => setEditForm((f) => updater(f) as SkillFormData)}
          onSubmit={handleSaveAdd}
          onCancel={handleCancel}
          submitLabel="添加"
          submitDisabled={!editForm.name.trim()}
        />
      )}
    </div>
  );
}
