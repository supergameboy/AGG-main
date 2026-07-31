import type { ProviderType, ApiFormat, ProviderPreset } from '@ai-rpg/shared';

export const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  openai: {
    providerType: 'openai',
    displayName: 'OpenAI',
    openaiBaseUrl: 'https://api.openai.com/v1',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  gemini: {
    providerType: 'gemini',
    displayName: 'Google Gemini',
    openaiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['gemini-2.5-pro-preview-06-05', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  deepseek: {
    providerType: 'deepseek',
    displayName: 'DeepSeek',
    openaiBaseUrl: 'https://api.deepseek.com',
    anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
    recommendedFormat: 'anthropic',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    supportsOpenai: true,
    supportsAnthropic: true,
    supportsThinking: true,
  },
  glm: {
    providerType: 'glm',
    displayName: '智谱AI (GLM)',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-z1-air', 'glm-z1-flash'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  kimi: {
    providerType: 'kimi',
    displayName: 'Kimi (月之暗面)',
    openaiBaseUrl: 'https://api.moonshot.cn/v1',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  anthropic: {
    providerType: 'anthropic',
    displayName: 'Anthropic (Claude)',
    openaiBaseUrl: null,
    anthropicBaseUrl: 'https://api.anthropic.com',
    recommendedFormat: 'anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'],
    supportsOpenai: false,
    supportsAnthropic: true,
    supportsThinking: true,
  },
  qwen: {
    providerType: 'qwen',
    displayName: '通义千问 (Qwen)',
    openaiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    anthropicBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recommendedFormat: 'anthropic',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwq-32b', 'qwen-long'],
    supportsOpenai: true,
    supportsAnthropic: true,
  },
  ernie: {
    providerType: 'ernie',
    displayName: '百度文心 (ERNIE)',
    openaiBaseUrl: 'https://qianfan.baidubce.com/v2',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['ernie-4.0-8k', 'ernie-speed-128k', 'ernie-character-8k', 'ernie-novel-8k'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  spark: {
    providerType: 'spark',
    displayName: '讯飞星火 (Spark)',
    openaiBaseUrl: 'https://spark-api-open.xf-yun.com/v1',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['4.0Ultra', 'generalv3.5', 'max-32k'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  siliconflow: {
    providerType: 'siliconflow',
    displayName: '硅基流动 (SiliconFlow)',
    openaiBaseUrl: 'https://api.siliconflow.cn/v1',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/QwQ-32B', 'Pro/deepseek-ai/DeepSeek-V3'],
    supportsOpenai: true,
    supportsAnthropic: false,
  },
  'github-copilot': {
    providerType: 'github-copilot',
    displayName: 'GitHub Copilot',
    openaiBaseUrl: 'https://api.githubcopilot.com',
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'claude-sonnet-4', 'o3-mini'],
    supportsOpenai: true,
    supportsAnthropic: false,
    // apiKey 由 OAuth device flow 产出并在运行时解析，不落 model_providers 表
    oauthManaged: true,
  },
  custom: {
    providerType: 'custom',
    displayName: '自定义 (Custom)',
    openaiBaseUrl: null,
    anthropicBaseUrl: null,
    recommendedFormat: 'openai',
    models: [],
    supportsOpenai: true,
    supportsAnthropic: true,
  },
};

export function getPreset(providerType: ProviderType): ProviderPreset {
  return PROVIDER_PRESETS[providerType];
}

export function getBaseUrlForFormat(providerType: ProviderType, apiFormat: ApiFormat): string | null {
  const preset = PROVIDER_PRESETS[providerType];
  if (!preset) {
    return null;
  }
  return apiFormat === 'openai' ? preset.openaiBaseUrl : preset.anthropicBaseUrl;
}
