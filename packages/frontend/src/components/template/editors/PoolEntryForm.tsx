import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const SELECT_CLASS =
  'h-9 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

const SKILL_CATEGORY_OPTIONS = [
  { value: 'attack', label: '攻击' },
  { value: 'defense', label: '防御' },
  { value: 'healing', label: '治疗' },
  { value: 'buff', label: '增益' },
  { value: 'debuff', label: '减益' },
  { value: 'utility', label: '实用' },
  { value: 'passive', label: '被动' },
];

const ITEM_CATEGORY_OPTIONS = [
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

export interface SkillFormData {
  name: string;
  category: string;
  element: string;
  icon: string;
  description: string;
  recommendedClasses: string;
  source: string;
}

export interface ItemFormData {
  name: string;
  category: string;
  quality: string;
  equippedSlot: string;
  icon: string;
  description: string;
  recommendedClasses: string;
  source: string;
}

export type PoolFormData = SkillFormData | ItemFormData;

export function createEmptySkillForm(): SkillFormData {
  return { name: '', category: 'attack', element: 'physical', icon: '', description: '', recommendedClasses: '', source: '' };
}

export function createEmptyItemForm(): ItemFormData {
  return { name: '', category: 'misc', quality: 'common', equippedSlot: '', icon: '', description: '', recommendedClasses: '', source: '' };
}

interface PoolEntryFormProps {
  type: 'skill' | 'item';
  title: string;
  form: PoolFormData;
  onFormChange: (updater: (prev: PoolFormData) => PoolFormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col">
      <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

export function PoolEntryForm({
  type,
  title,
  form,
  onFormChange,
  onSubmit,
  onCancel,
  submitLabel = '保存',
  submitDisabled = false,
}: PoolEntryFormProps) {
  const categoryOptions = type === 'skill' ? SKILL_CATEGORY_OPTIONS : ITEM_CATEGORY_OPTIONS;

  return (
    <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--bg-card)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">{title}</h4>
        <button
          onClick={onCancel}
          className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="名称"
          value={form.name}
          onChange={(e) => onFormChange((f) => ({ ...f, name: e.target.value }))}
          placeholder={type === 'skill' ? '技能名称' : '物品名称'}
        />
        <Input
          label="图标(emoji)"
          value={form.icon}
          onChange={(e) => onFormChange((f) => ({ ...f, icon: e.target.value }))}
          placeholder="如 ⚔️ 🔥 💎"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="分类"
          value={form.category}
          onChange={(v) => onFormChange((f) => ({ ...f, category: v }))}
          options={categoryOptions}
        />
      </div>
      {type === 'skill' && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="元素"
            value={(form as SkillFormData).element}
            onChange={(e) => onFormChange((f) => ({ ...f, element: e.target.value }))}
            placeholder="如 physical, fire"
          />
          <Input
            label="推荐职业(逗号分隔)"
            value={form.recommendedClasses}
            onChange={(e) => onFormChange((f) => ({ ...f, recommendedClasses: e.target.value }))}
            placeholder="warrior, mage"
          />
        </div>
      )}
      {type === 'item' && (
        <div className="grid grid-cols-3 gap-3">
          <SelectField
            label="品质"
            value={(form as ItemFormData).quality}
            onChange={(v) => onFormChange((f) => ({ ...f, quality: v }))}
            options={QUALITY_OPTIONS}
          />
          <SelectField
            label="装备槽位"
            value={(form as ItemFormData).equippedSlot}
            onChange={(v) => onFormChange((f) => ({ ...f, equippedSlot: v }))}
            options={SLOT_OPTIONS}
          />
          <Input
            label="推荐职业(逗号分隔)"
            value={form.recommendedClasses}
            onChange={(e) => onFormChange((f) => ({ ...f, recommendedClasses: e.target.value }))}
            placeholder="warrior, mage"
          />
        </div>
      )}
      <Input
        label="描述"
        value={form.description}
        onChange={(e) => onFormChange((f) => ({ ...f, description: e.target.value }))}
        placeholder={type === 'skill' ? '技能描述' : '物品描述'}
      />
      <Input
        label="来源"
        value={form.source}
        onChange={(e) => onFormChange((f) => ({ ...f, source: e.target.value }))}
        placeholder="如 template, generated"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={onSubmit} disabled={submitDisabled}>{submitLabel}</Button>
      </div>
    </div>
  );
}
