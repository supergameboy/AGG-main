import { useState, useEffect, useCallback, useMemo } from 'react';
import { SparklesIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTemplateStore } from '@/stores/templateStore';
import { Button } from '@/components/ui/Button';
import { PoolEntryCard } from './PoolEntryCard';
import { PoolEntryForm, createEmptyItemForm } from './PoolEntryForm';
import type { ItemFormData } from './PoolEntryForm';
import type { TemplateItemPoolEntry } from '@/types';

// Default item categories used when template has no specific categories
const DEFAULT_ITEM_CATEGORIES = [
  { value: 'weapon', label: '武器' },
  { value: 'armor', label: '护甲' },
  { value: 'accessory', label: '饰品' },
  { value: 'consumable', label: '消耗品' },
  { value: 'material', label: '材料' },
  { value: 'tool', label: '工具' },
  { value: 'quest', label: '任务物品' },
  { value: 'misc', label: '杂项' },
];

const QUALITY_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'common', label: '普通' },
  { value: 'uncommon', label: '优秀' },
  { value: 'rare', label: '稀有' },
  { value: 'epic', label: '史诗' },
  { value: 'legendary', label: '传说' },
];

const SLOT_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'head', label: '头部' },
  { value: 'chest', label: '胸甲' },
  { value: 'legs', label: '腿部' },
  { value: 'feet', label: '脚部' },
  { value: 'hands', label: '手部' },
  { value: 'main_hand', label: '主手' },
  { value: 'off_hand', label: '副手' },
  { value: 'accessory', label: '饰品' },
];

const selectClass =
  'h-9 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

function entryToForm(entry: TemplateItemPoolEntry): ItemFormData {
  return {
    name: entry.name ?? '',
    category: entry.category ?? 'misc',
    quality: entry.quality ?? 'common',
    equippedSlot: entry.equippedSlot ?? '',
    icon: entry.icon ?? '',
    description: entry.description ?? '',
    recommendedClasses: (entry.recommendedClasses ?? []).join(', '),
    source: entry.source ?? '',
  };
}

