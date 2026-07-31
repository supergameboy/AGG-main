import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class ErnieProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://qianfan.baidubce.com/v2');
  }
}
