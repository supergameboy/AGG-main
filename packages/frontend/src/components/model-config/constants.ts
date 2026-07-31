import type { ProviderType, ApiFormat } from '@ai-rpg/shared';

export interface ProviderTypeInfo {
  emoji: string;
  displayName: string;
}

export const PROVIDER_TYPE_INFO: Record<ProviderType, ProviderTypeInfo> = {
  openai: { emoji: '🤖', displayName: 'OpenAI' },
  gemini: { emoji: '🔮', displayName: 'Gemini' },
  deepseek: { emoji: '🦅', displayName: 'DeepSeek' },
  glm: { emoji: '🧠', displayName: 'GLM' },
  kimi: { emoji: '🌙', displayName: 'Kimi' },
  anthropic: { emoji: '🎭', displayName: 'Claude' },
  qwen: { emoji: '☁️', displayName: 'Qwen' },
  ernie: { emoji: '📚', displayName: 'ERNIE' },
  spark: { emoji: '⚡', displayName: 'Spark' },
  siliconflow: { emoji: '🌊', displayName: 'SiliconFlow' },
  'github-copilot': { emoji: '🐙', displayName: 'GitHub Copilot' },
  custom: { emoji: '⚙️', displayName: '自定义' },
};

export const PROVIDER_TYPE_OPTIONS: { value: ProviderType; label: string; emoji: string }[] = (
  Object.entries(PROVIDER_TYPE_INFO) as [ProviderType, ProviderTypeInfo][]
).map(([value, info]) => ({
  value,
  label: info.displayName,
  emoji: info.emoji,
}));

export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  openai: 'OpenAI 格式',
  anthropic: 'Anthropic 格式',
};
