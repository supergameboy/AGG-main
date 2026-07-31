import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class GLMProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://open.bigmodel.cn/api/paas/v4');
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 2);
  }
}
