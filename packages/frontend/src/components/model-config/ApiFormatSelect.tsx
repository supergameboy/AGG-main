import type { ProviderType, ApiFormat, ProviderPreset } from '@ai-rpg/shared';
import { API_FORMAT_LABELS } from './constants';

interface ApiFormatSelectProps {
  providerType: ProviderType;
  presets: Record<string, ProviderPreset>;
  value: ApiFormat;
  onChange: (format: ApiFormat) => void;
}

export function ApiFormatSelect({ providerType, presets, value, onChange }: ApiFormatSelectProps) {
  const preset = presets[providerType];
  const supportsOpenai = preset?.supportsOpenai ?? true;
  const supportsAnthropic = preset?.supportsAnthropic ?? false;

  const options: { value: ApiFormat; label: string }[] = [];
  if (supportsOpenai) {
    options.push({ value: 'openai', label: API_FORMAT_LABELS.openai });
  }
  if (supportsAnthropic) {
    options.push({ value: 'anthropic', label: API_FORMAT_LABELS.anthropic });
  }

  if (options.length <= 1) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-[var(--text-secondary)]">API 格式</label>
        <div className="flex h-10 items-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]">
          {options[0]?.label || 'OpenAI 格式'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[var(--text-secondary)]">API 格式</label>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              value === opt.value
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
