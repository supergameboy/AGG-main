import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class QwenProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  }
}
