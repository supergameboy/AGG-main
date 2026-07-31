import { useState } from 'react';
import type { ProviderType, ApiFormat, ProviderPreset } from '@ai-rpg/shared';

interface ModelSelectProps {
  providerType: ProviderType;
  presets: Record<string, ProviderPreset>;
  value: string;
  onChange: (model: string) => void;
  apiFormat: ApiFormat;
}

const CUSTOM_VALUE = '__custom__';

export function ModelSelect({ providerType, presets, value, onChange }: ModelSelectProps) {
  const [isCustom, setIsCustom] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const preset = presets[providerType];
  const models = preset?.models ?? [];

  const isPresetModel = models.includes(value);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    if (selected === CUSTOM_VALUE) {
      setIsCustom(true);
      setCustomValue('');
      onChange('');
    } else {
      setIsCustom(false);
      onChange(selected);
    }
  };

  const handleCustomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomValue(e.target.value);
    onChange(e.target.value);
  };

  const selectValue = isCustom ? CUSTOM_VALUE : isPresetModel ? value : CUSTOM_VALUE;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[var(--text-secondary)]">默认模型</label>
      <select
        value={selectValue}
        onChange={handleSelectChange}
        className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
        <option value={CUSTOM_VALUE}>自定义输入</option>
      </select>
      {(isCustom || (!isPresetModel && value)) && (
        <input
          type="text"
          value={isCustom ? customValue : value}
          onChange={handleCustomInput}
          placeholder="输入自定义模型名称"
          className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      )}
    </div>
  );
}
