import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class KimiProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://api.moonshot.cn/v1');
  }
}
