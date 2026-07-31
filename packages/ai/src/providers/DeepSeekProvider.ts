import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://api.deepseek.com');
  }
}
