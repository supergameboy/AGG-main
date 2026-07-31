import { useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { WorldSetting } from '@/types';

export default function WorldSettingEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [newFieldKey, setNewFieldKey] = useState('');

  if (!editingTemplate) return null;

  const ws = editingTemplate.world_setting;

  const updateField = <K extends keyof WorldSetting>(field: K, value: WorldSetting[K]) => {
    updateNestedField('world_setting', { ...ws, [field]: value });
  };

  const addCustomField = () => {
    const key = newFieldKey.trim();
    if (!key || key in ws.custom_fields) return;
    updateField('custom_fields', { ...ws.custom_fields, [key]: '' });
    setNewFieldKey('');
  };

  const removeCustomField = (key: string) => {
    const { [key]: _, ...rest } = ws.custom_fields;
    updateField('custom_fields', rest);
  };

  const updateCustomFieldValue = (key: string, value: string) => {
    updateField('custom_fields', { ...ws.custom_fields, [key]: value });
  };

  return (
    <div className="space-y-5">
      <Input
        label="世界名称"
        value={ws.name}
        onChange={(e) => updateField('name', e.target.value)}
        placeholder="输入世界名称"
      />

      <div className="flex flex-col w-full">
        <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">世界描述</label>
        <textarea
          value={ws.description}
          onChange={(e) => updateField('description', e.target.value)}
          placeholder="描述这个世界的特征和背景"
          rows={4}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="时代"
          value={ws.era}
          onChange={(e) => updateField('era', e.target.value)}
          placeholder="如：中世纪、未来、远古"
        />
        <Input
          label="魔法体系"
          value={ws.magic_system}
          onChange={(e) => updateField('magic_system', e.target.value)}
          placeholder="如：元素魔法、无魔法"
        />
      </div>

      <Input
        label="科技水平"
        value={ws.technology_level}
        onChange={(e) => updateField('technology_level', e.target.value)}
        placeholder="如：蒸汽朋克、高科技、原始"
      />

      <div className="space-y-3">
        <label className="text-sm font-medium text-[var(--text-secondary)]">自定义字段</label>

        {Object.entries(ws.custom_fields).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="min-w-[120px] text-sm text-[var(--text-muted)] font-mono">{key}</span>
            <Input
              value={value}
              onChange={(e) => updateCustomFieldValue(key, e.target.value)}
              placeholder={`输入 ${key} 的值`}
            />
            <Button
              variant="danger"
              size="sm"
              onClick={() => removeCustomField(key)}
            >
              删除
            </Button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-2">
          <Input
            value={newFieldKey}
            onChange={(e) => setNewFieldKey(e.target.value)}
            placeholder="新字段名称"
            hint="输入键名后点击添加"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={addCustomField}
            disabled={!newFieldKey.trim()}
          >
            添加字段
          </Button>
        </div>
      </div>
    </div>
  );
}