export function ItemPoolTab() {
  const currentTemplateId = useTemplateStore((s) => s.currentTemplateId);
  const templates = useTemplateStore((s) => s.templates);
  const itemPool = useTemplateStore((s) => s.itemPool);
  const poolLoading = useTemplateStore((s) => s.poolLoading);
  const poolGenerating = useTemplateStore((s) => s.poolGenerating);
  const pendingGeneratedItems = useTemplateStore((s) => s.pendingGeneratedItems);
  const isReviewingGeneration = useTemplateStore((s) => s.isReviewingGeneration);
  const fetchItemPool = useTemplateStore((s) => s.fetchItemPool);
  const addItemToPool = useTemplateStore((s) => s.addItemToPool);
  const updateItemInPool = useTemplateStore((s) => s.updateItemInPool);
  const removeItemFromPool = useTemplateStore((s) => s.removeItemFromPool);
  const generateItemPool = useTemplateStore((s) => s.generateItemPool);
  const commitAndContinueItemPool = useTemplateStore((s) => s.commitAndContinueItemPool);
  const endItemPoolGeneration = useTemplateStore((s) => s.endItemPoolGeneration);
  const removePendingItem = useTemplateStore((s) => s.removePendingItem);

  // Dynamic class options from template's character_creation.classes
  const classOptions = useMemo(() => {
    const currentTemplate = templates.find(t => t.id === currentTemplateId);
    const classes = currentTemplate?.character_creation?.classes ?? [];
    const options = classes.map((cls: { id: string; name: string }) => ({ value: cls.id, label: cls.name }));
    return [{ value: '', label: '全部' }, ...options];
  }, [templates, currentTemplateId]);

  // Dynamic category options from existing pool data + template item definitions
  const categoryOptions = useMemo(() => {
    const currentTemplate = templates.find(t => t.id === currentTemplateId);
    // Collect categories from template item definitions
    const templateCategories = (currentTemplate?.items ?? []).map(i => i.category).filter(Boolean);
    // Collect categories from existing pool entries
    const poolCategories = itemPool.map(e => e.category).filter(Boolean);
    // Merge and deduplicate
    const allCategories = [...new Set([...templateCategories, ...poolCategories])];
    // If no categories found, use defaults
    const finalCategories = allCategories.length > 0 ? allCategories : DEFAULT_ITEM_CATEGORIES.map(c => c.value);
    const options = finalCategories.map(cat => {
      const defaultLabel = DEFAULT_ITEM_CATEGORIES.find(c => c.value === cat)?.label ?? cat;
      return { value: cat, label: defaultLabel };
    });
    return [{ value: '', label: '全部' }, ...options];
  }, [templates, currentTemplateId, itemPool]);

  // Category options for generation config (no "全部" option)
  const generateCategoryOptions = useMemo(() => {
    return categoryOptions.filter(o => o.value);
  }, [categoryOptions]);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [slotFilter, setSlotFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ItemFormData>(createEmptyItemForm());
  const [isAdding, setIsAdding] = useState(false);

  // Config modal state
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    generateCategoryOptions.map(o => o.value)
  );
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<number>(10);
  const [seed, setSeed] = useState<string>(Math.random().toString(36).substring(2, 10));

  const isReviewing = isReviewingGeneration && pendingGeneratedItems && pendingGeneratedItems.length > 0;

  const loadPool = useCallback(() => {
    if (!currentTemplateId) return;
    const params: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string } = {};
    if (categoryFilter) params.category = categoryFilter;
    if (qualityFilter) params.quality = qualityFilter;
    if (slotFilter) params.equippedSlot = slotFilter;
    if (classFilter) params.recommendedClass = classFilter;
    fetchItemPool(currentTemplateId, params);
  }, [currentTemplateId, categoryFilter, qualityFilter, slotFilter, classFilter, fetchItemPool]);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  const handleAdd = useCallback(() => {
    if (!currentTemplateId) return;
    setIsAdding(true);
    setEditForm(createEmptyItemForm());
    setEditingId(null);
  }, [currentTemplateId]);

  const handleEdit = useCallback((entry: TemplateItemPoolEntry) => {
    setEditingId(entry.id);
    setEditForm(entryToForm(entry));
    setIsAdding(false);
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setIsAdding(false);
    setEditForm(createEmptyItemForm());
  }, []);

  const handleSaveAdd = useCallback(async () => {
    if (!currentTemplateId || !editForm.name.trim()) return;
    await addItemToPool(currentTemplateId, {
      name: editForm.name,
      category: editForm.category as TemplateItemPoolEntry['category'],
      quality: editForm.quality as TemplateItemPoolEntry['quality'],
      equippedSlot: editForm.equippedSlot || undefined,
      icon: editForm.icon,
      description: editForm.description,
      recommendedClasses: editForm.recommendedClasses.split(',').map((s) => s.trim()).filter(Boolean),
      source: (editForm.source || 'manual') as TemplateItemPoolEntry['source'],
    });
    setIsAdding(false);
    setEditForm(createEmptyItemForm());
  }, [currentTemplateId, editForm, addItemToPool]);

  const handleSaveEdit = useCallback(async () => {
    if (!currentTemplateId || !editingId) return;
    await updateItemInPool(currentTemplateId, editingId, {
      name: editForm.name,
      category: editForm.category as TemplateItemPoolEntry['category'],
      quality: editForm.quality as TemplateItemPoolEntry['quality'],
      equippedSlot: editForm.equippedSlot || undefined,
      icon: editForm.icon,
      description: editForm.description,
      recommendedClasses: editForm.recommendedClasses.split(',').map((s) => s.trim()).filter(Boolean),
      source: (editForm.source || 'manual') as TemplateItemPoolEntry['source'],
    });
    setEditingId(null);
    setEditForm(createEmptyItemForm());
  }, [currentTemplateId, editingId, editForm, updateItemInPool]);

  const handleDelete = useCallback(async (itemId: string) => {
    if (!currentTemplateId) return;
    await removeItemFromPool(currentTemplateId, itemId);
  }, [currentTemplateId, removeItemFromPool]);

  const handleStartGeneration = useCallback(async () => {
    if (!currentTemplateId) return;
    setShowConfigModal(false);
    await generateItemPool(currentTemplateId, {
      categories: selectedCategories,
      recommendedClasses: selectedClasses,
      batchSize,
      seed,
    });
  }, [currentTemplateId, selectedCategories, selectedClasses, batchSize, seed, generateItemPool]);

  const handleCommitAndContinue = useCallback(async () => {
    if (!currentTemplateId || !pendingGeneratedItems) return;
    await commitAndContinueItemPool(currentTemplateId, pendingGeneratedItems);
  }, [currentTemplateId, pendingGeneratedItems, commitAndContinueItemPool]);

  const handleEndGeneration = useCallback(async () => {
    if (!currentTemplateId) return;
    await endItemPoolGeneration(currentTemplateId);
  }, [currentTemplateId, endItemPoolGeneration]);

  const entries = (itemPool ?? []) as TemplateItemPoolEntry[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">物品池</h3>
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
                添加物品
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        管理模板的物品池。物品池中的物品可在游戏中被抽取和分配。
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
                <p className="mt-1 text-xs text-[var(--text-muted)]">不选则生成全职业通用物品</p>
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
          <span className="text-sm text-blue-700 dark:text-blue-300">正在生成物品，请稍候...</span>
        </div>
      )}

      {/* Pending review list */}
      {isReviewing && pendingGeneratedItems && (
        <div className="rounded-md border border-dashed border-blue-400 p-3">
          <div className="mb-2 text-sm font-medium text-blue-600">待审核（LLM 生成）</div>
          {pendingGeneratedItems.map((item, index) => (
            <div key={item.name ?? index} className="flex items-center justify-between py-1">
              <span className="text-sm text-[var(--text-primary)]">{item.name} - {item.category}</span>
              <Button size="sm" variant="ghost" onClick={() => removePendingItem(index)}>
                <XMarkIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-[var(--text-secondary)]">分类</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={selectClass}>
            {categoryOptions.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-[var(--text-secondary)]">品质</label>
          <select value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)} className={selectClass}>
            {QUALITY_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-[var(--text-secondary)]">装备槽位</label>
          <select value={slotFilter} onChange={(e) => setSlotFilter(e.target.value)} className={selectClass}>
            {SLOT_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-[var(--text-secondary)]">推荐职业</label>
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={selectClass}>
            {classOptions.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
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
          <p className="text-sm text-[var(--text-muted)]">暂无物品池数据，点击"添加物品"或"LLM生成"开始</p>
        </div>
      )}

      {!poolLoading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry) =>
            editingId === entry.id ? (
              <div key={entry.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
                <PoolEntryForm
                  type="item"
                  title="编辑物品"
                  form={editForm}
                  onFormChange={(updater) => setEditForm((f) => updater(f) as ItemFormData)}
                  onSubmit={handleSaveEdit}
                  onCancel={handleCancel}
                />
              </div>
            ) : (
              <PoolEntryCard
                key={entry.id}
                entry={entry}
                type="item"
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
          type="item"
          title="添加新物品"
          form={editForm}
          onFormChange={(updater) => setEditForm((f) => updater(f) as ItemFormData)}
          onSubmit={handleSaveAdd}
          onCancel={handleCancel}
          submitLabel="添加"
          submitDisabled={!editForm.name.trim()}
        />
      )}
    </div>
  );
}
